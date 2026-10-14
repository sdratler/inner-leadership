import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {freshActor,lockWorkspace} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {PublicGroupApplicationStore} from "../../group-application/store.ts";
import {isFloridaGroupApplication,isSchoolInquiry,normalizeFloridaLeadContact} from "../../group-application/contract.ts";
import {fishingProgramSchema,inquiryContactPermissionSchema} from "../core/fishing-association-contract.ts";
import {fishingLeadRequestSchema,fishingLeadSourceSchema,fishingMembershipSchema,fishingLeadResultSchema,
 fishingLabelProjectionSchema,fishingLabelDesired,nextFishingMembership,type FishingMembership,
 type FishingLeadRequest,type FishingLeadResult,type FishingLabelProjection} from "../core/fishing-lead.ts";
import {NativeContactDirectory,type NativeContactRow} from "./native-directory.ts";
import {OperationalNativeCrmStore} from "./operational-store.ts";
import {readCutoverState,cutoverStateSchema,cutoverStateAad} from "./cutover-state.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {writeDestination} from "../core/cutover.ts";
import {privateDigest} from "./digests.ts";
import {normalizePhone} from "../core/contact-resolution.ts";

const uuid=z.string().uuid(),version=z.number().int().min(1).max(2147483646),PREVIEW_MS=15*60_000;
const snapshotSchema=z.object({operationId:uuid,workspaceId:uuid,actorId:uuid,program:fishingProgramSchema,
 expectedEpoch:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),action:z.enum(["add","remove"]),
 expectedVersion:z.number().int().min(0).max(2147483645),personId:uuid.nullable(),profileVersion:version.nullable(),
 name:z.string().min(1).max(1000),phone:z.string().refine(v=>normalizePhone(v)===v).nullable(),
 source:fishingLeadSourceSchema,sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),
 relationship:z.enum(["guardian","adult_partner"]),permission:inquiryContactPermissionSchema,
 createdAt:z.iso.datetime(),expiresAt:z.iso.datetime()}).strict()
 .refine(v=>(v.personId===null)===(v.profileVersion===null)&&Date.parse(v.expiresAt)-Date.parse(v.createdAt)===PREVIEW_MS&&
  (v.personId!==null||v.action==="add"&&v.phone!==null&&v.expectedVersion===0));
type Snapshot=z.infer<typeof snapshotSchema>;
export type FishingLeadPreview={state:"ready";token:string;operationId:string;name:string;phone:string|null;
 personId:string|null;newPerson:boolean;action:"add"|"remove";expectedVersion:number;expiresAt:string}|
 {state:"clarify";reason:"email_only"|"identity"|"reserved";choices:{personId:string;name:string}[]};
export type FishingLeadContext={state:"ready";epoch:number;personId:string|null;membership:FishingMembership|null;projection:FishingLabelProjection|null}|
 {state:"blocked";epoch:number;reason:"native_authority_required"|"email_only"|"identity"|"reserved";choices:{personId:string;name:string}[]};
const clarify=(reason:Extract<FishingLeadPreview,{state:"clarify"}>["reason"],choices:{personId:string;name:string}[]=[]):FishingLeadPreview=>({state:"clarify",reason,choices});
const previewAad=(a:Actor,p:string)=>`ls_contact_ops/fishing-preview/v1/${a.workspaceId}/${a.id}/${p}`;
const membershipAad=(w:string,p:string,id:string,v:number)=>`ls_contact_ops/fishing-membership/v1/${w}/${p}/${id}/${v}`;
const operationAad=(w:string,id:string)=>`ls_contact_ops/fishing-operation/v1/${w}/${id}`;
const projectionAad=(w:string,p:string,id:string,v:number)=>`ls_contact_ops/fishing-label/v1/${w}/${p}/${id}/${v}`;
type StoredMembership={personId:string;program:string;version:number;state:string;sourceApplicationId:string|null;
 recordedBy:string;createdAt:Date;ciphertext:string};
const membershipSelect=`SELECT person_id AS "personId",program_key AS program,version,state,
 source_application_id AS "sourceApplicationId",recorded_by AS "recordedBy",created_at AS "createdAt",payload_ciphertext AS ciphertext
 FROM ls_contact_ops.fishing_lead_revisions`;

/** Program is constructor-bound by a strict retained route, never a mutation
 * body. Only the current native authority can commit administrative membership.
 * This store has NO provider, task, Sheet, clinical or access-grant dependency. */
export class FishingLeadStore{
 private readonly directory:NativeContactDirectory;
 private readonly authority:ContactCutoverStore;
 private readonly program:z.infer<typeof fishingProgramSchema>;
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly integrityKey:string,
  program:z.infer<typeof fishingProgramSchema>,private readonly clock:IdentityClock=systemClock){
  this.program=fishingProgramSchema.parse(program);
  this.directory=new NativeContactDirectory(db,ring,clock);this.authority=new ContactCutoverStore(db,ring,integrityKey,clock);
 }
 private async lockWrite(tx:SqlSession,actor:Actor,epoch:number){
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${actor.workspaceId}:contact-authority`]);
  await lockWorkspace(tx,actor.workspaceId);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
  const state=await readCutoverState(tx,actor.workspaceId,this.ring,true);
  if(state.epoch!==epoch||writeDestination(state.phase)!=="native")throw new AppError("CONFLICT");return state;
 }
 private inquiries(actor:Actor,tx:SqlSession){
  return new PublicGroupApplicationStore({transaction:work=>work(tx)},actor.workspaceId,this.ring,this.integrityKey,this.clock);
 }
 private decode<T>(schema:z.ZodType<T>,ciphertext:string,aad:string):T{
  try{return schema.parse(JSON.parse(unseal(ciphertext,aad,this.ring)));}catch{throw new AppError("UNAVAILABLE");}
 }
 private async current(tx:SqlSession,actor:Actor,personId:string):Promise<FishingMembership|null>{
  const rows=await tx.query<StoredMembership>(membershipSelect+" WHERE workspace_id=$1 AND program_key=$2 AND person_id=$3 ORDER BY version DESC LIMIT 1",
   [actor.workspaceId,this.program,personId]);const row=rows[0];if(!row)return null;
  const value=this.decode(fishingMembershipSchema,row.ciphertext,membershipAad(actor.workspaceId,this.program,personId,row.version));
  if(value.workspaceId!==actor.workspaceId||value.program!==row.program||value.personId!==row.personId||value.version!==row.version||
   value.state!==row.state||value.recordedBy!==row.recordedBy||value.recordedAt!==row.createdAt.toISOString()||
   (value.source.kind==="inquiry"?value.source.id:null)!==row.sourceApplicationId)throw new AppError("UNAVAILABLE");
  return value;
 }
 private async projection(tx:SqlSession,actor:Actor,personId:string,membership:FishingMembership|null):Promise<FishingLabelProjection|null>{
  const rows=await tx.query<{generation:number;state:string;desiredPresent:boolean;status:string;ciphertext:string}>(`SELECT generation,
   membership_state AS state,desired_present AS "desiredPresent",status,payload_ciphertext AS ciphertext
   FROM ls_contact_ops.fishing_label_projection WHERE workspace_id=$1 AND program_key=$2 AND person_id=$3`,[actor.workspaceId,this.program,personId]);
  if((membership===null)!==(rows.length===0)||rows.length>1)throw new AppError("UNAVAILABLE");
  if(!rows[0])return null;const row=rows[0];
  const projection=this.decode(fishingLabelProjectionSchema,row.ciphertext,projectionAad(actor.workspaceId,this.program,personId,row.generation));
  if(projection.workspaceId!==actor.workspaceId||projection.program!==this.program||projection.personId!==personId||projection.generation!==membership!.version||
   projection.generation!==row.generation||projection.status!==row.status||projection.desiredPresent!==row.desiredPresent||
   row.state!==membership!.state||projection.desiredPresent!==(membership!.state==="active"))throw new AppError("UNAVAILABLE");
  return projection;
 }
 private async ordinaryPerson(tx:SqlSession,actor:Actor,personId:string,forAdd:boolean):Promise<NativeContactRow>{
  const page=await this.directory.listInTransaction(tx,actor,{view:"all",search:"",mode:"live",personId,
   today:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(this.clock.now()),page:1,pageSize:1});
  const row=page.items[0];if(!row||row.personId!==personId||row.mode!=="live"||row.identityKind!=="adult"||row.version===null)
   throw new AppError("FORBIDDEN");
  if(forAdd){
   const clinical=await tx.query("SELECT id FROM ls_cases.clients WHERE workspace_id=$1 AND person_id=$2 LIMIT 1",[actor.workspaceId,personId]);
   if(row.administrativelyArchived||row.archived||clinical.length)throw new AppError("FORBIDDEN");
  }
  // DNC is intentionally not cleared or treated as consent. Internal membership
  // never grants outbound eligibility, and this boundary never edits the profile.
  return row;
 }
 private async choices(tx:SqlSession,actor:Actor,people:readonly {personId:string;displayName:string}[]){
  if(people.length>30)throw new AppError("UNAVAILABLE");const choices:{personId:string;name:string}[]=[];
  for(const person of people){try{const row=await this.ordinaryPerson(tx,actor,person.personId,true);choices.push({personId:row.personId,name:row.displayName});}
   catch(error){if(!(error instanceof AppError&&error.code==="FORBIDDEN"))throw error;}}
  return choices;
 }
 private async source(tx:SqlSession,actor:Actor,source:Snapshot["source"]){
  if(source.kind==="person"){
   const row=await this.ordinaryPerson(tx,actor,source.id,true);
   return {name:row.displayName,phone:null,sourceDigest:privateDigest({source,personId:row.personId,version:row.version},this.integrityKey)};
  }
  const record=await this.inquiries(actor,tx).readForOwnerInTransaction(tx,actor,source.id);
  if(!isFloridaGroupApplication(record.fields)||record.fields.programId!==this.program)throw new AppError("FORBIDDEN");
  return {name:isSchoolInquiry(record.fields)?record.fields.contactName:record.fields.parentName,
   phone:normalizeFloridaLeadContact(record.fields.contact),sourceDigest:privateDigest({source,record},this.integrityKey)};
 }
 async preview(actor:Actor,input:Exclude<FishingLeadRequest,{action:"confirm"}>):Promise<FishingLeadPreview>{
  const request=fishingLeadRequestSchema.parse(input);if(request.action==="confirm")throw new AppError("INVALID_REQUEST");
  return this.authority.withDestination(actor,{destination:"native",intent:"read",expectedEpoch:request.expectedEpoch},async tx=>{
   const now=this.clock.now();let personId:string|null=null,phone:string|null=null,name:string,profileVersion:number|null=null;
   let source:Snapshot["source"],sourceDigest:string,relationship:Snapshot["relationship"],permission:Snapshot["permission"]={state:"unknown"};
   if(request.action==="preview_remove"){
    personId=request.personId;const row=await this.ordinaryPerson(tx,actor,personId,false),current=await this.current(tx,actor,personId);
    if(!current||current.state!=="active"||current.version!==request.expectedAssociationVersion)throw new AppError("CONFLICT");
    name=row.displayName;profileVersion=row.version;source=current.source;sourceDigest=privateDigest({membership:current},this.integrityKey);
    relationship=current.relationship;permission=current.permission;
   }else{
    source=request.source;relationship=request.relationship;const observed=await this.source(tx,actor,source);
    phone=observed.phone;name=observed.name;sourceDigest=observed.sourceDigest;
    if(source.kind==="person")personId=source.id;
    else{
     if(!phone)return clarify("email_only");
     const match=(await this.directory.acquisitionMatchesInTransaction(tx,actor,[phone])).get(phone)!;
     if(match.state==="reserved")return clarify("reserved");
     if(request.selectedPersonId){if(!match.people.some(p=>p.personId===request.selectedPersonId))return clarify("identity");personId=request.selectedPersonId;}
     else if(match.state==="ambiguous")return clarify("identity",await this.choices(tx,actor,match.people));
     else if(match.state==="existing")personId=match.people[0]?.personId??null;
     else if(await this.directory.hasPhoneClaimInTransaction(tx,actor,phone))return clarify("reserved");
    }
    if(personId){const row=await this.ordinaryPerson(tx,actor,personId,true);name=row.displayName;profileVersion=row.version;
     if(phone&&!row.references.some(ref=>normalizePhone(ref.phone)===phone))return clarify("identity");
     const current=await this.current(tx,actor,personId);
     if((current?.version??0)!==request.expectedAssociationVersion||current?.state==="active")throw new AppError("CONFLICT");
     if(current?.permission.state==="withdrawn")permission=current.permission;
    }else if(request.expectedAssociationVersion!==0)throw new AppError("CONFLICT");
   }
   const snapshot=snapshotSchema.parse({operationId:request.operationId,workspaceId:actor.workspaceId,actorId:actor.id,program:this.program,
    expectedEpoch:request.expectedEpoch,expectedVersion:request.expectedAssociationVersion,action:request.action==="preview_add"?"add":"remove",
    personId,profileVersion,name,phone,source,sourceDigest,relationship,permission,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+PREVIEW_MS).toISOString()});
   return {state:"ready",token:seal(JSON.stringify(snapshot),previewAad(actor,this.program),this.ring),operationId:snapshot.operationId,
    name,phone,personId,newPerson:personId===null,action:snapshot.action,expectedVersion:snapshot.expectedVersion,expiresAt:snapshot.expiresAt};
  });
 }
 async confirm(actor:Actor,input:Extract<FishingLeadRequest,{action:"confirm"}>):Promise<FishingLeadResult>{
  const request=fishingLeadRequestSchema.parse(input);if(request.action!=="confirm")throw new AppError("INVALID_REQUEST");
  let snapshot:Snapshot;try{snapshot=snapshotSchema.parse(JSON.parse(unseal(request.token,previewAad(actor,this.program),this.ring)));}
  catch{throw new AppError("INVALID_REQUEST");}
  if(snapshot.workspaceId!==actor.workspaceId||snapshot.actorId!==actor.id||snapshot.program!==this.program||
   request.confirmNewPerson!==(snapshot.personId===null))throw new AppError("INVALID_REQUEST");
  const digest=privateDigest({actorId:actor.id,workspace:actor.workspaceId,program:this.program,request},this.integrityKey);
  return this.db.transaction(async tx=>{
   const authority=await this.lockWrite(tx,actor,snapshot.expectedEpoch);
   const prior=await tx.query<{digest:string;actorId:string;program:string;personId:string;version:number;ciphertext:string}>(`SELECT payload_digest AS digest,
    actor_account_id AS "actorId",program_key AS program,person_id AS "personId",result_version AS version,result_ciphertext AS ciphertext
    FROM ls_contact_ops.fishing_lead_operations WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,snapshot.operationId]);
   if(prior.length){const p=prior[0]!;if(prior.length!==1||p.digest!==digest||p.actorId!==actor.id||p.program!==this.program)throw new AppError("CONFLICT");
    const result=this.decode(fishingLeadResultSchema,p.ciphertext,operationAad(actor.workspaceId,snapshot.operationId));
    if(result.operationId!==snapshot.operationId||result.workspaceId!==actor.workspaceId||result.program!==this.program||result.personId!==p.personId||
     result.version!==p.version||result.authorityEpoch!==snapshot.expectedEpoch||result.replayed)throw new AppError("UNAVAILABLE");
    return {...result,replayed:true}; // Historical success never writes the current head.
   }
   const now=this.clock.now();if(now.getTime()<Date.parse(snapshot.createdAt)||now.getTime()>=Date.parse(snapshot.expiresAt))throw new AppError("CONFLICT");
   let personId=snapshot.personId,current: FishingMembership|null=null;
   if(snapshot.action==="add"){
    const source=await this.source(tx,actor,snapshot.source);if(source.sourceDigest!==snapshot.sourceDigest||source.phone!==snapshot.phone)throw new AppError("CONFLICT");
    if(snapshot.phone){
     const matching=(await this.directory.acquisitionMatchesInTransaction(tx,actor,[snapshot.phone])).get(snapshot.phone)!;
     if(matching.state==="reserved"||(personId?!matching.people.some(p=>p.personId===personId):matching.state!=="unmatched"))throw new AppError("CONFLICT");
    }
   }
   if(personId){const row=await this.ordinaryPerson(tx,actor,personId,snapshot.action==="add");
    if(row.version!==snapshot.profileVersion||row.displayName!==snapshot.name)throw new AppError("CONFLICT");
    current=await this.current(tx,actor,personId);
    if(snapshot.action==="remove"&&privateDigest({membership:current},this.integrityKey)!==snapshot.sourceDigest)throw new AppError("CONFLICT");
   }else{
    if(!snapshot.phone||await this.directory.hasPhoneClaimInTransaction(tx,actor,snapshot.phone))throw new AppError("CONFLICT");
    const scoped:IdentityStore={transaction:work=>work(tx)};
    const created=await new OperationalNativeCrmStore(scoped,this.ring,this.integrityKey,this.clock).createContact(actor,
     {name:snapshot.name,phone:snapshot.phone,language:"",source:"Owner-reviewed fishing inquiry",notes:"",nextAction:"",dueDate:""},
     snapshot.operationId,snapshot.expectedEpoch);personId=created.personId;
   }
   const priorProjection=await this.projection(tx,actor,personId,current);
   let membership:FishingMembership;
   try{membership=nextFishingMembership(current,{...snapshot,personId,expectedVersion:snapshot.expectedVersion,recordedAt:now.toISOString(),recordedBy:actor.id});}
   catch{throw new AppError("CONFLICT");}
   await tx.query(`INSERT INTO ls_contact_ops.fishing_lead_revisions(workspace_id,program_key,person_id,version,previous_version,state,
    source_application_id,recorded_by,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [actor.workspaceId,this.program,personId,membership.version,current?.version??null,membership.state,
     membership.source.kind==="inquiry"?membership.source.id:null,actor.id,
     seal(JSON.stringify(membership),membershipAad(actor.workspaceId,this.program,personId,membership.version),this.ring),now]);
   // Preserve a genuinely persisted managed binding for later Remove/Restore.
   // No configured binding is invented, and no provider runs in this transaction.
   const desired=fishingLabelDesired(membership,priorProjection?.binding??null);
   const projected=await tx.query(`INSERT INTO ls_contact_ops.fishing_label_projection(workspace_id,program_key,person_id,generation,membership_state,
    desired_present,status,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(workspace_id,program_key,person_id) DO UPDATE SET generation=EXCLUDED.generation,membership_state=EXCLUDED.membership_state,
     desired_present=EXCLUDED.desired_present,status=EXCLUDED.status,payload_ciphertext=EXCLUDED.payload_ciphertext,updated_at=clock_timestamp()
     WHERE ls_contact_ops.fishing_label_projection.generation<EXCLUDED.generation RETURNING generation`,
    [actor.workspaceId,this.program,personId,membership.version,membership.state,desired.desiredPresent,desired.status,
     seal(JSON.stringify(desired),projectionAad(actor.workspaceId,this.program,personId,membership.version),this.ring)]);
   if(projected.length!==1)throw new AppError("CONFLICT");
   const result=fishingLeadResultSchema.parse({operationId:snapshot.operationId,workspaceId:actor.workspaceId,program:this.program,
    personId,version:membership.version,state:membership.state,authorityEpoch:snapshot.expectedEpoch,newPerson:snapshot.personId===null,
    replayed:false,tasksCreated:0,outboundEligible:false});
   await tx.query(`INSERT INTO ls_contact_ops.fishing_lead_operations(workspace_id,operation_id,actor_account_id,authority_epoch,program_key,
    person_id,result_version,payload_digest,result_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [actor.workspaceId,snapshot.operationId,actor.id,snapshot.expectedEpoch,this.program,personId,membership.version,digest,
     seal(JSON.stringify(result),operationAad(actor.workspaceId,snapshot.operationId),this.ring)]);
   // Composed canonical creation already advances the same counter once. A
   // membership-only write advances it here; historical replay returns above
   // without any counter, projection, profile or receipt write.
   const finalAuthority=await readCutoverState(tx,actor.workspaceId,this.ring,true);
   if(finalAuthority.nativeWritesSinceSwitch===authority.nativeWritesSinceSwitch){
    const advanced=cutoverStateSchema.parse({...finalAuthority,nativeWritesSinceSwitch:finalAuthority.nativeWritesSinceSwitch+1});
    const updated=await tx.query(`UPDATE ls_contact_ops.cutover SET state_ciphertext=$3,updated_at=clock_timestamp()
     WHERE workspace_id=$1 AND epoch=$2 RETURNING workspace_id`,
     [actor.workspaceId,finalAuthority.epoch,seal(JSON.stringify(advanced),cutoverStateAad(actor.workspaceId,finalAuthority.epoch),this.ring)]);
    if(updated.length!==1)throw new AppError("CONFLICT");
   }else if(finalAuthority.nativeWritesSinceSwitch!==authority.nativeWritesSinceSwitch+1)throw new AppError("CONFLICT");
   return result;
  });
 }
 async read(actor:Actor,personId:string,expectedEpoch:number):Promise<{membership:FishingMembership|null;projection:FishingLabelProjection|null}>{
  if(!uuid.safeParse(personId).success)throw new AppError("INVALID_REQUEST");
  return this.authority.withDestination(actor,{destination:"native",intent:"read",expectedEpoch},async tx=>{
   await this.ordinaryPerson(tx,actor,personId,false);const membership=await this.current(tx,actor,personId);
   return {membership,projection:await this.projection(tx,actor,personId,membership)};
  });
 }
 async context(actor:Actor,source:Snapshot["source"]):Promise<FishingLeadContext>{
  source=fishingLeadSourceSchema.parse(source);const state=await this.authority.read(actor);
  if(writeDestination(state.phase)!=="native")return {state:"blocked",epoch:state.epoch,reason:"native_authority_required",choices:[]};
  return this.authority.withDestination(actor,{destination:"native",intent:"read",expectedEpoch:state.epoch},async tx=>{
   let personId:string|null=source.kind==="person"?source.id:null;
   if(source.kind==="inquiry"){
    const observed=await this.source(tx,actor,source);if(!observed.phone)return {state:"blocked",epoch:state.epoch,reason:"email_only",choices:[]};
    const matching=(await this.directory.acquisitionMatchesInTransaction(tx,actor,[observed.phone])).get(observed.phone)!;
    if(matching.state==="reserved")return {state:"blocked",epoch:state.epoch,reason:"reserved",choices:[]};
    if(matching.state==="ambiguous")return {state:"blocked",epoch:state.epoch,reason:"identity",choices:await this.choices(tx,actor,matching.people)};
    if(matching.state==="existing")personId=matching.people[0]?.personId??null;
   }
   if(!personId)return {state:"ready",epoch:state.epoch,personId:null,membership:null,projection:null};
   try{await this.ordinaryPerson(tx,actor,personId,true);}catch(error){if(error instanceof AppError&&error.code==="FORBIDDEN")
    return {state:"blocked",epoch:state.epoch,reason:"reserved",choices:[]};throw error;}
   const membership=await this.current(tx,actor,personId);
   return {state:"ready",epoch:state.epoch,personId,membership,projection:await this.projection(tx,actor,personId,membership)};
  });
 }
}
