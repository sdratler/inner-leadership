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

import {BNA_COOP_PROGRAM,BNA_COOP_NOTICE,bnaCoopReadableFieldsSchema,type BnaCoopFields} from "./coop-contract.ts";
type InquiryPayload={program:typeof BNA_INQUIRY_PROGRAM;fields:BnaInquiryFields;attribution:BnaAttribution|null}|{program:typeof BNA_COOP_PROGRAM;fields:BnaCoopFields;attribution:BnaAttribution|null};
type InquiryRow={id:string;programKey:string;ownerAccountId:string;requestDigest:string;payloadCiphertext:string;receivedAt:Date};
type FollowupState={status:"new"|"contacted"|"waiting"|"closed";note:string;nextAction:string|null;dueDate:string|null;waitingCondition:string|null};
type FollowupRow={operationId:string;inquiryId:string;actorAccountId:string;version:number;requestDigest:string;payloadCiphertext:string;recordedAt:Date};
const payloadSchema=z.discriminatedUnion("program",[
 z.object({program:z.literal(BNA_INQUIRY_PROGRAM),fields:bnaInquiryFieldsSchema,attribution:bnaAttributionSchema.nullable()}).strict(),
 z.object({program:z.literal(BNA_COOP_PROGRAM),fields:bnaCoopReadableFieldsSchema,attribution:bnaAttributionSchema.nullable()}).strict()]);
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
 private contactDigest(fields:BnaInquiryFields|BnaCoopFields){return privateDigest({domain:"bna-inquiry-contact/v1",workspace:this.workspaceId,
  channel:fields.contactChannel,contact:fields.contact},this.digestKey);}
 private decode(row:InquiryRow){
  try{
   const payload=payloadSchema.parse(JSON.parse(unseal(row.payloadCiphertext,inquiryAad(this.workspaceId,row.id),this.ring)));
   if(row.ownerAccountId!==this.ownerAccountId||row.programKey!==payload.program||row.requestDigest!==this.requestDigest(payload))throw new Error();
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
  const rows=await tx.query<InquiryRow>(`SELECT id,program_key AS "programKey",owner_account_id AS "ownerAccountId",request_digest AS "requestDigest",
   payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt" FROM ls_service_interest.bna_inquiries
   WHERE workspace_id=$1 AND id=$2 AND program_key IN ('bna_torah_mornings','bna_learning_coop') AND owner_account_id=$3`,
   [this.workspaceId,id,this.ownerAccountId]);
  if(rows.length!==1)throw new AppError("NOT_FOUND");return this.decode(rows[0]!);
 }
 private async history(tx:SqlSession,id:string,beforeVersion?:number){
  const rows=await tx.query<FollowupRow>(`SELECT operation_id AS "operationId",inquiry_id AS "inquiryId",
   actor_account_id AS "actorAccountId",version,request_digest AS "requestDigest",
   payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt" FROM ls_service_interest.bna_inquiry_followups
   WHERE workspace_id=$1 AND inquiry_id=$2 AND ($3::integer IS NULL OR version<$3) ORDER BY version DESC LIMIT 101`,[this.workspaceId,id,beforeVersion??null]);
  if(!rows.length&&beforeVersion===undefined)throw new AppError("UNAVAILABLE");
  return {items:rows.slice(0,100).map(row=>this.decodeFollowup(row)),hasMore:rows.length>100};
 }
 async submit(input:{operationId:string;fields:BnaInquiryFields|BnaCoopFields;attribution?:BnaAttribution},program:typeof BNA_INQUIRY_PROGRAM|typeof BNA_COOP_PROGRAM=BNA_INQUIRY_PROGRAM){
  const fields=program===BNA_COOP_PROGRAM?bnaCoopReadableFieldsSchema.parse(input.fields):bnaInquiryFieldsSchema.parse(input.fields),attribution=input.attribution?bnaAttributionSchema.parse(input.attribution):null;
  const payload=payloadSchema.parse({program,fields,attribution});
  const requestDigest=this.requestDigest(payload),contactDigest=this.contactDigest(fields),now=this.clock.now();
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);await this.configuredOwner(tx);
   const prior=await tx.query<{inquiryId:string;requestDigest:string}>(`SELECT inquiry_id AS "inquiryId",request_digest AS "requestDigest"
    FROM ls_service_interest.bna_inquiry_operations WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,input.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==requestDigest)throw new AppError("CONFLICT");
    return {saved:true as const,reference:prior[0]!.inquiryId,replayed:true};}
   if(program===BNA_COOP_PROGRAM&&fields.permission.version!==BNA_COOP_NOTICE.version)throw new AppError("INVALID_REQUEST");
   const counts=await tx.query<{contactCount:number;workspaceCount:number}>(`SELECT
    (SELECT count(*)::int FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND contact_digest=$2 AND received_at>$3::timestamptz-interval '24 hours') AS "contactCount",
    (SELECT count(*)::int FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND received_at>$3::timestamptz-interval '24 hours') AS "workspaceCount"`,
    [this.workspaceId,contactDigest,now]);
   if(!counts[0]||counts[0].contactCount>=4||counts[0].workspaceCount>=250)throw new AppError("RATE_LIMITED");
   const id=randomUUID();
   await tx.query(`INSERT INTO ls_service_interest.bna_inquiries(workspace_id,id,program_key,owner_account_id,contact_digest,
    request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$10,$3,$4,$5,$6,$7,$8,$9)`,
    [this.workspaceId,id,this.ownerAccountId,contactDigest,requestDigest,
     seal(JSON.stringify(payload),inquiryAad(this.workspaceId,id),this.ring),fields.permission.version,fields.permission.language,now,program]);
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
 private cursorAad(actor:Actor){return `ls_service_interest/bna-inquiry-cursor/v1/${this.workspaceId}/${actor.id}`;}
 private cursorId(actor:Actor,cursor:string){try{if(!/^[A-Za-z0-9_-]{64,2048}$/.test(cursor))throw Error();const bytes=Buffer.from(cursor,"base64url");if(bytes.toString("base64url")!==cursor)throw Error();return z.strictObject({id:z.string().uuid()}).parse(JSON.parse(unseal(bytes.toString("utf8"),this.cursorAad(actor),this.ring))).id;}catch{throw new AppError("INVALID_REQUEST");}}
 private encodeCursor(actor:Actor,id:string){return Buffer.from(seal(JSON.stringify({id}),this.cursorAad(actor),this.ring)).toString("base64url");}
 async list(actor:Actor,cursor?:string){
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const anchor=cursor===undefined?null:this.cursorId(actor,cursor);
   if(anchor){const found=await tx.query(`SELECT id FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND owner_account_id=$2 AND program_key IN ('bna_torah_mornings','bna_learning_coop') AND id=$3`,[this.workspaceId,this.ownerAccountId,anchor]);if(found.length!==1)throw new AppError("INVALID_REQUEST");}
   const rows=await tx.query<InquiryRow & {followupOperationId:string;followupInquiryId:string;followupActorAccountId:string;followupVersion:number;followupRequestDigest:string;followupPayloadCiphertext:string;followupRecordedAt:Date}>(`SELECT i.id,i.program_key AS "programKey",i.owner_account_id AS "ownerAccountId",i.request_digest AS "requestDigest",
    i.payload_ciphertext AS "payloadCiphertext",i.received_at AS "receivedAt",f.operation_id AS "followupOperationId",f.inquiry_id AS "followupInquiryId",
    f.actor_account_id AS "followupActorAccountId",f.version AS "followupVersion",f.request_digest AS "followupRequestDigest",
    f.payload_ciphertext AS "followupPayloadCiphertext",f.recorded_at AS "followupRecordedAt" FROM ls_service_interest.bna_inquiries i
    LEFT JOIN LATERAL (SELECT * FROM ls_service_interest.bna_inquiry_followups f WHERE f.workspace_id=i.workspace_id AND f.inquiry_id=i.id ORDER BY f.version DESC LIMIT 1) f ON true
    WHERE i.workspace_id=$1 AND i.program_key IN ('bna_torah_mornings','bna_learning_coop') AND i.owner_account_id=$2 AND ($3::uuid IS NULL OR (i.received_at,i.id)<(SELECT received_at,id FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3)) ORDER BY i.received_at DESC,i.id DESC LIMIT 101`,
    [this.workspaceId,this.ownerAccountId,anchor]);
   const items=[];
   for(const row of rows.slice(0,100)){const record=this.decode(row);if(!row.followupOperationId)throw new AppError("UNAVAILABLE");
    const followup=this.decodeFollowup({operationId:row.followupOperationId,inquiryId:row.followupInquiryId,actorAccountId:row.followupActorAccountId,version:row.followupVersion,requestDigest:row.followupRequestDigest,payloadCiphertext:row.followupPayloadCiphertext,recordedAt:row.followupRecordedAt});
    items.push({...record,followup});}
   return {program:"bna" as const,items,nextCursor:rows.length>100?this.encodeCursor(actor,items.at(-1)!.id):null};
  });
 }
 async read(actor:Actor,id:string,beforeVersion?:number){
  if(!z.string().uuid().safeParse(id).success)throw new AppError("INVALID_REQUEST");
  if(beforeVersion!==undefined&&(!Number.isSafeInteger(beforeVersion)||beforeVersion<1||beforeVersion>2147483647))throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const record=await this.inquiry(tx,id),current=await this.history(tx,id),history=beforeVersion===undefined?current:await this.history(tx,id,beforeVersion);
   return {...record,followup:current.items[0]!,history:history.items,hasMoreHistory:history.hasMore};});
 }
 async findOperation(actor:Actor,operationId:string){
  if(!z.string().uuid().safeParse(operationId).success)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const rows=await tx.query<{id:string}>(`SELECT inquiry_id AS id FROM ls_service_interest.bna_inquiry_operations WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,operationId]);
   if(!rows.length)return {found:false as const};if(rows.length!==1)throw new AppError("UNAVAILABLE");
   const record=await this.inquiry(tx,rows[0]!.id),history=await this.history(tx,record.id);
   return {found:true as const,detail:{...record,followup:history.items[0]!,history:history.items,hasMoreHistory:history.hasMore}};
  });
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
   const current=await this.history(tx,command.inquiryId),version=current.items[0]!.version+1;
   if(command.expectedVersion!==current.items[0]!.version)throw new AppError("CONFLICT");
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
