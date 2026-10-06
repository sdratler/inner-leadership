import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {freshActor,lockWorkspace} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {leadIntentSchema,leadPreviewRequestSchema,leadCommandResultSchema,parseLeadText,
 type LeadPreviewRequest,type LeadPreviewResult,type LeadPreview,type LeadCommandResult} from "../core/lead-command.ts";
import {AcquisitionCandidateStore} from "./acquisition-store.ts";
import {AcquisitionDecisionStore} from "./acquisition-decisions.ts";
import {NativeContactDirectory} from "./native-directory.ts";
import {NativeCrmStore} from "./native-store.ts";
import {OperationalNativeCrmStore} from "./operational-store.ts";
import {readCutoverState,cutoverStateSchema,cutoverStateAad} from "./cutover-state.ts";
import {writeDestination} from "../core/cutover.ts";
import {privateDigest} from "./digests.ts";
import {normalizePhone} from "../core/contact-resolution.ts";

const WINDOW_MS=10*60_000,PREVIEW_MS=15*60_000;
const previewSchema=z.object({operationId:z.string().uuid(),workspaceId:z.string().uuid(),actorId:z.string().uuid(),
 expectedEpoch:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),phone:z.string().refine(v=>normalizePhone(v)===v),
 name:z.string().min(1).max(1000),existingName:z.string().max(1000).nullable(),personId:z.string().uuid().nullable(),
 candidateId:z.string().uuid().nullable(),version:z.number().int().min(1).max(2147483646).nullable(),
 intent:leadIntentSchema,createdAt:z.iso.datetime(),expiresAt:z.iso.datetime()}).strict()
 .refine(v=>(v.personId===null)===(v.version===null)&&Date.parse(v.expiresAt)-Date.parse(v.createdAt)===PREVIEW_MS);
type Snapshot=z.infer<typeof previewSchema>;
const previewAad=(actor:Actor)=>`ls_contact_ops/lead-preview/v1/${actor.workspaceId}/${actor.id}`;
const resultAad=(workspace:string,operation:string)=>`ls_contact_ops/lead-command/v1/${workspace}/${operation}`;
const clarify=(reason:"unsupported"|"identity"|"name"|"reserved",choices:Extract<LeadPreviewResult,{state:"clarify"}>["choices"]=[]):LeadPreviewResult=>({state:"clarify",reason,choices});

/** One server-owned administrative command. Preview is encrypted, actor-bound,
 * read-only and short-lived. Confirmation owns one existing authority-locked
 * transaction, canonical CRM effects and immutable replay receipt. No model,
 * provider, identity grant, clinical note, send, billing or booking dependency. */
export class LeadCommandStore{
 private readonly candidates:AcquisitionCandidateStore;
 private readonly directory:NativeContactDirectory;
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){
  this.candidates=new AcquisitionCandidateStore(db,keyring,integrityKey,clock);
  this.directory=new NativeContactDirectory(db,keyring,clock);
 }
 private async lock(tx:SqlSession,actor:Actor,epoch:number,write=true){
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${actor.workspaceId}:contact-authority`]);
  if(write)await lockWorkspace(tx,actor.workspaceId);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
  const authority=await readCutoverState(tx,actor.workspaceId,this.keyring,write);
  if(authority.epoch!==epoch||writeDestination(authority.phase)!=="native")throw new AppError("CONFLICT");return authority;
 }
 async preview(actor:Actor,input:LeadPreviewRequest):Promise<LeadPreviewResult>{
  const parsed=leadPreviewRequestSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const request=parsed.data,now=this.clock.now(),today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(now);
  const intent=parseLeadText(request.text,today);
  return this.db.transaction(async tx=>{
   // Ordinary read-only preview takes the same authority/identity lock order;
   // it cannot create a receipt, projection request or canonical person.
   await tx.query("SET TRANSACTION READ ONLY");await this.lock(tx,actor,request.expectedEpoch,false);
   if(!intent)return clarify("unsupported");
   let candidateId:string|null=null,phone=intent.phone??null;
   if(request.candidateId||intent.recentCaller){
    const window=await this.candidates.pendingInTransaction(tx,actor);
    const pending=request.candidateId?window.items.filter(c=>c.metadata.id===request.candidateId):
     window.items.filter(c=>c.metadata.source==="android_nomad"&&Date.parse(c.metadata.occurredAt)<=now.getTime()&&
      now.getTime()-Date.parse(c.metadata.occurredAt)<=WINDOW_MS);
    if(pending.length!==1)return clarify("identity",pending.slice(0,30).map(c=>({candidateId:c.metadata.id,
     name:c.metadata.displayName,phone:c.metadata.phone,occurredAt:c.metadata.occurredAt})));
    const c=pending[0]!.metadata;if(phone&&phone!==c.phone)return clarify("identity");phone=c.phone;candidateId=c.id;
   }
   let selected:string|null=request.personId??null;
   if(selected){
    const page=await this.directory.listInTransaction(tx,actor,{view:"all",search:"",mode:"live",personId:selected,
     today,page:1,pageSize:1}),row=page.items[0];
    if(!row||row.mode!=="live"||row.identityKind!=="adult"||row.version===null||row.archived||row.doNotContact)return clarify("reserved");
    const phones=[...new Set(row.references.map(r=>normalizePhone(r.phone)).filter((p):p is string=>Boolean(p)))];
    if(phone?!phones.includes(phone):phones.length!==1)return clarify("identity");phone=phone??phones[0]!;
   }
   if(!phone)return clarify("identity");
   const match=(await this.directory.acquisitionMatchesInTransaction(tx,actor,[phone])).get(phone)!;
   if(match.state==="reserved")return clarify("reserved");
   const eligible=match.people.filter(p=>p.eligible);
   if(!selected&&match.state==="ambiguous")return clarify("identity",eligible.slice(0,30).map(p=>({personId:p.personId,name:p.displayName,phone:phone!})));
   if(!selected&&match.state==="existing"){if(eligible.length!==1)return clarify("reserved");selected=eligible[0]!.personId;}
   const existing=selected?eligible.find(p=>p.personId===selected):null;
   if(selected&&!existing)return clarify("reserved");
   if(intent.notLead){if(!candidateId||selected)return clarify("unsupported");}
   else if(!selected&&(!intent.promote||!intent.name))return clarify(intent.promote?"name":"identity");
   // Keep an existing normal name. A different supplied name is shown in the
   // preview, never silently written to the identity profile.
   const snapshot=previewSchema.parse({operationId:request.operationId,workspaceId:actor.workspaceId,actorId:actor.id,
    expectedEpoch:request.expectedEpoch,phone,name:existing?.displayName||intent.name||phone,existingName:existing?.displayName??null,
    personId:selected,candidateId,version:existing?.version??null,intent,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+PREVIEW_MS).toISOString()});
   const token=seal(JSON.stringify(snapshot),previewAad(actor),this.keyring);
   const result:LeadPreview={state:"ready",token,operationId:snapshot.operationId,phone:snapshot.phone,name:snapshot.name,
    existingName:snapshot.existingName,personId:snapshot.personId,candidateId:snapshot.candidateId,intent:snapshot.intent,expiresAt:snapshot.expiresAt};
   return result;
  });
 }
 async apply(actor:Actor,token:string):Promise<LeadCommandResult>{
  if(typeof token!=="string"||token.length<50||token.length>12000)throw new AppError("INVALID_REQUEST");
  let snapshot:Snapshot;try{snapshot=previewSchema.parse(JSON.parse(unseal(token,previewAad(actor),this.keyring)));}
  catch{throw new AppError("INVALID_REQUEST");}
  if(snapshot.actorId!==actor.id||snapshot.workspaceId!==actor.workspaceId)throw new AppError("INVALID_REQUEST");
  const digest=privateDigest({domain:"lead-command-v1",token,actor:actor.id,workspace:actor.workspaceId},this.integrityKey);
  return this.db.transaction(async tx=>{
   const authority=await this.lock(tx,actor,snapshot.expectedEpoch);
   const prior=await tx.query<{digest:string;actorId:string;personId:string|null;ciphertext:string}>(`SELECT payload_digest AS digest,
    actor_account_id AS "actorId",person_id AS "personId",result_ciphertext AS ciphertext FROM ls_contact_ops.lead_commands
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,snapshot.operationId]);
   if(prior.length>1)throw new AppError("UNAVAILABLE");
   if(prior[0]){const p=prior[0];if(p.digest!==digest||p.actorId!==actor.id)throw new AppError("CONFLICT");
    let result:LeadCommandResult;try{result=leadCommandResultSchema.parse(JSON.parse(unseal(p.ciphertext,resultAad(actor.workspaceId,snapshot.operationId),this.keyring)));}
    catch{throw new AppError("UNAVAILABLE");}
    if(result.personId!==p.personId||result.operationId!==snapshot.operationId||result.authorityEpoch!==snapshot.expectedEpoch||result.replayed)throw new AppError("UNAVAILABLE");
    return {...result,replayed:true};
   }
   const now=this.clock.now().getTime();if(now>=Date.parse(snapshot.expiresAt)||now<Date.parse(snapshot.createdAt))throw new AppError("CONFLICT");
   const match=(await this.directory.acquisitionMatchesInTransaction(tx,actor,[snapshot.phone])).get(snapshot.phone)!;
   if(snapshot.personId){const p=match.people.find(p=>p.personId===snapshot.personId&&p.eligible);
    if(!p||match.state==="reserved"||p.version!==snapshot.version||p.displayName!==snapshot.existingName)throw new AppError("CONFLICT");}
   else if(match.state!=="unmatched"||await this.directory.hasPhoneClaimInTransaction(tx,actor,snapshot.phone))throw new AppError("CONFLICT");
   const scoped:IdentityStore={transaction:work=>work(tx)},profiles=new NativeCrmStore(scoped,this.keyring,this.integrityKey,this.clock);
   const intent=snapshot.intent;let personId=snapshot.personId,version=snapshot.version,state:LeadCommandResult["state"]=personId?"updated":"created";
   let createdByCandidate=false;
   if(snapshot.candidateId){
    const candidate=await this.candidates.getInTransaction(tx,actor.workspaceId,snapshot.candidateId);
    if(candidate.metadata.phone!==snapshot.phone)throw new AppError("CONFLICT");
    const decision=await new AcquisitionDecisionStore(scoped,this.keyring,this.integrityKey,this.clock).decide(actor,{candidateId:snapshot.candidateId,
     operationId:snapshot.operationId,expectedEpoch:snapshot.expectedEpoch,...(intent.notLead?{action:"not_lead" as const}:
      personId?{action:"match" as const,personId,expectedVersion:version!}:{action:"promote" as const,fields:{name:snapshot.name,
       stage:intent.stage??"New inquiry",language:"" as const,note:intent.note??"",nextAction:intent.nextAction??"",dueDate:intent.dueDate??""}})});
    personId=decision.personId;version=decision.version;createdByCandidate=decision.state==="PROMOTED";
    if(intent.notLead)state="not_lead";
   }else if(!personId){
    const created=await new OperationalNativeCrmStore(scoped,this.keyring,this.integrityKey,this.clock).createContact(actor,{name:snapshot.name,
     phone:snapshot.phone,language:"",source:"Owner · quick update",notes:intent.note??"",nextAction:intent.nextAction??"",dueDate:intent.dueDate??""},snapshot.operationId,snapshot.expectedEpoch);
    personId=created.personId;version=created.version;
   }
   if(personId&&!createdByCandidate){
    const current=await profiles.read(actor,personId);if(!current||current.version!==version)throw new AppError("CONFLICT");
    // A new explicit-phone contact already contains the submitted note/action.
    // Existing contacts append, never replace, and retry is checked above first.
    const append=Boolean(snapshot.personId&&intent.note);
    const notes=append?current.profile.notes+(current.profile.notes?"\n":"")+intent.note:current.profile.notes;
    if(notes.length>5000)throw new AppError("INVALID_REQUEST");
    const next={...current.profile,notes,...(intent.stage?{stage:intent.stage}:{}),
     ...(intent.nextAction?{nextAction:intent.nextAction}:{}),...(intent.dueDate?{followUpDate:intent.dueDate}:{})};
    if(JSON.stringify(next)!==JSON.stringify(current.profile)){
     const saved=await profiles.update(actor,next,version!,"lead-command-profile:"+snapshot.operationId);version=saved.version;
    }
   }
   const result=leadCommandResultSchema.parse({operationId:snapshot.operationId,personId,state,version,authorityEpoch:snapshot.expectedEpoch,
    noteAppended:state!=="not_lead"&&Boolean(intent.note),nextActionSaved:state!=="not_lead"&&Boolean(intent.nextAction||intent.dueDate),replayed:false,
    projections:{google:intent.google?"unavailable":"not_requested",whatsapp:intent.whatsapp?"unavailable":"not_requested"}});
   await tx.query(`INSERT INTO ls_contact_ops.lead_commands(workspace_id,operation_id,actor_account_id,person_id,authority_epoch,payload_digest,result_ciphertext)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[actor.workspaceId,snapshot.operationId,actor.id,personId,snapshot.expectedEpoch,digest,
     seal(JSON.stringify(result),resultAad(actor.workspaceId,snapshot.operationId),this.keyring)]);
   const current=await readCutoverState(tx,actor.workspaceId,this.keyring,true);
   // Existing composed creation/decision may already advance the counter. This
   // root receipt must not increment it again, nor mutate it on a replay.
   if(current.nativeWritesSinceSwitch===authority.nativeWritesSinceSwitch){
    const advanced=cutoverStateSchema.parse({...current,nativeWritesSinceSwitch:current.nativeWritesSinceSwitch+1});
    await tx.query("UPDATE ls_contact_ops.cutover SET state_ciphertext=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND epoch=$2",
     [actor.workspaceId,current.epoch,seal(JSON.stringify(advanced),cutoverStateAad(actor.workspaceId,current.epoch),this.keyring)]);
   }
   return result;
  });
 }
}
