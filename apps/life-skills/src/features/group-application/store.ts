import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {requirePractitioner} from "../cases/policy.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import type {IdentityClock,Actor} from "../identity/types.ts";
import {systemClock} from "../identity/types.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {groupApplicationCommandSchema,groupApplicationReplaySchema,groupApplicationFieldsSchema,floridaParentApplicationFieldsSchema,isFloridaGroupApplication,type GroupApplicationCommand,type GroupApplicationFields,type GroupApplicationRecord} from "./contract.ts";
import {queueInquiryEmail} from "./inquiry-email.ts";
import {readEducationalChildContexts} from '../fishing/native-child-context.ts';
import {readAcademyFamilyReceipts} from '../fishing/academy-family-receipts.ts';
import {academyDriveMinutes} from './academy-intake.ts';

type Row={id:string;requestDigest:string;payloadCiphertext:string;receivedAt:Date};
const aad=(workspace:string,id:string)=>`ls_service_interest/public_application/v1/${workspace}/${id}`;
const select=`SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt"
 FROM ls_service_interest.public_applications`;
const reviewQuerySchema=z.object({search:z.string().trim().max(200).default(""),cursor:z.string().uuid().optional()}).strict();
export type GroupApplicationReviewQuery=z.input<typeof reviewQuerySchema>;
export type GroupApplicationReviewPage={items:GroupApplicationRecord[];nextCursor:string|null};

/** Private inquiry only; optional administrative outbox is atomic and never sends here. */
export class PublicGroupApplicationStore{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,
  private readonly digestKey:string,private readonly clock:IdentityClock=systemClock,private readonly emailQueueEnabled=false){}
 private requestDigest(fields:GroupApplicationFields){return privateDigest({domain:"public-group-application/v1",workspace:this.workspaceId,fields},this.digestKey);}
 private contactDigest(fields:GroupApplicationFields){return isFloridaGroupApplication(fields)?
  privateDigest({domain:"public-group-application-contact/v1",workspace:this.workspaceId,contact:fields.contact},this.digestKey):
  privateDigest({domain:"public-group-application-contact/v1",workspace:this.workspaceId,phone:fields.parentPhone},this.digestKey);}
 private decode(row:Row):GroupApplicationRecord{
  try{
   const fields=groupApplicationFieldsSchema.parse(JSON.parse(unseal(row.payloadCiphertext,aad(this.workspaceId,row.id),this.ring)));
   if(this.requestDigest(fields)!==row.requestDigest)throw new Error();
   return {id:row.id,source:"public_group_application",state:"owner_review",receivedAt:row.receivedAt.toISOString(),fields};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private async read(tx:SqlSession,id:string){const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND id=$2",[this.workspaceId,id]);if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.decode(rows[0]!);}
 async replaySaved(input:{operationId:string;fields:GroupApplicationFields}){
  const parsed=groupApplicationReplaySchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,digest=this.requestDigest(command.fields);
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");
   const rows=await tx.query<{applicationId:string;requestDigest:string}>(`SELECT application_id AS "applicationId",request_digest AS "requestDigest"
    FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,command.operationId]);
   if(rows.length===0)return null;if(rows.length!==1)throw new AppError("UNAVAILABLE");
   if(rows[0]!.requestDigest!==digest)throw new AppError("CONFLICT");
   return {saved:true as const,replayed:true,duplicate:true,item:await this.read(tx,rows[0]!.applicationId)};
  });
 }
 async submit(input:GroupApplicationCommand){
  const parsed=groupApplicationCommandSchema.safeParse(input);
  if(!parsed.success){const prior=await this.replaySaved(input);if(prior)return prior;throw new AppError("INVALID_REQUEST");}
  const command=parsed.data,requestDigest=this.requestDigest(command.fields),contactDigest=this.contactDigest(command.fields);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);
   const prior=await tx.query<{applicationId:string;requestDigest:string}>(`SELECT application_id AS "applicationId",request_digest AS "requestDigest"
    FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==requestDigest)throw new AppError("CONFLICT");return {saved:true as const,replayed:true,duplicate:true,item:await this.read(tx,prior[0]!.applicationId)};}
   const existing=await tx.query<{id:string}>(`SELECT id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND request_digest=$2`,[this.workspaceId,requestDigest]);
   if(existing.length>1)throw new AppError("UNAVAILABLE");
   if(existing.length===1){
    const applicationId=existing[0]!.id;
    const aliases=await tx.query<{count:number}>("SELECT count(*)::int AS count FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND application_id=$2",[this.workspaceId,applicationId]);
    if(!aliases[0]||aliases[0].count>=100)throw new AppError("RATE_LIMITED");
    // A new-key duplicate also needs an immutable operation receipt. Otherwise
    // that key could later submit different content and escape replay conflict.
    await tx.query("INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)",
     [this.workspaceId,command.operationId,requestDigest,applicationId]);
    return {saved:true as const,replayed:false,duplicate:true,item:await this.read(tx,applicationId)};
   }
   const now=this.clock.now(),id=randomUUID();
   {
    const recent=await tx.query<{contactCount:number;workspaceCount:number}>(`SELECT
     (SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND contact_digest=$2 AND received_at>$3::timestamptz-interval '24 hours') AS "contactCount",
     (SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND received_at>$3::timestamptz-interval '24 hours') AS "workspaceCount"`,[this.workspaceId,contactDigest,now]);
    if(!recent[0]||recent[0].contactCount>=4||recent[0].workspaceCount>=250)throw new AppError("RATE_LIMITED");
    await tx.query(`INSERT INTO ls_service_interest.public_applications
     (workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[this.workspaceId,id,contactDigest,requestDigest,
      seal(JSON.stringify(command.fields),aad(this.workspaceId,id),this.ring),command.fields.permission.version,command.fields.permission.language,now]);
   }
   await tx.query(`INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id)
    VALUES($1,$2,$3,$4)`,[this.workspaceId,command.operationId,requestDigest,id]);
   const acknowledgment=this.emailQueueEnabled?await queueInquiryEmail(tx,this.workspaceId,id,command.fields,this.ring,now):undefined;
   return {saved:true as const,replayed:false,duplicate:false,item:await this.read(tx,id),...(acknowledgment?{acknowledgment}:{})};
  });
 }
 async list(actor:Actor):Promise<GroupApplicationRecord[]>{
  if(actor.workspaceId!==this.workspaceId)throw new AppError("FORBIDDEN");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 ORDER BY received_at DESC,id DESC LIMIT 50",[actor.workspaceId]);return rows.map(row=>this.decode(row));});
 }
 /** Search encrypted inquiry fields only after fresh practitioner/workspace
  * authorization. Bound each scan, retaining a cursor even for an empty match
  * page so older inquiries are reachable without a plaintext search index. */
 async listPage(actor:Actor,input:GroupApplicationReviewQuery={}):Promise<GroupApplicationReviewPage>{
  if(actor.workspaceId!==this.workspaceId)throw new AppError("FORBIDDEN");
  const parsed=reviewQuerySchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const {cursor,search}=parsed.data,needle=search.normalize("NFKC").toLocaleLowerCase();
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   if(cursor){const anchor=await tx.query("SELECT id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2",[this.workspaceId,cursor]);if(anchor.length!==1)throw new AppError("INVALID_REQUEST");}
   // Anchor on the stored timestamp, avoiding timestamp precision loss across
   // pages. The UUID and its subquery remain inside the authorized workspace.
   const rows=await tx.query<Row>(select+" WHERE workspace_id=$1"+(cursor?" AND (received_at,id)<(SELECT received_at,id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2)":"")+" ORDER BY received_at DESC,id DESC LIMIT 201",cursor?[this.workspaceId,cursor]:[this.workspaceId]);
   const items:GroupApplicationRecord[]=[];let scanned=0;
   while(scanned<Math.min(rows.length,200)&&items.length<50){
    const item=this.decode(rows[scanned++]!);
    if(!needle||JSON.stringify({id:item.id,fields:item.fields}).normalize("NFKC").toLocaleLowerCase().includes(needle))items.push(item);
   }
   return {items,nextCursor:scanned<rows.length?rows[scanned-1]!.id:null};
  });
 }
 async readForOwnerInTransaction(tx:SqlSession,actor:Actor,id:string):Promise<GroupApplicationRecord>{
  if(actor.workspaceId!==this.workspaceId)throw new AppError("FORBIDDEN");
  if(!z.string().uuid().safeParse(id).success)throw new AppError("INVALID_REQUEST");
  requirePractitioner(await freshActor(tx,actor,this.clock.now()));
  const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND id=$2",[this.workspaceId,id]);
  if(rows.length===0)throw new AppError("NOT_FOUND");if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.decode(rows[0]!);
 }
 /** Server-private input to the native travel-credit authority. No HTTP mount,
  * full inquiry, sibling details, owner impersonation or caller-supplied proof.
  * The exact saved family command selects the inquiry; ambiguous follow-up
  * applications require an explicit binding rather than a first-row fallback.
  */
 async readAcademyParentDriveInTransaction(tx:SqlSession,actor:Actor,selectedLearnerId:string){
  try{
   if(actor.workspaceId!==this.workspaceId)throw new AppError('FORBIDDEN');
   const parsedId=z.uuid().safeParse(selectedLearnerId);if(!parsedId.success)throw new AppError('INVALID_REQUEST');const learnerId=parsedId.data.toLowerCase();
   await readEducationalChildContexts(tx,actor,this.ring,this.clock.now(),learnerId);
   const matches=(await readAcademyFamilyReceipts(tx,this.workspaceId,this.ring)).filter(r=>r.saved.parentAccountId===actor.id&&r.saved.children.some(c=>c.learnerId===learnerId));
   if(matches.length===0)throw new AppError('NOT_FOUND');if(matches.length!==1)throw new AppError('CONFLICT');
   const receipt=matches[0]!,{saved,command}=receipt,children=saved.children.filter(c=>c.learnerId===learnerId);
   if(saved.personId!==actor.personId||children.length!==1||saved.children.length!==command.children.length||saved.children.some((child,i)=>{
    const selected=command.children[i];return !selected||child.learnerIndex!==i||selected.learnerIndex!==i||child.displayName!==selected.displayName||child.registrationChildId!==selected.registrationChildId||selected.existingLearnerId!==null&&selected.existingLearnerId!==child.learnerId;
   }))throw new AppError('CONFLICT');
   const child=children[0]!,members=await tx.query(`SELECT c.person_id FROM ls_cases.family_members c
    JOIN ls_cases.family_members p ON p.workspace_id=c.workspace_id AND p.family_id=c.family_id AND p.person_id=$4 AND p.role IN('parent','guardian')
    JOIN ls_identity.account_subjects s ON s.workspace_id=p.workspace_id AND s.person_id=p.person_id AND s.account_id=$5
    WHERE c.workspace_id=$1 AND c.family_id=$2 AND c.person_id=$3 AND c.role='child' FOR SHARE OF c,p,s`,[this.workspaceId,saved.householdId,learnerId,saved.personId,actor.id]);
   if(members.length!==1)throw new AppError('FORBIDDEN');
   const rows=await tx.query<Row>(select+' WHERE workspace_id=$1 AND id=$2 FOR SHARE',[this.workspaceId,saved.applicationId]);
   if(rows.length!==1)throw new AppError('UNAVAILABLE');
   // decode verifies both AEAD and the private keyed request digest. Unsealing
   // alone or trusting a copied fields hash would lose the original binding.
   const fields=floridaParentApplicationFieldsSchema.safeParse(this.decode(rows[0]!).fields);
   if(!fields.success||fields.data.programId!=='sunday_fishing_academy')throw new AppError('UNAVAILABLE');
   const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),fieldsDigest=hash(fields.data);
   if(fieldsDigest!==command.expectedFieldsDigest)throw new AppError('CONFLICT');
   const registration=fields.data.academyRegistration,intake=fields.data.academyIntake;
   if(registration){if(registration.learners[child.learnerIndex]?.id!==child.registrationChildId)throw new AppError('CONFLICT');}
   else if(!intake||!fields.data.academyFit||!intake.learners[child.learnerIndex]||intake.learners.some(c=>c.ageYears===undefined)||child.registrationChildId!==undefined)throw new AppError('CONFLICT');
   const sourceVersion=registration?.version??intake!.version,recordedDriveLimit=registration?registration.driveMinutes:intake!.driveLimit;
   const maximumOneWayMinutes=typeof recordedDriveLimit==='number'?recordedDriveLimit:academyDriveMinutes(recordedDriveLimit)??null;
   const value={workspaceId:this.workspaceId,applicationId:saved.applicationId,fieldsDigest,learnerIndex:child.learnerIndex,learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId,
    ...(child.registrationChildId?{registrationChildId:child.registrationChildId}:{}),familyReceipt:{actorId:receipt.actorId,operationId:receipt.operationId,requestDigest:receipt.hash},
    sourceVersion,recordedDriveLimit,maximumOneWayMinutes,drivePreferenceDigest:hash({sourceVersion,recordedDriveLimit})};
   await readEducationalChildContexts(tx,actor,this.ring,this.clock.now(),learnerId);return value;
  }catch(error){if(error instanceof AppError)throw error;throw new AppError('UNAVAILABLE');}
 }
}
