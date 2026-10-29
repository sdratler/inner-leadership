import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import type {BnaInquiryAcknowledgmentHook} from "../bna-inquiry/store.ts";
import {BNA_EMAIL_SOURCE,freezeBnaAcknowledgment,frozenBnaAcknowledgmentSchema,type FrozenBnaAcknowledgment} from "./delivery-policy.ts";
import {bnaRecipientSha256,type BnaDispatchAdmission} from "./dispatch-admission.ts";

export type BnaAcknowledgmentState="queued"|"unknown"|"sent"|"failed"|"canceled";
type Row={id:string;inquiryId:string;programKey:string;ownerAccountId:string;recipientKey:string;locale:string;
 sourceSha256:string;copySha256:string;payloadDigest:string;ciphertext:string;createdAt:Date;
 state:BnaAcknowledgmentState;version:number;reservedAt:Date|null;completedAt:Date|null;providerId:string|null;lastCode:string|null};
const aad=(workspace:string,id:string)=>`ls_service_interest/bna-email-message/v1/${workspace}/${id}`;
const payloadDigest=(workspace:string,payload:FrozenBnaAcknowledgment,key:string)=>privateDigest({domain:"bna-email-payload/v1",workspace,payload},key);
export const bnaEmailRecipientKey=(workspace:string,email:string,key:string)=>privateDigest({domain:"bna-email-recipient/v1",workspace,email},key);
const columns=`m.id,m.inquiry_id AS "inquiryId",m.program_key AS "programKey",m.owner_account_id AS "ownerAccountId",m.recipient_key AS "recipientKey",m.locale,
 m.source_sha256 AS "sourceSha256",m.copy_sha256 AS "copySha256",m.payload_digest AS "payloadDigest",m.payload_ciphertext AS ciphertext,m.created_at AS "createdAt",
 d.state,d.version,d.reserved_at AS "reservedAt",d.completed_at AS "completedAt",d.provider_id AS "providerId",d.last_code AS "lastCode"`;

/** Only new submissions invoke this transaction hook. There is no historical
 * collector, public queue command, contact creation or provider call. */
export function configuredBnaAcknowledgmentQueue(env:Record<string,string|undefined>,ring:Keyring,key:string):BnaInquiryAcknowledgmentHook|undefined{
 if(env.LS_BNA_EMAIL_QUEUE_ENABLED!=="true")return undefined;
 const since=z.iso.datetime({offset:true}).safeParse(env.LS_BNA_EMAIL_QUEUE_SINCE);
 if(!since.success||env.LS_BNA_EMAIL_SOURCE_SHA256!==BNA_EMAIL_SOURCE)throw new AppError("UNAVAILABLE");
 const sinceMs=Date.parse(since.data);
 return async(tx,input)=>{
  if(input.receivedAt.getTime()<sinceMs||input.payload.program==="bna_torah_mornings")return;
  const payload=freezeBnaAcknowledgment(input.payload.program,input.id,input.payload.fields);if(!payload)return;
  const id=randomUUID(),digest=payloadDigest(input.workspaceId,payload,key);
  const inserted=await tx.query<{id:string}>(`INSERT INTO ls_service_interest.bna_email_messages
   (workspace_id,id,inquiry_id,program_key,template_id,owner_account_id,recipient_key,locale,source_sha256,copy_sha256,payload_digest,payload_ciphertext,created_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(workspace_id,inquiry_id,template_id) DO NOTHING RETURNING id`,
   [input.workspaceId,id,input.id,payload.program,payload.templateId,input.ownerAccountId,bnaEmailRecipientKey(input.workspaceId,payload.recipient,key),payload.locale,
    payload.sourceSha256,payload.copySha256,digest,seal(JSON.stringify(payload),aad(input.workspaceId,id),ring),input.receivedAt]);
  if(!inserted.length){
   const prior=await one<{digest:string}>(tx,`SELECT payload_digest AS digest FROM ls_service_interest.bna_email_messages WHERE workspace_id=$1 AND inquiry_id=$2 AND template_id=$3`,[input.workspaceId,input.id,payload.templateId]);
   if(prior?.digest!==digest)throw new AppError("CONFLICT");return;
  }
  await tx.query(`INSERT INTO ls_service_interest.bna_email_delivery(workspace_id,message_id,state,version,last_code) VALUES($1,$2,'queued',1,'INQUIRY_SAVED')`,[input.workspaceId,id]);
  await tx.query(`INSERT INTO ls_service_interest.bna_email_delivery_events(workspace_id,message_id,version,operation_id,state,code,recorded_at)
   VALUES($1,$2,1,$3,'queued','INQUIRY_SAVED',$4)`,[input.workspaceId,id,input.operationId,input.receivedAt]);
 };
}

export type BnaAcknowledgmentSendResult={state:"accepted";providerId:string}|{state:"not_attempted"}|{state:"unknown"};
/** Server-owned admitted adapter. It must recheck activation immediately before
 * its provider message request and never retry an uncertain network effect. */
export interface BnaAcknowledgmentTransport{
 readonly mode:"controlled_test"|"future_requests";
 authorize(message:{id:string;inquiryId:string;createdAt:string;recipientKey:string;payload:FrozenBnaAcknowledgment}):boolean;
 send(message:{id:string;inquiryId:string;createdAt:string;recipientKey:string;payload:FrozenBnaAcknowledgment}):Promise<BnaAcknowledgmentSendResult>;
}

export class BnaAcknowledgmentStore{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ownerAccountId:string,
  private readonly ring:Keyring,private readonly key:string,private readonly clock:IdentityClock){}
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspace||actor.id!==this.ownerAccountId)throw new AppError("NOT_FOUND");
  const current=await freshActor(tx,actor,this.clock.now());
  if(current.state!=="active"||current.role!=="practitioner"||current.id!==this.ownerAccountId)throw new AppError("NOT_FOUND");
 }
 private decode(row:Row){try{
  const payload=frozenBnaAcknowledgmentSchema.parse(JSON.parse(unseal(row.ciphertext,aad(this.workspace,row.id),this.ring)));
  if(payload.reference!==row.inquiryId||payload.program!==row.programKey||payload.locale!==row.locale||payload.sourceSha256!==row.sourceSha256||payload.copySha256!==row.copySha256||
   row.ownerAccountId!==this.ownerAccountId||payloadDigest(this.workspace,payload,this.key)!==row.payloadDigest||bnaEmailRecipientKey(this.workspace,payload.recipient,this.key)!==row.recipientKey)throw Error();
  return payload;
 }catch{throw new AppError("UNAVAILABLE");}}
 private row(tx:SqlSession,id:string,lock=false){return one<Row>(tx,`SELECT ${columns} FROM ls_service_interest.bna_email_messages m
  JOIN ls_service_interest.bna_email_delivery d ON d.workspace_id=m.workspace_id AND d.message_id=m.id
  WHERE m.workspace_id=$1 AND m.id=$2 AND m.owner_account_id=$3${lock?" FOR UPDATE OF d":""}`,[this.workspace,id,this.ownerAccountId]);}
 private async transition(tx:SqlSession,row:Row,state:BnaAcknowledgmentState,code:string,operationId:string,actorId:string|null=null,providerId:string|null=null,requestDigest:string|null=null){
  const now=this.clock.now(),version=row.version+1;
  const updated=await tx.query(`UPDATE ls_service_interest.bna_email_delivery SET state=$4,version=$5,last_code=$6,
   reserved_at=CASE WHEN $4::text='unknown' THEN $7::timestamptz WHEN $4::text='queued' THEN NULL ELSE reserved_at END,completed_at=CASE WHEN $4::text IN('sent','failed','canceled') THEN $7::timestamptz ELSE NULL END,provider_id=$8
   WHERE workspace_id=$1 AND message_id=$2 AND version=$3 RETURNING message_id`,[this.workspace,row.id,row.version,state,version,code,now,providerId]);
  if(updated.length!==1)throw new AppError("CONFLICT");
  await tx.query(`INSERT INTO ls_service_interest.bna_email_delivery_events(workspace_id,message_id,version,operation_id,state,code,recorded_at,actor_account_id,provider_id,request_digest)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[this.workspace,row.id,version,operationId,state,code,now,actorId,providerId,requestDigest]);
 }
 async readForInquiry(actor:Actor,inquiryId:string){
  if(!z.string().uuid().safeParse(inquiryId).success)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   // Verify actual inquiry ownership even when no delivery row was requested.
   const inquiry=await one<{id:string}>(tx,`SELECT id FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND id=$2 AND owner_account_id=$3 AND program_key IN('bna_learning_coop','bna_support_interest')`,[this.workspace,inquiryId,this.ownerAccountId]);
   if(!inquiry)throw new AppError("NOT_FOUND");
   const rows=await tx.query<Row>(`SELECT ${columns} FROM ls_service_interest.bna_email_messages m
    JOIN ls_service_interest.bna_email_delivery d ON d.workspace_id=m.workspace_id AND d.message_id=m.id
    WHERE m.workspace_id=$1 AND m.inquiry_id=$2 AND m.owner_account_id=$3 ORDER BY m.created_at,m.id`,[this.workspace,inquiryId,this.ownerAccountId]);
   if(!rows.length)return {state:"not_queued" as const};if(rows.length!==1)throw new AppError("UNAVAILABLE");
   const row=rows[0]!,payload=this.decode(row);
   const history=await tx.query<{state:BnaAcknowledgmentState;code:string;recordedAt:Date}>(`SELECT state,code,recorded_at AS "recordedAt" FROM ls_service_interest.bna_email_delivery_events WHERE workspace_id=$1 AND message_id=$2 ORDER BY version DESC LIMIT 100`,[this.workspace,row.id]);
   return {state:row.state,messageId:row.id,version:row.version,lastCode:row.lastCode,providerId:row.providerId,completedAt:row.completedAt?.toISOString()??null,payload,
    history:history.map(event=>({...event,recordedAt:event.recordedAt.toISOString()}))};
  });
 }
 /** Production service intake cannot be admitted by a preview, a fabricated
  * provider ID, an unrelated template or another workspace's receipt. */
 async verifyControlledProofs(policy:BnaDispatchAdmission,expectedRecipientSha256:string){
  if(policy.mode!=="future_requests"||policy.workspaceId!==this.workspace||policy.ownerAccountId!==this.ownerAccountId||!/^[a-f0-9]{64}$/.test(expectedRecipientSha256))throw new AppError("UNAVAILABLE");
  await this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");
   for(const [template,id] of [["EMAIL-B0",policy.controlledProofs.b0],["EMAIL-S0",policy.controlledProofs.s0]] as const){
    const row=await this.row(tx,id);if(!row||row.state!=="sent"||row.lastCode!=="PROVIDER_ACCEPTED"||!row.providerId||!row.completedAt||row.completedAt>this.clock.now())throw new AppError("UNAVAILABLE");
    const payload=this.decode(row),event=await one<{code:string}>(tx,`SELECT code FROM ls_service_interest.bna_email_delivery_events WHERE workspace_id=$1 AND message_id=$2 AND version=$3`,[this.workspace,id,row.version-1]);
    if(payload.templateId!==template||payload.copySha256!==policy.messageCopies[template]||bnaRecipientSha256(payload.recipient)!==expectedRecipientSha256||event?.code!=="CONTROLLED_DELIVERY_RESERVED")throw new AppError("UNAVAILABLE");
   }
  });
 }
 async assertDeliveryTarget(policy:BnaDispatchAdmission){
  if(policy.workspaceId!==this.workspace||policy.ownerAccountId!==this.ownerAccountId)throw new AppError("UNAVAILABLE");
  await this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");
   const target=await one<{systemId:string;ssl:boolean}>(tx,`SELECT system_identifier::text AS "systemId",(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl FROM pg_control_system()`);
   const owner=await one<{id:string}>(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[this.workspace,this.ownerAccountId]);
   if(!owner||target?.systemId!==policy.target.databaseSystemId||target.ssl!==true)throw new AppError("UNAVAILABLE");
  });
 }
 async queuedIds(policy:BnaDispatchAdmission,limit=1){
  if(!Number.isInteger(limit)||limit<1||limit>10||policy.workspaceId!==this.workspace||policy.ownerAccountId!==this.ownerAccountId)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");
   return (await tx.query<{id:string}>(`SELECT m.id FROM ls_service_interest.bna_email_messages m JOIN ls_service_interest.bna_email_delivery d
    ON d.workspace_id=m.workspace_id AND d.message_id=m.id WHERE m.workspace_id=$1 AND m.owner_account_id=$2 AND d.state='queued'
    AND m.created_at>=$4 AND ($5::uuid[] IS NULL OR m.inquiry_id=ANY($5::uuid[]))
    ORDER BY m.created_at,m.id LIMIT $3`,[this.workspace,this.ownerAccountId,limit,policy.activatedAt,policy.mode==="controlled_test"?policy.references.map(item=>item.inquiryId):null])).map(row=>row.id);
  });
 }
 /** Explicit ID only. A worker may separately select admitted future jobs;
  * neither this method nor public intake scans existing inquiry history. */
 async dispatch(id:string,transport:BnaAcknowledgmentTransport){
  if(!z.string().uuid().safeParse(id).success)throw new AppError("INVALID_REQUEST");
  const prepared=await this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspace);
   const owner=await one<{id:string}>(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[this.workspace,this.ownerAccountId]);
   if(!owner)throw new AppError("UNAVAILABLE");
   const row=await this.row(tx,id,true);if(!row)throw new AppError("NOT_FOUND");
   if(row.state!=="queued")return {state:row.state} as const;
   const payload=this.decode(row);
   const message={id:row.id,inquiryId:row.inquiryId,createdAt:row.createdAt.toISOString(),recipientKey:row.recipientKey,payload};
   if(!transport.authorize(message))return {state:"held" as const};
   await this.transition(tx,row,"unknown",transport.mode==="controlled_test"?"CONTROLLED_DELIVERY_RESERVED":"FUTURE_DELIVERY_RESERVED",randomUUID());
   return {state:"reserved" as const,message};
  });
  if(prepared.state!=="reserved")return prepared.state;
  let result:BnaAcknowledgmentSendResult;try{result=await transport.send(prepared.message);}catch{return "unknown" as const;}
  if(result.state==="unknown")return "unknown" as const;
  if(result.state==="accepted"&&!/^[A-Za-z0-9_-]{1,256}$/.test(result.providerId))return "unknown" as const;
  try{return await this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspace);const row=await this.row(tx,id,true);if(!row)return "unknown" as const;
   if(row.state==="canceled"&&row.lastCode==="OWNER_CANCELED_UNCONFIRMED"){
    await this.transition(tx,row,result.state==="accepted"?"sent":"canceled",result.state==="accepted"?"PROVIDER_ACCEPTED_AFTER_CANCEL":"CANCELED_PROVIDER_NOT_ATTEMPTED",randomUUID(),null,result.state==="accepted"?result.providerId:null);
    return result.state==="accepted"?"sent" as const:"canceled" as const;
   }
   if(row.state!=="unknown")return "unknown" as const;
   const state=result.state==="accepted"?"sent":"failed";
   await this.transition(tx,row,state,state==="sent"?"PROVIDER_ACCEPTED":"PROVIDER_NOT_ATTEMPTED",randomUUID(),null,result.state==="accepted"?result.providerId:null);
   return state;
  });}catch{return "unknown" as const;}
 }
 async cancel(actor:Actor,input:{messageId:string;operationId:string;expectedVersion:number}){
  const command=z.object({messageId:z.string().uuid(),operationId:z.string().uuid(),expectedVersion:z.number().int().min(1).max(2147483645)}).strict().parse(input);
  const digest=privateDigest({domain:"bna-email-cancel/v1",workspace:this.workspace,actor:actor.id,command},this.key);
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.owner(tx,actor);
   const prior=await one<{messageId:string;code:string;digest:string|null}>(tx,`SELECT message_id AS "messageId",code,request_digest AS digest FROM ls_service_interest.bna_email_delivery_events WHERE workspace_id=$1 AND operation_id=$2`,[this.workspace,command.operationId]);
   if(prior){if(prior.messageId!==command.messageId||prior.digest!==digest||!['OWNER_CANCELED','OWNER_CANCELED_UNCONFIRMED'].includes(prior.code))throw new AppError("CONFLICT");return {state:"canceled" as const,replayed:true};}
   const row=await this.row(tx,command.messageId,true);if(!row)throw new AppError("NOT_FOUND");
   if(row.version!==command.expectedVersion||!['queued','unknown','failed'].includes(row.state))throw new AppError("CONFLICT");
   await this.transition(tx,row,"canceled",row.state==="unknown"?"OWNER_CANCELED_UNCONFIRMED":"OWNER_CANCELED",command.operationId,actor.id,null,digest);
   return {state:"canceled" as const,replayed:false};
  });
 }
 async retryNotAttempted(actor:Actor,input:{messageId:string;operationId:string;expectedVersion:number}){
  const command=z.object({messageId:z.string().uuid(),operationId:z.string().uuid(),expectedVersion:z.number().int().min(1).max(2147483645)}).strict().parse(input);
  const digest=privateDigest({domain:"bna-email-retry-not-attempted/v1",workspace:this.workspace,actor:actor.id,command},this.key);
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.owner(tx,actor);
   const prior=await one<{messageId:string;code:string;digest:string|null}>(tx,`SELECT message_id AS "messageId",code,request_digest AS digest FROM ls_service_interest.bna_email_delivery_events WHERE workspace_id=$1 AND operation_id=$2`,[this.workspace,command.operationId]);
   if(prior){if(prior.messageId!==command.messageId||prior.digest!==digest||prior.code!=="OWNER_RETRY_NOT_ATTEMPTED")throw new AppError("CONFLICT");return {state:"queued" as const,replayed:true};}
   const row=await this.row(tx,command.messageId,true);if(!row)throw new AppError("NOT_FOUND");
   if(row.version!==command.expectedVersion||row.state!=="failed"||row.lastCode!=="PROVIDER_NOT_ATTEMPTED")throw new AppError("CONFLICT");
   await this.transition(tx,row,"queued","OWNER_RETRY_NOT_ATTEMPTED",command.operationId,actor.id,null,digest);
   return {state:"queued" as const,replayed:false};
  });
 }
}

