import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {lockWorkspace} from "../../identity/data.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock,type WorkspaceId} from "../../identity/types.ts";
import {PublicGroupApplicationStore} from "../../group-application/store.ts";
import {isFloridaGroupApplication,isSchoolInquiry,isTrip390Interest,normalizeFloridaLeadContact,type GroupApplicationRecord} from "../../group-application/contract.ts";
import {decodeStoredGroupApplication,type StoredGroupApplicationRow} from "../../group-application/group-application-record.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {readCutoverState} from "./cutover-state.ts";
import {NativeCrmStore,crmProfileAad,crmProfileSchema,type CrmProfile} from "./native-store.ts";
import {privateDigest} from "./digests.ts";
import {MAX_NATIVE_CONTACTS} from "../core/limits.ts";
import {ACADEMY_CRM_PROGRAM,academyEpoch,academyActivitySchema,academyAdminFieldsSchema,academyContactOriginSchema,
 academyCrmCommandSchema,academyCrmResultSchema,academyManualFieldsSchema,type AcademyActivity,type AcademyContact,
 type AcademyCrmCommand,type AcademyCrmPage,type AcademyCrmResult} from "../core/academy-crm.ts";
import {nextFishingMembership,fishingLabelDesired} from "../core/fishing-lead.ts";
import type {CutoverState} from "../core/cutover.ts";

type Authority=CutoverState&{academy:NonNullable<CutoverState["academy"]>};
type WorkspaceScope={workspaceId:WorkspaceId};
type Frozen<T>=T extends object?{readonly[K in keyof T]:Frozen<T[K]>}:T;
export type AcademyInquiryContactDataInput={workspaceId:WorkspaceId;reference:string;expectedEpoch:number;lock:"shared"|"snapshot"};
export type AcademyInquiryContactData={classification:"current_scope_data_only_not_authority";record:GroupApplicationRecord;
 sourceDigest:string;contact:AcademyContact;authorityEpoch:number;initializationId:string;consistency:"shared"|"snapshot"};
type Admission={personId:string;initializationId:string;kind:"manual"|"inquiry";sourceApplicationId:string|null;
 createdAt:Date;profileCiphertext:string;personCiphertext:string;version:number;recordMode:string;identityKind:string};
type ActivityRow={personId:string;actorId:string;kind:string;version:number;digest:string;ciphertext:string;recordedAt:Date};
const activityAad=(workspace:string,operation:string)=>`ls_contact_ops/academy-activity/v1/${workspace}/${operation}`;
const querySchema=z.object({search:z.string().max(200).default(""),page:z.number().int().min(1).max(100000).default(1)}).strict();
const inquiryContactSchema=z.object({reference:z.string().uuid(),expectedEpoch:academyEpoch,intent:z.enum(["read","write"])}).strict();
const dataUuid=z.uuid().refine(value=>value===value.toLowerCase(),"CANONICAL_UUID_REQUIRED");
const inquiryDataSchema=z.object({workspaceId:dataUuid,reference:dataUuid,expectedEpoch:academyEpoch,lock:z.enum(["shared","snapshot"])}).strict();
const PAGE_SIZE=12;
function freezeData<T>(value:T):Frozen<T>{
 if(value!==null&&typeof value==="object"){for(const child of Object.values(value))freezeData(child);Object.freeze(value);}
 return value as Frozen<T>;
}

/** Academy admission precedes decryption. No workspace-wide phone/email/name
 * match, clinical join, legacy link, imported note or external provider call. */
export class AcademyCrmStore {
 private readonly authority:ContactCutoverStore;
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){
  this.authority=new ContactCutoverStore(db,ring,integrityKey,clock);
 }
 private profiles(tx:SqlSession){return new NativeCrmStore({transaction:work=>work(tx)},this.ring,this.integrityKey,this.clock);}
 private decode<T>(schema:z.ZodType<T>,ciphertext:string,aad:string):T{
  try{return schema.parse(JSON.parse(unseal(ciphertext,aad,this.ring)));}catch{throw new AppError("UNAVAILABLE");}
 }
 private async contacts(tx:SqlSession,scope:WorkspaceScope,state:Authority,personId:string|null=null):Promise<AcademyContact[]>{
  const rows=await tx.query<Admission>(`SELECT a.person_id AS "personId",a.initialization_id AS "initializationId",
   a.source_kind AS kind,a.source_application_id AS "sourceApplicationId",a.created_at AS "createdAt",
   p.payload_ciphertext AS "profileCiphertext",p.version,p.record_mode AS "recordMode",
   i.profile_ciphertext AS "personCiphertext",i.kind AS "identityKind"
   FROM ls_contact_ops.academy_crm_contacts a
   JOIN ls_contact_ops.profiles p ON p.workspace_id=a.workspace_id AND p.person_id=a.person_id
   JOIN ls_identity.people i ON i.workspace_id=a.workspace_id AND i.id=a.person_id
   WHERE a.workspace_id=$1 AND a.initialization_id=$2 AND a.program_key='sunday_fishing_academy'
    AND ($3::uuid IS NULL OR a.person_id=$3::uuid)
   ORDER BY a.person_id LIMIT $4`,[scope.workspaceId,state.academy.operationId,personId,MAX_NATIVE_CONTACTS+1]);
  if(rows.length>MAX_NATIVE_CONTACTS)throw new AppError("UNAVAILABLE");
  return rows.map(row=>{
   const profile=this.decode(crmProfileSchema,row.profileCiphertext,crmProfileAad(scope.workspaceId,row.personId));
   const origin=profile.academyOrigin;
   if(!origin||row.recordMode!=="live"||row.identityKind!=="adult"||!Number.isSafeInteger(row.version)||row.version<1||
    profile.personId!==row.personId||origin.initializationId!==state.academy.operationId||origin.initializationId!==row.initializationId||
    origin.kind!==row.kind||origin.sourceApplicationId!==row.sourceApplicationId||origin.createdAt!==row.createdAt.toISOString())throw new AppError("UNAVAILABLE");
   const person=this.decode(z.object({displayName:z.string().min(1).max(120)}).strict(),row.personCiphertext,`person:${scope.workspaceId}:${row.personId}`);
   return {personId:row.personId,name:person.displayName,version:row.version,origin,
    fields:academyAdminFieldsSchema.parse({stage:profile.stage,nextAction:profile.nextAction,followUpDate:profile.followUpDate,notes:profile.notes}),outboundEligible:false};
  });
 }
 private async contact(tx:SqlSession,scope:WorkspaceScope,state:Authority,personId:string){
  const rows=await this.contacts(tx,scope,state,personId);if(rows.length!==1)throw new AppError("NOT_FOUND");return rows[0]!;
 }
 async list(actor:Actor,input:{search?:string;page?:number}={}):Promise<AcademyCrmPage>{
  const query=querySchema.parse(input),current=await this.authority.read(actor);
  if(current.phase!=="academy_native")return {state:"setup_required",authorityEpoch:current.epoch};
  return this.authority.withAcademy(actor,{intent:"read",expectedEpoch:current.epoch},async(tx,state)=>{
   const all=await this.contacts(tx,actor,state),search=query.search.trim().toLocaleLowerCase();
   const rows=all.filter(row=>!search||[row.name,row.origin.phone??"",row.origin.email??"",row.fields.stage,
    row.fields.nextAction??"",row.fields.notes].some(value=>value.toLocaleLowerCase().includes(search)));
   return {state:"ready",authorityEpoch:state.epoch,items:rows.slice((query.page-1)*PAGE_SIZE,query.page*PAGE_SIZE),
    total:rows.length,page:query.page,pageSize:PAGE_SIZE};
  });
 }
 async read(actor:Actor,personId:string,expectedEpoch:number){
  if(!z.string().uuid().safeParse(personId).success)throw new AppError("INVALID_REQUEST");
  return this.authority.withAcademy(actor,{intent:"read",expectedEpoch},async(tx,state)=>{
   const contact=await this.contact(tx,actor,state,personId);
   const rows=await tx.query<ActivityRow&{operationId:string}>(`SELECT operation_id AS "operationId",person_id AS "personId",
    actor_account_id AS "actorId",kind,result_version AS version,payload_digest AS digest,payload_ciphertext AS ciphertext,
    recorded_at AS "recordedAt" FROM ls_contact_ops.academy_crm_activity
    WHERE workspace_id=$1 AND initialization_id=$2 AND person_id=$3 ORDER BY recorded_at DESC,operation_id DESC LIMIT 51`,
    [actor.workspaceId,state.academy.operationId,personId]);
   const history=rows.slice(0,50).map(row=>this.activity(actor,state,row,row.operationId));
   return {contact,history,historyHasMore:rows.length>50,authorityEpoch:state.epoch};
  });
 }
 private activity(actor:Actor,state:Authority,row:ActivityRow,operationId:string):AcademyActivity{
  const event=this.decode(academyActivitySchema,row.ciphertext,activityAad(actor.workspaceId,operationId));
  if(event.operationId!==operationId||event.result.operationId!==operationId||event.result.personId!==row.personId||
   event.result.version!==row.version||event.result.authorityEpoch!==state.epoch||event.result.replayed||
   event.kind!==row.kind||event.recordedBy!==row.actorId||event.recordedAt!==row.recordedAt.toISOString())throw new AppError("UNAVAILABLE");
  return event;
 }
 private async inquiryRecord(tx:SqlSession,actor:Actor,sourceApplicationId:string){
  const source=new PublicGroupApplicationStore({transaction:work=>work(tx)},actor.workspaceId,this.ring,this.integrityKey,
   this.clock,false,undefined,ACADEMY_CRM_PROGRAM);
  return source.readForOwnerInTransaction(tx,actor,sourceApplicationId);
 }
 private inquiryProjection(scope:WorkspaceScope,sourceApplicationId:string,record:GroupApplicationRecord){
  if(isTrip390Interest(record.fields))return {sourceApplicationId,
   sourceDigest:privateDigest({workspaceId:scope.workspaceId,record},this.integrityKey),
   name:record.fields.guardianName,phone:record.fields.phone??null,email:record.fields.email,language:record.fields.messageLanguage};
  if(!isFloridaGroupApplication(record.fields)||isSchoolInquiry(record.fields)||record.fields.programId!==ACADEMY_CRM_PROGRAM)throw new AppError("NOT_FOUND");
  const raw=record.fields.contact,phone=normalizeFloridaLeadContact(raw),email=raw.includes("@")?raw.trim().toLowerCase():null;
  return {sourceApplicationId,sourceDigest:privateDigest({workspaceId:scope.workspaceId,record},this.integrityKey),
   name:record.fields.parentName,phone,email,language:record.fields.language};
 }
 private async inquiry(tx:SqlSession,actor:Actor,sourceApplicationId:string){
  return this.inquiryProjection(actor,sourceApplicationId,await this.inquiryRecord(tx,actor,sourceApplicationId));
 }
 private async rawOwner(tx:SqlSession,actor:Actor,lock:boolean){
  const rows=await tx.query<{id:string}>(`SELECT a.id FROM ls_identity.sessions s
   JOIN ls_identity.accounts a ON a.workspace_id=s.workspace_id AND a.id=s.account_id
   JOIN ls_identity.account_subjects subject ON subject.workspace_id=a.workspace_id AND subject.account_id=a.id
   WHERE s.workspace_id=$1 AND s.account_id=$2 AND s.token_digest=$3 AND subject.person_id=$4
    AND s.revoked_at IS NULL AND s.expires_at>GREATEST($5::timestamptz,clock_timestamp())
    AND a.state='active' AND a.role='practitioner'${lock?" FOR SHARE OF s,a,subject":""}`,
   [actor.workspaceId,actor.id,actor.sessionDigest,actor.personId,this.clock.now()]);
  if(rows.length!==1)throw new AppError("UNAUTHENTICATED");
 }
 private async inquiryContact(tx:SqlSession,actor:Actor,state:Authority,reference:string,lock:boolean){
  const record=await this.inquiryRecord(tx,actor,reference);
  return this.inquiryContactFromRecord(tx,actor,state,reference,record,lock);
 }
 private async inquiryContactFromRecord(tx:SqlSession,scope:WorkspaceScope,state:Authority,reference:string,record:GroupApplicationRecord,lock:boolean){
  const source=this.inquiryProjection(scope,reference,record);
  const admitted=await tx.query<{personId:string}>(`SELECT a.person_id AS "personId" FROM ls_contact_ops.academy_crm_contacts a
   JOIN ls_contact_ops.profiles p ON p.workspace_id=a.workspace_id AND p.person_id=a.person_id
   JOIN ls_identity.people i ON i.workspace_id=a.workspace_id AND i.id=a.person_id
   JOIN ls_service_interest.public_applications r ON r.workspace_id=a.workspace_id AND r.id=a.source_application_id
   WHERE a.workspace_id=$1 AND a.initialization_id=$2 AND a.program_key='sunday_fishing_academy'
    AND a.source_kind='inquiry' AND a.source_application_id=$3${lock?" FOR SHARE OF a,p,i,r":""}`,
   [scope.workspaceId,state.academy.operationId,reference]);
  if(!admitted.length)throw new AppError("NOT_FOUND");if(admitted.length!==1)throw new AppError("UNAVAILABLE");
  const contact=await this.contact(tx,scope,state,admitted[0]!.personId);
  if(contact.origin.kind!=="inquiry"||contact.origin.sourceApplicationId!==reference||
   contact.origin.sourceDigest!==source.sourceDigest)throw new AppError("CONFLICT");
  return {record,sourceDigest:source.sourceDigest,contact};
 }
 /** Supplied-TX data only, after the caller independently authenticates its
  * real owner or service. This opens no transaction and supplies no access,
  * legal guardian, recipient, financial or sending authority. Root owns fresh
  * current-v4/native/clock/isolation/permission and terminal validation. */
 async readInquiryContactDataInTransaction(tx:SqlSession,input:AcademyInquiryContactDataInput):Promise<Frozen<AcademyInquiryContactData>>{
  const parsed=inquiryDataSchema.safeParse(input);
  if(!parsed.success||!tx||typeof tx.query!=="function")throw new AppError("INVALID_REQUEST");
  const request=Object.freeze(parsed.data),scope=Object.freeze({workspaceId:request.workspaceId as WorkspaceId});
  const currentTx:SqlSession=Object.freeze({query:tx.query.bind(tx)});
  try{
   if(request.lock==="shared"){
    // Native can already hold the workspace lock. Never wait on the existing
    // contact fence in reverse owner-wrapper order; fail before row locks.
    const fence=await currentTx.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",[`${scope.workspaceId}:contact-authority`]);
    if(fence.length!==1||fence[0]!.locked!==true)throw new AppError("CONFLICT");
    const held=await currentTx.query("SELECT workspace_id FROM ls_contact_ops.cutover WHERE workspace_id=$1 FOR SHARE",[scope.workspaceId]);
    if(held.length!==1)throw new AppError("CONFLICT");
   }
   const state=await readCutoverState(currentTx,scope.workspaceId,this.ring,false);
   if(state.phase!=="academy_native"||!state.academy||state.academy.program!==ACADEMY_CRM_PROGRAM||state.epoch!==request.expectedEpoch)throw new AppError("CONFLICT");
   const rows=await currentTx.query<StoredGroupApplicationRow>(`SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt"
    FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2`,[scope.workspaceId,request.reference]);
   if(rows.length===0)throw new AppError("NOT_FOUND");if(rows.length!==1)throw new AppError("UNAVAILABLE");
   const record=decodeStoredGroupApplication(scope.workspaceId,rows[0]!,this.ring,this.integrityKey);
   const data=await this.inquiryContactFromRecord(currentTx,scope,{...state,academy:state.academy},request.reference,record,request.lock==="shared");
   return freezeData({classification:"current_scope_data_only_not_authority" as const,...data,authorityEpoch:state.epoch,
    initializationId:state.academy.operationId,consistency:request.lock});
  }catch(error){
   if(error&&typeof error==="object"&&"code" in error&&["42P01","42703","3F000"].includes(String(error.code)))throw new AppError("UNAVAILABLE");
   throw error;
  }
 }
 /** Internal provenance port, never an HTTP response or guardian/recipient/
  * financial permission. All callback IO uses the admitted existing transaction. */
 async withInquiryContact<T>(actor:Actor,input:{reference:string;expectedEpoch:number;intent:"read"|"write"},
  work:(context:{tx:SqlSession;record:GroupApplicationRecord;sourceDigest:string;contact:AcademyContact;authorityEpoch:number})=>Promise<T>):Promise<T>{
  const parsed=inquiryContactSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const request=parsed.data,owner=Object.freeze({...actor});
  let observed:{tx:SqlSession;initializationId:string;personId:string;sourceDigest:string;contactDigest:string}|undefined;
  return this.authority.withAcademy(owner,{intent:request.intent,expectedEpoch:request.expectedEpoch},async(tx,state)=>{
   // PostgreSQL forbids row locks in READ ONLY. READ keeps genuine database
   // enforcement plus joined entry/terminal validation; WRITE holds these rows.
   await this.rawOwner(tx,owner,request.intent==="write");
   const source=await this.inquiryContact(tx,owner,state,request.reference,request.intent==="write");
   observed={tx,initializationId:state.academy.operationId,personId:source.contact.personId,
    sourceDigest:source.sourceDigest,contactDigest:privateDigest(source.contact,this.integrityKey)};
   const callbackTx:SqlSession=Object.freeze({query:tx.query.bind(tx)});
   return work(Object.freeze({tx:callbackTx,...source,authorityEpoch:state.epoch}));
  },async tx=>{
   if(!observed||observed.tx!==tx)throw new AppError("UNAVAILABLE");
   const state=await readCutoverState(tx,owner.workspaceId,this.ring,false);
   if(state.phase!=="academy_native"||!state.academy||state.epoch!==request.expectedEpoch||
    state.academy.program!==ACADEMY_CRM_PROGRAM||state.academy.operationId!==observed.initializationId)throw new AppError("CONFLICT");
   const current=await this.inquiryContact(tx,owner,{...state,academy:state.academy},request.reference,false);
   if(current.sourceDigest!==observed.sourceDigest||current.contact.personId!==observed.personId||
    privateDigest(current.contact,this.integrityKey)!==observed.contactDigest)throw new AppError("CONFLICT");
   // This is the final DB operation, AFTER callback and Cutover counter IO.
   await this.rawOwner(tx,owner,false);
  });
 }
 async previewInquiry(actor:Actor,sourceApplicationId:string,expectedEpoch:number){
  if(!z.string().uuid().safeParse(sourceApplicationId).success)throw new AppError("INVALID_REQUEST");
  return this.authority.withAcademy(actor,{intent:"read",expectedEpoch},async(tx,state)=>{
   const source=await this.inquiry(tx,actor,sourceApplicationId);
   const admitted=await tx.query<{personId:string}>(`SELECT person_id AS "personId" FROM ls_contact_ops.academy_crm_contacts
    WHERE workspace_id=$1 AND initialization_id=$2 AND program_key='sunday_fishing_academy' AND source_application_id=$3`,
    [actor.workspaceId,state.academy.operationId,sourceApplicationId]);
   const existingPersonId=admitted[0]?(await this.contact(tx,actor,state,admitted[0].personId)).personId:null;
   return {...source,existingPersonId};
  });
 }
 async execute(actor:Actor,input:AcademyCrmCommand):Promise<AcademyCrmResult>{
  const command=academyCrmCommandSchema.parse(input);
  const digest=privateDigest({actorId:actor.id,workspaceId:actor.workspaceId,command},this.integrityKey);
  return this.authority.withAcademy(actor,{intent:"write",expectedEpoch:command.expectedEpoch},async(tx,state)=>{
   await lockWorkspace(tx,actor.workspaceId);
   const prior=await tx.query<ActivityRow>(`SELECT person_id AS "personId",actor_account_id AS "actorId",kind,
    result_version AS version,payload_digest AS digest,payload_ciphertext AS ciphertext,recorded_at AS "recordedAt"
    FROM ls_contact_ops.academy_crm_activity WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior[0]){
    const row=prior[0];if(row.digest!==digest||row.actorId!==actor.id)throw new AppError("CONFLICT");
    await this.contact(tx,actor,state,row.personId);
    return {...this.activity(actor,state,row,command.operationId).result,replayed:true};
   }
   const now=this.clock.now();let personId:string,version:number,kind:AcademyActivity["kind"],text="";
   if(command.action==="create"||command.action==="from_inquiry"){
    const observed=command.action==="from_inquiry"?await this.inquiry(tx,actor,command.sourceApplicationId):null;
    if(observed&&command.action==="from_inquiry"&&observed.sourceDigest!==command.sourceDigest)throw new AppError("CONFLICT");
    const fields=academyManualFieldsSchema.parse(observed?{name:observed.name,phone:observed.phone,email:observed.email,
     language:observed.language,relationship:"guardian",...command.fields}:command.fields);
    // Identity accounts and retired records are intentionally outside matching.
    // A shared endpoint never links accounts, guardians, cases or permissions.
    const existing=await this.contacts(tx,actor,state);
    if(existing.length>=MAX_NATIVE_CONTACTS)throw new AppError("UNAVAILABLE");
    if(existing.some(row=>fields.phone!==null&&row.origin.phone===fields.phone||fields.email!==null&&row.origin.email===fields.email))throw new AppError("CONFLICT");
    if(observed){const used=await tx.query("SELECT person_id FROM ls_contact_ops.academy_crm_contacts WHERE workspace_id=$1 AND source_application_id=$2",[actor.workspaceId,observed.sourceApplicationId]);
     if(used.length)throw new AppError("CONFLICT");}
    personId=randomUUID();
    const origin=academyContactOriginSchema.parse({kind:observed?"inquiry":"manual",program:ACADEMY_CRM_PROGRAM,
     initializationId:state.academy.operationId,sourceApplicationId:observed?.sourceApplicationId??null,
     sourceDigest:observed?.sourceDigest??null,language:fields.language,phone:fields.phone,email:fields.email,createdAt:now.toISOString()});
    await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",
     [personId,actor.workspaceId,seal(JSON.stringify({displayName:fields.name}),`person:${actor.workspaceId}:${personId}`,this.ring),now]);
    const profile:CrmProfile={personId,stage:fields.stage,nextAction:fields.nextAction,followUpDate:fields.followUpDate,
     notes:fields.notes,legacyIds:[],academyOrigin:origin};
    const created=await this.profiles(tx).create(actor,profile,"academy-profile:"+command.operationId);version=created.version;
    const membership=nextFishingMembership(null,{action:"add",workspaceId:actor.workspaceId,personId,program:ACADEMY_CRM_PROGRAM,
     expectedVersion:0,relationship:fields.relationship,source:observed?{kind:"inquiry",id:observed.sourceApplicationId}:{kind:"person",id:personId},
     permission:{state:"unknown"},recordedAt:now.toISOString(),recordedBy:actor.id});
    await tx.query(`INSERT INTO ls_contact_ops.fishing_lead_revisions(workspace_id,program_key,person_id,version,previous_version,state,
     source_application_id,recorded_by,payload_ciphertext,created_at) VALUES($1,$2,$3,1,NULL,'active',$4,$5,$6,$7)`,
     [actor.workspaceId,ACADEMY_CRM_PROGRAM,personId,observed?.sourceApplicationId??null,actor.id,
      seal(JSON.stringify(membership),`ls_contact_ops/fishing-membership/v1/${actor.workspaceId}/${ACADEMY_CRM_PROGRAM}/${personId}/1`,this.ring),now]);
    const projection=fishingLabelDesired(membership,null);
    await tx.query(`INSERT INTO ls_contact_ops.fishing_label_projection(workspace_id,program_key,person_id,generation,membership_state,
     desired_present,status,payload_ciphertext,unresolved_effect) VALUES($1,$2,$3,1,'active',true,'unconfigured',$4,false)`,
     [actor.workspaceId,ACADEMY_CRM_PROGRAM,personId,seal(JSON.stringify(projection),
      `ls_contact_ops/fishing-label/v1/${actor.workspaceId}/${ACADEMY_CRM_PROGRAM}/${personId}/1`,this.ring)]);
    await tx.query(`INSERT INTO ls_contact_ops.academy_crm_contacts(workspace_id,initialization_id,program_key,person_id,
     source_kind,source_application_id,membership_version,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8)`,
     [actor.workspaceId,state.academy.operationId,ACADEMY_CRM_PROGRAM,personId,origin.kind,origin.sourceApplicationId,actor.id,now]);
    kind="created";
   }else{
    personId=command.personId;const current=await this.contact(tx,actor,state,personId);
    if(current.version!==command.expectedVersion)throw new AppError("CONFLICT");
    if(command.action==="update"){
     const saved=await this.profiles(tx).read(actor,personId);if(!saved)throw new AppError("NOT_FOUND");
     const updated=await this.profiles(tx).update(actor,{...saved.profile,...command.fields},command.expectedVersion,"academy-profile:"+command.operationId);
     version=updated.version;kind="updated";
    }else{version=current.version;kind="note";text=command.text;}
   }
   const result=academyCrmResultSchema.parse({personId,version,operationId:command.operationId,authorityEpoch:state.epoch,
    replayed:false,outboundEligible:false});
   const fields=command.action==="note"?undefined:academyAdminFieldsSchema.parse({stage:command.fields.stage,
    nextAction:command.fields.nextAction,followUpDate:command.fields.followUpDate,notes:command.fields.notes});
   const event=academyActivitySchema.parse({operationId:command.operationId,kind,recordedAt:now.toISOString(),recordedBy:actor.id,text,result,fields});
   await tx.query(`INSERT INTO ls_contact_ops.academy_crm_activity(workspace_id,initialization_id,operation_id,person_id,
    actor_account_id,kind,result_version,payload_digest,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [actor.workspaceId,state.academy.operationId,command.operationId,personId,actor.id,kind,version,digest,
     seal(JSON.stringify(event),activityAad(actor.workspaceId,command.operationId),this.ring),now]);
   return result;
  });
 }
}
