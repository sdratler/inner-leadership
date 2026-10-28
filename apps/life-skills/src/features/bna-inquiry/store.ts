import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {lockWorkspace,freshActor} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import {systemClock} from "../identity/types.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {BNA_INQUIRY_PROGRAM,bnaAttributionSchema,bnaFollowupCommandSchema,bnaInquiryFieldsSchema,
 type BnaAttribution,type BnaFollowupCommand,type BnaInquiryFields} from "./contract.ts";

type InquiryPayload={program:typeof BNA_INQUIRY_PROGRAM;fields:BnaInquiryFields;attribution:BnaAttribution|null};
type InquiryRow={id:string;ownerAccountId:string;requestDigest:string;payloadCiphertext:string;receivedAt:Date};
type FollowupState={status:"new"|"contacted"|"waiting"|"closed";note:string;nextAction:string|null;dueDate:string|null;waitingCondition:string|null};
type FollowupRow={operationId:string;inquiryId:string;actorAccountId:string;version:number;requestDigest:string;payloadCiphertext:string;recordedAt:Date};
const payloadSchema=z.object({program:z.literal(BNA_INQUIRY_PROGRAM),fields:bnaInquiryFieldsSchema,attribution:bnaAttributionSchema.nullable()}).strict();
const stateSchema=z.object({status:z.enum(["new","contacted","waiting","closed"]),note:z.string().max(5000),
 nextAction:z.string().max(500).nullable(),dueDate:z.iso.date().nullable(),waitingCondition:z.string().max(500).nullable()}).strict();
const inquiryAad=(workspace:string,id:string)=>`ls_service_interest/bna-inquiry/v1/${workspace}/${id}`;
const followupAad=(workspace:string,operation:string)=>`ls_service_interest/bna-followup/v1/${workspace}/${operation}`;
const initialState:FollowupState={status:"new",note:"Inquiry saved for owner review",nextAction:"Review inquiry",dueDate:null,waitingCondition:null};

/** BNA inquiry records share the existing workspace/database and identity keys.
 * They create no Person, Account, permission, message or paid enrollment. */
export class BnaInquiryStore{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,
  private readonly ring:Keyring,private readonly digestKey:string,private readonly ownerAccountId:string,
  private readonly clock:IdentityClock=systemClock){
  if(!z.string().uuid().safeParse(ownerAccountId).success)throw new AppError("UNAVAILABLE");
 }
 private requestDigest(payload:InquiryPayload){return privateDigest({domain:"bna-inquiry/v1",workspace:this.workspaceId,payload},this.digestKey);}
 private contactDigest(fields:BnaInquiryFields){return privateDigest({domain:"bna-inquiry-contact/v1",workspace:this.workspaceId,
  channel:fields.contactChannel,contact:fields.contact},this.digestKey);}
 private decode(row:InquiryRow){
  try{
   const payload=payloadSchema.parse(JSON.parse(unseal(row.payloadCiphertext,inquiryAad(this.workspaceId,row.id),this.ring)));
   if(row.ownerAccountId!==this.ownerAccountId||row.requestDigest!==this.requestDigest(payload))throw new Error();
   return {id:row.id,ownerAccountId:row.ownerAccountId,
    receivedAt:row.receivedAt.toISOString(),...payload};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private decodeFollowup(row:FollowupRow){
  try{
   const state=stateSchema.parse(JSON.parse(unseal(row.payloadCiphertext,followupAad(this.workspaceId,row.operationId),this.ring)));
   if(row.version<1||row.actorAccountId!==this.ownerAccountId)throw new Error();
   return {operationId:row.operationId,inquiryId:row.inquiryId,actorAccountId:row.actorAccountId,
    version:row.version,recordedAt:row.recordedAt.toISOString(),...state};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspaceId||actor.id!==this.ownerAccountId)throw new AppError("NOT_FOUND");
  const fresh=await freshActor(tx,actor,this.clock.now());
  if(fresh.state!=="active"||fresh.role!=="practitioner"||fresh.id!==this.ownerAccountId)throw new AppError("NOT_FOUND");
 }
 private async configuredOwner(tx:SqlSession){
  const rows=await tx.query<{id:string}>("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[this.workspaceId,this.ownerAccountId]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");
 }
 private async inquiry(tx:SqlSession,id:string){
  const rows=await tx.query<InquiryRow>(`SELECT id,owner_account_id AS "ownerAccountId",request_digest AS "requestDigest",
   payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt" FROM ls_service_interest.bna_inquiries
   WHERE workspace_id=$1 AND id=$2 AND program_key='bna_torah_mornings' AND owner_account_id=$3`,
   [this.workspaceId,id,this.ownerAccountId]);
  if(rows.length!==1)throw new AppError("NOT_FOUND");return this.decode(rows[0]!);
 }
 private async history(tx:SqlSession,id:string){
  const rows=await tx.query<FollowupRow>(`SELECT operation_id AS "operationId",inquiry_id AS "inquiryId",
   actor_account_id AS "actorAccountId",version,request_digest AS "requestDigest",
   payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt" FROM ls_service_interest.bna_inquiry_followups
   WHERE workspace_id=$1 AND inquiry_id=$2 ORDER BY version DESC LIMIT 101`,[this.workspaceId,id]);
  if(!rows.length||rows.length>100)throw new AppError("UNAVAILABLE");
  return rows.map(row=>this.decodeFollowup(row));
 }
 async submit(input:{operationId:string;fields:BnaInquiryFields;attribution?:BnaAttribution}){
  const fields=bnaInquiryFieldsSchema.parse(input.fields),attribution=input.attribution?bnaAttributionSchema.parse(input.attribution):null;
  const payload=payloadSchema.parse({program:BNA_INQUIRY_PROGRAM,fields,attribution});
  const requestDigest=this.requestDigest(payload),contactDigest=this.contactDigest(fields),now=this.clock.now();
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);await this.configuredOwner(tx);
   const prior=await tx.query<{inquiryId:string;requestDigest:string}>(`SELECT inquiry_id AS "inquiryId",request_digest AS "requestDigest"
    FROM ls_service_interest.bna_inquiry_operations WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,input.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==requestDigest)throw new AppError("CONFLICT");
    return {saved:true as const,reference:prior[0]!.inquiryId,replayed:true};}
   const counts=await tx.query<{contactCount:number;workspaceCount:number}>(`SELECT
    (SELECT count(*)::int FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND contact_digest=$2 AND received_at>$3::timestamptz-interval '24 hours') AS "contactCount",
    (SELECT count(*)::int FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND received_at>$3::timestamptz-interval '24 hours') AS "workspaceCount"`,
    [this.workspaceId,contactDigest,now]);
   if(!counts[0]||counts[0].contactCount>=4||counts[0].workspaceCount>=250)throw new AppError("RATE_LIMITED");
   const id=randomUUID();
   await tx.query(`INSERT INTO ls_service_interest.bna_inquiries(workspace_id,id,program_key,owner_account_id,contact_digest,
    request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,'bna_torah_mornings',$3,$4,$5,$6,$7,$8,$9)`,
    [this.workspaceId,id,this.ownerAccountId,contactDigest,requestDigest,
     seal(JSON.stringify(payload),inquiryAad(this.workspaceId,id),this.ring),fields.permission.version,fields.permission.language,now]);
   await tx.query(`INSERT INTO ls_service_interest.bna_inquiry_operations(workspace_id,operation_id,request_digest,inquiry_id)
    VALUES($1,$2,$3,$4)`,[this.workspaceId,input.operationId,requestDigest,id]);
   const firstOperation=randomUUID(),firstDigest=privateDigest({domain:"bna-initial-followup/v1",id,state:initialState},this.digestKey);
   await tx.query(`INSERT INTO ls_service_interest.bna_inquiry_followups(workspace_id,operation_id,inquiry_id,actor_account_id,
    version,request_digest,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,1,$5,$6,$7)`,
    [this.workspaceId,firstOperation,id,this.ownerAccountId,firstDigest,
     seal(JSON.stringify(initialState),followupAad(this.workspaceId,firstOperation),this.ring),now]);
   return {saved:true as const,reference:id,replayed:false};
  });
 }
 async list(actor:Actor){
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const rows=await tx.query<InquiryRow>(`SELECT id,owner_account_id AS "ownerAccountId",request_digest AS "requestDigest",
    payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt" FROM ls_service_interest.bna_inquiries
    WHERE workspace_id=$1 AND program_key='bna_torah_mornings' AND owner_account_id=$2 ORDER BY received_at DESC,id DESC LIMIT 101`,
    [this.workspaceId,this.ownerAccountId]);
   if(rows.length>100)throw new AppError("UNAVAILABLE");
   const items=[];
   for(const row of rows){const record=this.decode(row),history=await this.history(tx,row.id);
    items.push({...record,followup:history[0]!});}
   return {program:BNA_INQUIRY_PROGRAM,items};
  });
 }
 async read(actor:Actor,id:string){
  if(!z.string().uuid().safeParse(id).success)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const record=await this.inquiry(tx,id),history=await this.history(tx,id);
   return {...record,followup:history[0]!,history};});
 }
 async followup(actor:Actor,input:BnaFollowupCommand){
  const command=bnaFollowupCommandSchema.parse(input),digest=privateDigest({domain:"bna-followup-command/v1",workspace:this.workspaceId,
   actor:actor.id,command},this.digestKey);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);await this.owner(tx,actor);
   const prior=await tx.query<FollowupRow>(`SELECT operation_id AS "operationId",inquiry_id AS "inquiryId",
    actor_account_id AS "actorAccountId",version,request_digest AS "requestDigest",
    payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt"
    FROM ls_service_interest.bna_inquiry_followups WHERE workspace_id=$1 AND operation_id=$2`,
    [this.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==digest||prior[0]!.actorAccountId!==actor.id)throw new AppError("CONFLICT");
    return {...this.decodeFollowup(prior[0]!),replayed:true};}
   await this.inquiry(tx,command.inquiryId);
   const current=await this.history(tx,command.inquiryId),version=current[0]!.version+1;
   if(command.expectedVersion!==current[0]!.version)throw new AppError("CONFLICT");
   const state=stateSchema.parse({status:command.status,note:command.note,nextAction:command.nextAction,
    dueDate:command.dueDate,waitingCondition:command.waitingCondition}),now=this.clock.now();
   await tx.query(`INSERT INTO ls_service_interest.bna_inquiry_followups(workspace_id,operation_id,inquiry_id,actor_account_id,
    version,request_digest,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [this.workspaceId,command.operationId,command.inquiryId,actor.id,version,digest,
     seal(JSON.stringify(state),followupAad(this.workspaceId,command.operationId),this.ring),now]);
   return {operationId:command.operationId,inquiryId:command.inquiryId,actorAccountId:actor.id,version,
    recordedAt:now.toISOString(),...state,replayed:false};
  });
 }
}
