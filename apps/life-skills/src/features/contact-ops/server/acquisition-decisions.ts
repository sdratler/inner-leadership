import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {freshActor,lockWorkspace} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {acquisitionDecisionSchema,type AcquisitionDecision,type AcquisitionDecisionResult,type AcquisitionPage} from "../core/acquisition.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {AcquisitionCandidateStore} from "./acquisition-store.ts";
import {NativeContactDirectory} from "./native-directory.ts";
import {crmProfileSchema,crmProfileAad} from "./native-store.ts";
import {readCutoverState,cutoverStateAad,cutoverStateSchema} from "./cutover-state.ts";
import {writeDestination} from "../core/cutover.ts";
import {privateDigest} from "./digests.ts";
import {linkCallActivity} from "./call-events-store.ts";

const resultSchema=z.object({candidateId:z.string().uuid(),state:z.enum(["PROMOTED","MATCHED","NOT_A_LEAD"]),
 personId:z.string().uuid().nullable(),version:z.number().int().min(1).nullable(),authorityEpoch:z.number().int().min(0),
 replayed:z.literal(false),projections:z.object({google:z.literal("pending"),whatsapp:z.literal("pending"),reason:z.literal("provider_not_verified")}).strict().nullable()}).strict()
 .refine(v=>v.state==="NOT_A_LEAD"?v.personId===null&&v.version===null&&v.projections===null:v.personId!==null&&v.version!==null&&v.projections!==null);
const resultAad=(workspace:string,operation:string)=>`ls_contact_ops/acquisition-decision/v1/${workspace}/${operation}`;
/** No network, external label write, identity/account grant, clinical join or
 * task dispatch. Fresh practitioner and exact native epoch are checked inside
 * the same transaction as the decision, person/profile and authority counter.
 */
export class AcquisitionDecisionStore{
 private readonly candidates:AcquisitionCandidateStore;
 private readonly directory:NativeContactDirectory;
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){
  this.candidates=new AcquisitionCandidateStore(db,keyring,integrityKey,clock);
  this.directory=new NativeContactDirectory(db,keyring,clock);
 }
 async list(actor:Actor,expectedEpoch:number,input:{page:number;search:string}):Promise<AcquisitionPage>{
  if(!Number.isSafeInteger(input.page)||input.page<1||input.page>100000||input.search.length>200)throw new AppError("INVALID_REQUEST");
  return new ContactCutoverStore(this.db,this.keyring,this.integrityKey,this.clock)
   .withDestination(actor,{destination:"native",intent:"read",expectedEpoch},async tx=>{
    const query=input.search.trim().toLocaleLowerCase();
    const window=await this.candidates.pendingInTransaction(tx,actor);
    const candidates=window.items.filter(row=>!query||
     row.metadata.displayName.toLocaleLowerCase().includes(query)||row.metadata.phone.includes(query));
    const pageSize=12,pages=Math.max(1,Math.ceil(candidates.length/pageSize)),page=Math.min(input.page,pages);
    const selected=candidates.slice((page-1)*pageSize,page*pageSize);
    const matches=await this.directory.acquisitionMatchesInTransaction(tx,actor,selected.map(row=>row.metadata.phone));
    return {items:selected.map(row=>({...row.metadata,state:"NEEDS_REVIEW" as const,matching:matches.get(row.metadata.phone)!})),
     total:candidates.length,page,pages,authorityEpoch:expectedEpoch,hasMore:window.hasMore};
   });
 }
 private async bindThread(tx:SqlSession,workspace:string,keys:{binding:string;thread:string;sender:string},personId:string){
  await tx.query(`INSERT INTO ls_contact_ops.inbound_threads(workspace_id,provider_binding_id,provider_thread_key,sender_endpoint_key,person_id)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,provider_binding_id,provider_thread_key) DO NOTHING`,
   [workspace,keys.binding,keys.thread,keys.sender,personId]);
  const rows=await tx.query<{personId:string;sender:string}>(`SELECT person_id AS "personId",sender_endpoint_key AS sender
   FROM ls_contact_ops.inbound_threads WHERE workspace_id=$1 AND provider_binding_id=$2 AND provider_thread_key=$3`,[workspace,keys.binding,keys.thread]);
  if(rows.length!==1||rows[0]!.personId!==personId||rows[0]!.sender!==keys.sender)throw new AppError("CONFLICT");
 }
 async decide(actor:Actor,input:AcquisitionDecision):Promise<AcquisitionDecisionResult>{
  const parsed=acquisitionDecisionSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,digest=privateDigest({command,workspace:actor.workspaceId,actor:actor.id},this.integrityKey);
  return this.db.transaction(async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${actor.workspaceId}:contact-authority`]);
   // Identity logout/revocation uses this same workspace row lock. Recheck only
   // after acquiring it so a queued decision cannot use pre-revocation facts.
   await lockWorkspace(tx,actor.workspaceId);
   requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const authority=await readCutoverState(tx,actor.workspaceId,this.keyring,true);
   if(authority.epoch!==command.expectedEpoch||writeDestination(authority.phase)!=="native")throw new AppError("CONFLICT");
   const previous=await tx.query<{digest:string;actorId:string;candidateId:string;state:string;personId:string|null;ciphertext:string}>(`SELECT
    payload_digest AS digest,actor_account_id AS "actorId",candidate_id AS "candidateId",state,person_id AS "personId",result_ciphertext AS ciphertext
    FROM ls_contact_ops.lead_promotion_operations WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(previous.length>1)throw new AppError("UNAVAILABLE");
   if(previous[0]){
    const prior=previous[0];if(prior.digest!==digest||prior.actorId!==actor.id||prior.candidateId!==command.candidateId)throw new AppError("CONFLICT");
    let saved:z.infer<typeof resultSchema>;try{saved=resultSchema.parse(JSON.parse(unseal(prior.ciphertext,resultAad(actor.workspaceId,command.operationId),this.keyring)));}
    catch{throw new AppError("UNAVAILABLE");}
    if(saved.state!==prior.state||saved.personId!==prior.personId||saved.candidateId!==command.candidateId||saved.authorityEpoch!==command.expectedEpoch)throw new AppError("UNAVAILABLE");
    return {...saved,replayed:true};
   }
   const done=await tx.query("SELECT operation_id FROM ls_contact_ops.lead_promotion_operations WHERE workspace_id=$1 AND candidate_id=$2",[actor.workspaceId,command.candidateId]);
   if(done.length)throw new AppError("CONFLICT");
   const candidate=await this.candidates.getInTransaction(tx,actor.workspaceId,command.candidateId),metadata=candidate.metadata;
   // Call-link storage was added after the original WhatsApp acquisition
   // decision frame. Only Nomad candidates can have this competing decision;
   // keeping the lookup source-specific preserves verified historical-migration
   // tests without masking a missing call table in a current Nomad deployment.
   if(metadata.source==="android_nomad"&&
    (await tx.query("SELECT candidate_id FROM ls_contact_ops.call_activity_links WHERE workspace_id=$1 AND candidate_id=$2",[actor.workspaceId,command.candidateId])).length)throw new AppError("CONFLICT");
   let personId:string|null=null,version:number|null=null;
   if(command.action!=="not_lead"){
    const match=(await this.directory.acquisitionMatchesInTransaction(tx,actor,[metadata.phone])).get(metadata.phone)!;
    if(command.action==="match"){
     const selected=match.people.find(person=>person.personId===command.personId);
     if(!selected?.eligible||match.state==="reserved"||selected.version!==command.expectedVersion)throw new AppError("CONFLICT");
     personId=selected.personId;version=selected.version; // Existing name, notes and workflow facts remain unchanged.
    }else{
     if(match.state!=="unmatched"||await this.directory.hasPhoneClaimInTransaction(tx,actor,metadata.phone))throw new AppError("CONFLICT");
     personId=randomUUID();version=1;const fields=command.fields;
     const origin=metadata.source==="android_nomad"?{nativeInquiry:{origin:"native_manual",leadId:"LS-LEAD-native-"+personId,
      phone:metadata.phone,language:fields.language,source:"Phone · Nomad",createdAt:metadata.occurredAt}}:
      {whatsappInquiry:{origin:"native_whatsapp",leadId:"LS-WAPI-native-"+personId,
       phone:metadata.phone,language:fields.language,source:"WhatsApp",createdAt:metadata.occurredAt,
       providerBindingKey:candidate.binding,providerThreadKey:candidate.thread}};
     const profile=crmProfileSchema.parse({personId,stage:fields.stage,notes:fields.note,nextAction:fields.nextAction||null,
      followUpDate:fields.dueDate||null,legacyIds:[],...origin});
     await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",
      [personId,actor.workspaceId,seal(JSON.stringify({displayName:fields.name}),`person:${actor.workspaceId}:${personId}`,this.keyring),this.clock.now()]);
     await tx.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'live',NULL)",
      [actor.workspaceId,personId,seal(JSON.stringify(profile),crmProfileAad(actor.workspaceId,personId),this.keyring)]);
    }
    if(metadata.source==="android_nomad")await linkCallActivity(tx,actor.workspaceId,metadata.id,personId!);
    else await this.bindThread(tx,actor.workspaceId,candidate,personId!);
   }
   const result=resultSchema.parse({candidateId:metadata.id,state:command.action==="promote"?"PROMOTED":command.action==="match"?"MATCHED":"NOT_A_LEAD",
    personId,version,authorityEpoch:command.expectedEpoch,replayed:false,
    projections:personId?{google:"pending",whatsapp:"pending",reason:"provider_not_verified"}:null});
   await tx.query(`INSERT INTO ls_contact_ops.lead_promotion_operations(workspace_id,operation_id,candidate_id,actor_account_id,
    authority_epoch,payload_digest,state,person_id,result_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [actor.workspaceId,command.operationId,metadata.id,actor.id,command.expectedEpoch,digest,result.state,personId,
     seal(JSON.stringify(result),resultAad(actor.workspaceId,command.operationId),this.keyring)]);
   if(personId)for(const channel of ["google_contacts","whatsapp"])await tx.query(`INSERT INTO ls_contact_ops.acquisition_projection_status
    (workspace_id,operation_id,channel,state,reason) VALUES($1,$2,$3,'pending','provider_not_verified')`,[actor.workspaceId,command.operationId,channel]);
   if(authority.nativeWritesSinceSwitch>=Number.MAX_SAFE_INTEGER-1)throw new AppError("UNAVAILABLE");
   const next=cutoverStateSchema.parse({...authority,nativeWritesSinceSwitch:authority.nativeWritesSinceSwitch+1});
   const advanced=await tx.query("UPDATE ls_contact_ops.cutover SET state_ciphertext=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND epoch=$2 RETURNING epoch::text",
    [actor.workspaceId,authority.epoch,seal(JSON.stringify(next),cutoverStateAad(actor.workspaceId,authority.epoch),this.keyring)]);
   if(advanced.length!==1)throw new AppError("CONFLICT");
   return result;
  });
 }
}
