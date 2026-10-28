import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {lockWorkspace} from "../../identity/data.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {PublicGroupApplicationStore} from "../../group-application/store.ts";
import {isFloridaGroupApplication,isSchoolInquiry,normalizeFloridaLeadContact} from "../../group-application/contract.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {NativeCrmStore,crmProfileAad,crmProfileSchema,type CrmProfile} from "./native-store.ts";
import {privateDigest} from "./digests.ts";
import {MAX_NATIVE_CONTACTS} from "../core/limits.ts";
import {ACADEMY_CRM_PROGRAM,academyActivitySchema,academyAdminFieldsSchema,academyContactOriginSchema,
 academyCrmCommandSchema,academyCrmResultSchema,academyManualFieldsSchema,type AcademyActivity,type AcademyContact,
 type AcademyCrmCommand,type AcademyCrmPage,type AcademyCrmResult} from "../core/academy-crm.ts";
import {nextFishingMembership,fishingLabelDesired} from "../core/fishing-lead.ts";
import type {CutoverState} from "../core/cutover.ts";

type Authority=CutoverState&{academy:NonNullable<CutoverState["academy"]>};
type Admission={personId:string;initializationId:string;kind:"manual"|"inquiry";sourceApplicationId:string|null;
 createdAt:Date;profileCiphertext:string;personCiphertext:string;version:number;recordMode:string;identityKind:string};
type ActivityRow={personId:string;actorId:string;kind:string;version:number;digest:string;ciphertext:string;recordedAt:Date};
const activityAad=(workspace:string,operation:string)=>`ls_contact_ops/academy-activity/v1/${workspace}/${operation}`;
const querySchema=z.object({search:z.string().max(200).default(""),page:z.number().int().min(1).max(100000).default(1)}).strict();
const PAGE_SIZE=12;

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
 private async contacts(tx:SqlSession,actor:Actor,state:Authority,personId:string|null=null):Promise<AcademyContact[]>{
  const rows=await tx.query<Admission>(`SELECT a.person_id AS "personId",a.initialization_id AS "initializationId",
   a.source_kind AS kind,a.source_application_id AS "sourceApplicationId",a.created_at AS "createdAt",
   p.payload_ciphertext AS "profileCiphertext",p.version,p.record_mode AS "recordMode",
   i.profile_ciphertext AS "personCiphertext",i.kind AS "identityKind"
   FROM ls_contact_ops.academy_crm_contacts a
   JOIN ls_contact_ops.profiles p ON p.workspace_id=a.workspace_id AND p.person_id=a.person_id
   JOIN ls_identity.people i ON i.workspace_id=a.workspace_id AND i.id=a.person_id
   WHERE a.workspace_id=$1 AND a.initialization_id=$2 AND a.program_key='sunday_fishing_academy'
    AND ($3::uuid IS NULL OR a.person_id=$3::uuid)
   ORDER BY a.person_id LIMIT $4`,[actor.workspaceId,state.academy.operationId,personId,MAX_NATIVE_CONTACTS+1]);
  if(rows.length>MAX_NATIVE_CONTACTS)throw new AppError("UNAVAILABLE");
  return rows.map(row=>{
   const profile=this.decode(crmProfileSchema,row.profileCiphertext,crmProfileAad(actor.workspaceId,row.personId));
   const origin=profile.academyOrigin;
   if(!origin||row.recordMode!=="live"||row.identityKind!=="adult"||!Number.isSafeInteger(row.version)||row.version<1||
    profile.personId!==row.personId||origin.initializationId!==state.academy.operationId||origin.initializationId!==row.initializationId||
    origin.kind!==row.kind||origin.sourceApplicationId!==row.sourceApplicationId||origin.createdAt!==row.createdAt.toISOString())throw new AppError("UNAVAILABLE");
   const person=this.decode(z.object({displayName:z.string().min(1).max(120)}).strict(),row.personCiphertext,`person:${actor.workspaceId}:${row.personId}`);
   return {personId:row.personId,name:person.displayName,version:row.version,origin,
    fields:academyAdminFieldsSchema.parse({stage:profile.stage,nextAction:profile.nextAction,followUpDate:profile.followUpDate,notes:profile.notes}),outboundEligible:false};
  });
 }
 private async contact(tx:SqlSession,actor:Actor,state:Authority,personId:string){
  const rows=await this.contacts(tx,actor,state,personId);if(rows.length!==1)throw new AppError("NOT_FOUND");return rows[0]!;
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
 private async inquiry(tx:SqlSession,actor:Actor,sourceApplicationId:string){
  const source=new PublicGroupApplicationStore({transaction:work=>work(tx)},actor.workspaceId,this.ring,this.integrityKey,
   this.clock,false,undefined,ACADEMY_CRM_PROGRAM);
  const record=await source.readForOwnerInTransaction(tx,actor,sourceApplicationId);
  if(!isFloridaGroupApplication(record.fields)||isSchoolInquiry(record.fields)||record.fields.programId!==ACADEMY_CRM_PROGRAM)throw new AppError("NOT_FOUND");
  const raw=record.fields.contact,phone=normalizeFloridaLeadContact(raw),email=raw.includes("@")?raw.trim().toLowerCase():null;
  return {sourceApplicationId,sourceDigest:privateDigest({workspaceId:actor.workspaceId,record},this.integrityKey),
   name:record.fields.parentName,phone,email,language:record.fields.language};
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
