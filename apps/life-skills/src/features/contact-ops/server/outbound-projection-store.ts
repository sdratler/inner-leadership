import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../../lib/errors.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {freshActor} from "../../identity/data.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {demoRecordBatch} from "../../demo/provenance.ts";
import {writeDestination} from "../core/cutover.ts";
import {privateDigest} from "./digests.ts";
import {readCutoverState} from "./cutover-state.ts";

export type OutboundReceipt={provider:string;providerMessageId:string|null;sentAt:string|null;replaySuppressed?:boolean;sheetUpdated?:boolean;
 manualVerification?:{source:"provider_delivery_log"|"provider_support_case";reference:string;checkedAt:string}};
export type NoDeliveryEvidence={provider:"whapi";source:"provider_delivery_log"|"provider_support_case";
 reference:string;checkedAt:string;acknowledgement:"I verified this exact message was not delivered"};
export type OutboundProjection={operationId:string;leadId:string;authorityEpoch:number;createdAt:string;state:"prepared"|"sent_pending"|"projected"|"not_delivered";
 message:string;fields:Record<string,string>;receipt:OutboundReceipt|null;resolution:NoDeliveryEvidence|null};
export type PendingOutboundProjection={operationId:string;state:"prepared"|"sent_pending";message:string;createdAt:string};
export type PendingWorkspaceProjection=PendingOutboundProjection&{leadId:string};
const aad=(workspace:string,operation:string,kind:"fields"|"receipt"|"resolution")=>`ls_contact_ops/outbound-projection/v1/${workspace}/${operation}/${kind}`;
const leadPattern=/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/;
const fieldsValid=(fields:Record<string,string>)=>Object.keys(fields).length<=20&&Object.entries(fields).every(([key,value])=>
 /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)&&typeof value==="string"&&value.length<=4000);
const payload=(message:string,fields:Record<string,string>)=>JSON.stringify({message,fields});
function decoded(raw:string):{message:string;fields:Record<string,string>}{
 const value=JSON.parse(raw) as {message:unknown;fields:Record<string,string>};
 if(typeof value.message!=="string"||!value.message.trim()||value.message.length>4000||
  !value.fields||typeof value.fields!=="object"||Array.isArray(value.fields)||!fieldsValid(value.fields))throw Error("invalid outbound payload");
 return {message:value.message,fields:value.fields};
}
function validNoDeliveryEvidence(value:unknown):value is NoDeliveryEvidence{
 if(!value||typeof value!=="object")return false;
 const e=value as Partial<NoDeliveryEvidence>;
 return e.provider==="whapi"&&["provider_delivery_log","provider_support_case"].includes(e.source??"")&&
  typeof e.reference==="string"&&/^[A-Za-z0-9][A-Za-z0-9:._@/-]{7,199}$/.test(e.reference)&&
  typeof e.checkedAt==="string"&&Number.isFinite(Date.parse(e.checkedAt))&&
  e.acknowledgement==="I verified this exact message was not delivered";
}

/** A committed pre-send intent keeps requested administrative fields even if
 * the provider result or the subsequent Sheet projection becomes uncertain.
 * Never infer a provider send from a prepared row; reconcile it explicitly.
 */
export class OutboundProjectionStore {
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,private readonly integrityKey:string,
  private readonly clock:IdentityClock=systemClock){}
 private async actor(tx:SqlSession,a:Actor){requirePractitioner(await freshActor(tx,a,this.clock.now()));}
 private async lock(tx:SqlSession,a:Actor){
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${a.workspaceId}:contact-authority`]);
  await this.actor(tx,a);
 }
 async prepare(a:Actor,leadId:string,authorityEpoch:number,message:string,fields:Record<string,string>):Promise<string>{
  if(!leadPattern.test(leadId)||!Number.isSafeInteger(authorityEpoch)||authorityEpoch<0||!fieldsValid(fields)||!message.trim()||message.length>4000)throw new AppError("INVALID_REQUEST");
  const operationId=randomUUID(),ciphertext=seal(payload(message,fields),aad(a.workspaceId,operationId,"fields"),this.keyring);
  const digest=privateDigest({leadId,message,fields,actor:a.id,authorityEpoch},this.integrityKey);
  return this.db.transaction(async tx=>{
   await this.lock(tx,a);
   const state=await readCutoverState(tx,a.workspaceId,this.keyring,true);
   if(state.epoch!==authorityEpoch||writeDestination(state.phase)!=="sheet")throw new AppError("CONFLICT");
   if(await demoRecordBatch(tx,a.workspaceId,"prospect",leadId))throw new AppError("FORBIDDEN");
   const pending=await tx.query<{operation_id:string}>(`SELECT operation_id FROM ls_contact_ops.outbound_projections
    WHERE workspace_id=$1 AND legacy_lead_id=$2 AND state IN ('prepared','sent_pending') LIMIT 1`,[a.workspaceId,leadId]);
   if(pending.length)throw new AppError("CONFLICT");
   await tx.query(`INSERT INTO ls_contact_ops.outbound_projections
    (workspace_id,operation_id,actor_account_id,legacy_lead_id,authority_epoch,request_digest,projection_ciphertext)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[a.workspaceId,operationId,a.id,leadId,authorityEpoch,digest,ciphertext]);
   return operationId;
  });
 }
 async confirm(a:Actor,operationId:string,receipt:OutboundReceipt,fields:Record<string,string>):Promise<void>{
  if(!fieldsValid(fields)||!receipt.provider||typeof receipt.providerMessageId!=="string"&&receipt.providerMessageId!==null||
   typeof receipt.sentAt!=="string"&&receipt.sentAt!==null)throw new AppError("INVALID_REQUEST");
  await this.db.transaction(async tx=>{
   await this.actor(tx,a);
   const prepared=await tx.query<{projectionCiphertext:string}>(`SELECT projection_ciphertext AS "projectionCiphertext"
    FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND operation_id=$2
    AND actor_account_id=$3 AND state='prepared' FOR UPDATE`,[a.workspaceId,operationId,a.id]);
   if(prepared.length!==1)throw new AppError("CONFLICT");
   let message:string;
   try{message=decoded(unseal(prepared[0]!.projectionCiphertext,aad(a.workspaceId,operationId,"fields"),this.keyring)).message;}
   catch{throw new AppError("UNAVAILABLE");}
   const rows=await tx.query<{state:string}>(`UPDATE ls_contact_ops.outbound_projections SET
    projection_ciphertext=$4,receipt_ciphertext=$5,state='sent_pending',updated_at=clock_timestamp()
    WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 AND state='prepared' RETURNING state`,
    [a.workspaceId,operationId,a.id,seal(payload(message,fields),aad(a.workspaceId,operationId,"fields"),this.keyring),
     seal(JSON.stringify(receipt),aad(a.workspaceId,operationId,"receipt"),this.keyring)]);
   if(rows.length!==1)throw new AppError("CONFLICT");
  });
 }
 async projected(a:Actor,operationId:string):Promise<void>{
  await this.db.transaction(async tx=>{
   await this.actor(tx,a);
   const rows=await tx.query(`UPDATE ls_contact_ops.outbound_projections SET state='projected',updated_at=clock_timestamp()
    WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 AND state='sent_pending' RETURNING operation_id`,
    [a.workspaceId,operationId,a.id]);
   if(rows.length!==1)throw new AppError("CONFLICT");
  });
 }
 /** Exceptional recovery only after a practitioner checks the exact outbound
  * message in the provider's authoritative delivery log or support case.
  * This attestation is not provider API verification and never sends a message.
  */
 async notDelivered(a:Actor,operationId:string,evidence:NoDeliveryEvidence):Promise<void>{
  if(!validNoDeliveryEvidence(evidence))throw new AppError("INVALID_REQUEST");
  await this.db.transaction(async tx=>{
   await this.actor(tx,a);
   const prepared=await tx.query<{createdAt:Date|string}>(`SELECT created_at AS "createdAt" FROM ls_contact_ops.outbound_projections
    WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 AND state='prepared' FOR UPDATE`,
    [a.workspaceId,operationId,a.id]);
   if(prepared.length!==1)throw new AppError("CONFLICT");
   const checked=Date.parse(evidence.checkedAt),createdAt=prepared[0]!.createdAt,
    created=createdAt instanceof Date?createdAt.getTime():Date.parse(createdAt);
   if(!Number.isFinite(created)||checked<created+900000||checked>this.clock.now().getTime()+300000)throw new AppError("INVALID_REQUEST");
   const rows=await tx.query(`UPDATE ls_contact_ops.outbound_projections SET state='not_delivered',
    resolution_ciphertext=$4,updated_at=clock_timestamp() WHERE workspace_id=$1 AND operation_id=$2
    AND actor_account_id=$3 AND state='prepared' RETURNING operation_id`,
    [a.workspaceId,operationId,a.id,seal(JSON.stringify(evidence),aad(a.workspaceId,operationId,"resolution"),this.keyring)]);
   if(rows.length!==1)throw new AppError("CONFLICT");
  });
 }
 async read(a:Actor,operationId:string):Promise<OutboundProjection|null>{
  return this.db.transaction(async tx=>{
   await this.actor(tx,a);
   const rows=await tx.query<{legacyLeadId:string;authorityEpoch:number;createdAt:Date|string;state:OutboundProjection["state"];projectionCiphertext:string;receiptCiphertext:string|null;resolutionCiphertext:string|null}>(`SELECT
    legacy_lead_id AS "legacyLeadId",authority_epoch AS "authorityEpoch",created_at AS "createdAt",state,
    projection_ciphertext AS "projectionCiphertext",receipt_ciphertext AS "receiptCiphertext",
    resolution_ciphertext AS "resolutionCiphertext"
    FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3`,[a.workspaceId,operationId,a.id]);
   if(rows.length>1)throw new AppError("UNAVAILABLE");
   const row=rows[0];if(!row)return null;
   try{
    const {message,fields}=decoded(unseal(row.projectionCiphertext,aad(a.workspaceId,operationId,"fields"),this.keyring));
    const receipt=row.receiptCiphertext?JSON.parse(unseal(row.receiptCiphertext,aad(a.workspaceId,operationId,"receipt"),this.keyring)) as OutboundReceipt:null;
    const resolution=row.resolutionCiphertext?JSON.parse(unseal(row.resolutionCiphertext,aad(a.workspaceId,operationId,"resolution"),this.keyring)) as NoDeliveryEvidence:null;
    if(!leadPattern.test(row.legacyLeadId)||Boolean(receipt)!==["sent_pending","projected"].includes(row.state)||
     Boolean(resolution)!==(row.state==="not_delivered")||resolution&&!validNoDeliveryEvidence(resolution))throw Error("invalid ledger");
    return {operationId,leadId:row.legacyLeadId,authorityEpoch:row.authorityEpoch,
     createdAt:row.createdAt instanceof Date?row.createdAt.toISOString():row.createdAt,
     state:row.state,message,fields,receipt,resolution};
   }catch{throw new AppError("UNAVAILABLE");}
  });
 }
 async pendingLeads(a:Actor,leadIds:readonly string[]):Promise<Set<string>>{
  return new Set((await this.pendingForLeads(a,leadIds)).keys());
 }
 /** Enumerate outstanding intents without depending on the Sheet still
  * containing their lead IDs. The opaque UUID cursor keeps each response
  * bounded while allowing an orphaned record to remain discoverable. */
 async pendingPage(a:Actor,after:string|null=null,pageSize=100):Promise<{items:PendingWorkspaceProjection[];nextCursor:string|null}>{
  if(after!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after)||
   !Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   await this.actor(tx,a);
   const rows=await tx.query<{leadId:string;operationId:string;state:PendingWorkspaceProjection["state"];
    projectionCiphertext:string;createdAt:Date|string}>(`SELECT legacy_lead_id AS "leadId",operation_id AS "operationId",state,
    projection_ciphertext AS "projectionCiphertext",created_at AS "createdAt"
    FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND actor_account_id=$2
    AND state IN ('prepared','sent_pending') AND ($3::uuid IS NULL OR operation_id>$3::uuid)
    ORDER BY operation_id LIMIT $4`,[a.workspaceId,a.id,after,pageSize+1]);
   const items:PendingWorkspaceProjection[]=[];
   for(const row of rows.slice(0,pageSize)){
    if(!leadPattern.test(row.leadId))throw new AppError("UNAVAILABLE");
    let message:string;
    try{message=decoded(unseal(row.projectionCiphertext,aad(a.workspaceId,row.operationId,"fields"),this.keyring)).message;}
    catch{throw new AppError("UNAVAILABLE");}
    items.push({leadId:row.leadId,operationId:row.operationId,state:row.state,message,
     createdAt:row.createdAt instanceof Date?row.createdAt.toISOString():row.createdAt});
   }
   return {items,nextCursor:rows.length>pageSize?items.at(-1)!.operationId:null};
  });
 }
 async pendingForLeads(a:Actor,leadIds:readonly string[]):Promise<Map<string,PendingOutboundProjection>>{
  if(leadIds.length>10000||leadIds.some(id=>!leadPattern.test(id)))throw new AppError("INVALID_REQUEST");
  if(!leadIds.length)return new Map();
  return this.db.transaction(async tx=>{
   await this.actor(tx,a);
   const rows=await tx.query<{leadId:string;operationId:string;state:PendingOutboundProjection["state"];projectionCiphertext:string;createdAt:Date|string}>(`SELECT legacy_lead_id AS "leadId",operation_id AS "operationId",state,
    projection_ciphertext AS "projectionCiphertext",created_at AS "createdAt"
    FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND state IN ('prepared','sent_pending')
     AND legacy_lead_id IN (SELECT jsonb_array_elements_text($2::jsonb))`,[a.workspaceId,JSON.stringify(leadIds)]);
   const result=new Map<string,PendingOutboundProjection>();
   for(const row of rows){
    if(result.has(row.leadId))throw new AppError("UNAVAILABLE");
    let message:string;
    try{message=decoded(unseal(row.projectionCiphertext,aad(a.workspaceId,row.operationId,"fields"),this.keyring)).message;}
    catch{throw new AppError("UNAVAILABLE");}
    result.set(row.leadId,{operationId:row.operationId,state:row.state,message,
     createdAt:row.createdAt instanceof Date?row.createdAt.toISOString():row.createdAt});
   }
   return result;
  });
 }
}
