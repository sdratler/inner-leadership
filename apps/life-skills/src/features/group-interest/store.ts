import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {requirePractitioner} from "../cases/policy.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {interestCommandSchema,interestFieldsSchema,serviceInterestCommandSchema,type InterestCommand,type InterestRecord,
 type ServiceInterestCommand,type ServiceInterestRecord,type VerifiedFamilyMember} from "./contract.ts";
type Row={id:string;recordedBy:string;ciphertext:string;createdAt:Date;requestDigest:string};
type MemberRow={familyId:string;familyCiphertext:string;personId:string;personCiphertext:string};
type ServiceRow=MemberRow&{id:string;serviceType:"group"|"tutoring";sourceInquiryId:string;recordedBy:string;createdAt:Date;requestDigest:string};
const aad=(workspace:string,id:string)=>`ls_service_interest/v1/${workspace}/${id}`;
const select=`SELECT id,recorded_by AS "recordedBy",payload_ciphertext AS ciphertext,
 created_at AS "createdAt",request_digest AS "requestDigest" FROM ls_service_interest.inquiries`;
/** No CRM fallback, contact creation, clinical joins, enrollment, invitations, payment or provider calls. */
export class GroupInterestStore{
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly key:string,
 private readonly clock:IdentityClock=systemClock){}
 private decode(workspace:string,row:Row):InterestRecord{
  try{
   const fields=interestFieldsSchema.parse(JSON.parse(unseal(row.ciphertext,aad(workspace,row.id),this.ring)));
   if(this.digest(workspace,fields)!==row.requestDigest)throw new Error();
   return {id:row.id,recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString(),source:"owner_entered",state:"interest",fields};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private digest(workspace:string,fields:InterestCommand["fields"]){return privateDigest({domain:"group-interest/v1",workspace,fields},this.key);}
 private serviceDigest(workspace:string,command:ServiceInterestCommand){return privateDigest({domain:"service-interest/v1",workspace,
  fields:{inquiryId:command.inquiryId,familyId:command.familyId,personId:command.personId,serviceType:command.serviceType}},this.key);}
 private member(workspace:string,row:MemberRow):VerifiedFamilyMember{
  try{
   const profile:unknown=JSON.parse(unseal(row.personCiphertext,`person:${workspace}:${row.personId}`,this.ring));
   if(!profile||typeof profile!=="object"||!("displayName" in profile)||typeof profile.displayName!=="string"||!profile.displayName.trim())throw new Error();
   const familyLabel=unseal(row.familyCiphertext,`family:${workspace}:${row.familyId}`,this.ring);
   if(!familyLabel.trim())throw new Error();
   return {familyId:row.familyId,familyLabel,personId:row.personId,personLabel:profile.displayName};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private service(workspace:string,row:ServiceRow):ServiceInterestRecord{
  return {id:row.id,state:"service_interest",serviceType:row.serviceType,sourceInquiryId:row.sourceInquiryId,
   ...this.member(workspace,row),recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString()};
 }
 private async read(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.decode(actor.workspaceId,rows[0]!);
 }
 async create(actor:Actor,input:InterestCommand){
  const parsed=interestCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,hash=this.digest(actor.workspaceId,command.fields);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);
   requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{inquiryId:string;requestDigest:string;recordedBy:string}>(`SELECT inquiry_id AS "inquiryId",
    request_digest AS "requestDigest",recorded_by AS "recordedBy" FROM ls_service_interest.operations
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior.length){
    if(prior.length!==1||prior[0]!.requestDigest!==hash||prior[0]!.recordedBy!==actor.id)throw new AppError("CONFLICT");
    return {saved:true as const,replayed:true,duplicate:true,item:await this.read(tx,actor,prior[0]!.inquiryId)};
   }
   const existing=await tx.query<{id:string}>(`SELECT id FROM ls_service_interest.inquiries WHERE workspace_id=$1 AND request_digest=$2`,[actor.workspaceId,hash]);
   if(existing.length>1)throw new AppError("UNAVAILABLE");
   const id=existing[0]?.id??randomUUID();
   if(!existing.length)await tx.query(`INSERT INTO ls_service_interest.inquiries
    (workspace_id,id,recorded_by,request_digest,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6)`,
    [actor.workspaceId,id,actor.id,hash,seal(JSON.stringify(command.fields),aad(actor.workspaceId,id),this.ring),this.clock.now()]);
   await tx.query(`INSERT INTO ls_service_interest.operations(workspace_id,operation_id,recorded_by,request_digest,inquiry_id)
    VALUES($1,$2,$3,$4,$5)`,[actor.workspaceId,command.operationId,actor.id,hash,id]);
   return {saved:true as const,replayed:false,duplicate:existing.length===1,item:await this.read(tx,actor,id)};
  });
 }
 async createServiceInterest(actor:Actor,input:ServiceInterestCommand){
  const parsed=serviceInterestCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,hash=this.serviceDigest(actor.workspaceId,command);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{serviceInterestId:string;requestDigest:string;recordedBy:string}>(`SELECT service_interest_id AS "serviceInterestId",
    request_digest AS "requestDigest",recorded_by AS "recordedBy" FROM ls_service_interest.service_interest_operations
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior.length){
    if(prior.length!==1||prior[0]!.requestDigest!==hash||prior[0]!.recordedBy!==actor.id)throw new AppError("CONFLICT");
    return {saved:true as const,replayed:true,duplicate:true,item:await this.readService(tx,actor,prior[0]!.serviceInterestId)};
   }
   const inquiryRows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,command.inquiryId]);
   if(inquiryRows.length!==1)throw new AppError("NOT_FOUND");
   const inquiry=this.decode(actor.workspaceId,inquiryRows[0]!);
   if(inquiry.fields.serviceType!=="group_and_tutoring"&&inquiry.fields.serviceType!==command.serviceType)throw new AppError("INVALID_REQUEST");
   const member=await tx.query<{ok:boolean}>(`SELECT true AS ok FROM ls_cases.family_members fm
    JOIN ls_identity.people p ON p.workspace_id=fm.workspace_id AND p.id=fm.person_id
    WHERE fm.workspace_id=$1 AND fm.family_id=$2 AND fm.person_id=$3 AND fm.role='child' AND p.kind='minor'`,
    [actor.workspaceId,command.familyId,command.personId]);
   if(member.length!==1)throw new AppError("NOT_FOUND");
   const existing=await tx.query<{id:string}>(`SELECT id FROM ls_service_interest.service_interests
    WHERE workspace_id=$1 AND source_inquiry_id=$2 AND family_id=$3 AND person_id=$4 AND service_type=$5`,
    [actor.workspaceId,command.inquiryId,command.familyId,command.personId,command.serviceType]);
   if(existing.length>1)throw new AppError("UNAVAILABLE");
   const id=existing[0]?.id??randomUUID();
   if(!existing.length)await tx.query(`INSERT INTO ls_service_interest.service_interests
    (workspace_id,id,family_id,person_id,service_type,source_inquiry_id,recorded_by,request_digest,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[actor.workspaceId,id,command.familyId,command.personId,command.serviceType,
     command.inquiryId,actor.id,hash,this.clock.now()]);
   await tx.query(`INSERT INTO ls_service_interest.service_interest_operations
    (workspace_id,operation_id,recorded_by,request_digest,service_interest_id) VALUES($1,$2,$3,$4,$5)`,
    [actor.workspaceId,command.operationId,actor.id,hash,id]);
   return {saved:true as const,replayed:false,duplicate:existing.length===1,item:await this.readService(tx,actor,id)};
  });
 }
 private async readService(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<ServiceRow>(`SELECT s.id,s.service_type AS "serviceType",s.source_inquiry_id AS "sourceInquiryId",
   s.recorded_by AS "recordedBy",s.created_at AS "createdAt",s.request_digest AS "requestDigest",
   s.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",s.person_id AS "personId",p.profile_ciphertext AS "personCiphertext"
   FROM ls_service_interest.service_interests s
   JOIN ls_cases.families f ON f.workspace_id=s.workspace_id AND f.id=s.family_id
   JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id
   WHERE s.workspace_id=$1 AND s.id=$2`,[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.service(actor.workspaceId,rows[0]!);
 }
 async list(actor:Actor){
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51",[actor.workspaceId]);
   const members=await tx.query<MemberRow>(`SELECT fm.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",
    fm.person_id AS "personId",p.profile_ciphertext AS "personCiphertext"
    FROM ls_cases.family_members fm JOIN ls_cases.families f ON f.workspace_id=fm.workspace_id AND f.id=fm.family_id
    JOIN ls_identity.people p ON p.workspace_id=fm.workspace_id AND p.id=fm.person_id
    WHERE fm.workspace_id=$1 AND fm.role='child' AND p.kind='minor' ORDER BY fm.family_id,fm.person_id LIMIT 101`,[actor.workspaceId]);
   const services=await tx.query<ServiceRow>(`SELECT s.id,s.service_type AS "serviceType",s.source_inquiry_id AS "sourceInquiryId",
    s.recorded_by AS "recordedBy",s.created_at AS "createdAt",s.request_digest AS "requestDigest",
    s.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",s.person_id AS "personId",p.profile_ciphertext AS "personCiphertext"
    FROM ls_service_interest.service_interests s
    JOIN ls_cases.families f ON f.workspace_id=s.workspace_id AND f.id=s.family_id
    JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id
    WHERE s.workspace_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 101`,[actor.workspaceId]);
   if(members.length>100||services.length>100)throw new AppError("UNAVAILABLE");
   return {items:rows.slice(0,50).map(row=>this.decode(actor.workspaceId,row)),hasMore:rows.length>50,
    members:members.map(row=>this.member(actor.workspaceId,row)),serviceInterests:services.map(row=>this.service(actor.workspaceId,row))};
  });
 }
}
