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

export type OutboundReceipt={provider:string;providerMessageId:string|null;sentAt:string|null;replaySuppressed?:boolean;sheetUpdated?:boolean};
export type OutboundProjection={operationId:string;leadId:string;authorityEpoch:number;state:"prepared"|"sent_pending"|"projected";
 fields:Record<string,string>;receipt:OutboundReceipt|null};
const aad=(workspace:string,operation:string,kind:"fields"|"receipt")=>`ls_contact_ops/outbound-projection/v1/${workspace}/${operation}/${kind}`;
const leadPattern=/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/;
const fieldsValid=(fields:Record<string,string>)=>Object.keys(fields).length<=20&&Object.entries(fields).every(([key,value])=>
 /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)&&typeof value==="string"&&value.length<=4000);

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
  if(!leadPattern.test(leadId)||!Number.isSafeInteger(authorityEpoch)||authorityEpoch<0||!fieldsValid(fields)||!message.trim())throw new AppError("INVALID_REQUEST");
  const operationId=randomUUID(),ciphertext=seal(JSON.stringify(fields),aad(a.workspaceId,operationId,"fields"),this.keyring);
  const digest=privateDigest({leadId,message,fields,actor:a.id,authorityEpoch},this.integrityKey);
  return this.db.transaction(async tx=>{
   await this.lock(tx,a);
   const state=await readCutoverState(tx,a.workspaceId,this.keyring,true);
   if(state.epoch!==authorityEpoch||writeDestination(state.phase)!=="sheet")throw new AppError("CONFLICT");
   if(await demoRecordBatch(tx,a.workspaceId,"prospect",leadId))throw new AppError("FORBIDDEN");
   const pending=await tx.query<{operation_id:string}>(`SELECT operation_id FROM ls_contact_ops.outbound_projections
    WHERE workspace_id=$1 AND legacy_lead_id=$2 AND state<>'projected' LIMIT 1`,[a.workspaceId,leadId]);
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
   const rows=await tx.query<{state:string}>(`UPDATE ls_contact_ops.outbound_projections SET
    projection_ciphertext=$4,receipt_ciphertext=$5,state='sent_pending',updated_at=clock_timestamp()
    WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 AND state='prepared' RETURNING state`,
    [a.workspaceId,operationId,a.id,seal(JSON.stringify(fields),aad(a.workspaceId,operationId,"fields"),this.keyring),
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
 async read(a:Actor,operationId:string):Promise<OutboundProjection|null>{
  return this.db.transaction(async tx=>{
   await this.actor(tx,a);
   const rows=await tx.query<{legacyLeadId:string;authorityEpoch:number;state:OutboundProjection["state"];projectionCiphertext:string;receiptCiphertext:string|null}>(`SELECT
    legacy_lead_id AS "legacyLeadId",authority_epoch AS "authorityEpoch",state,
    projection_ciphertext AS "projectionCiphertext",receipt_ciphertext AS "receiptCiphertext"
    FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3`,[a.workspaceId,operationId,a.id]);
   if(rows.length>1)throw new AppError("UNAVAILABLE");
   const row=rows[0];if(!row)return null;
   try{
    const fields=JSON.parse(unseal(row.projectionCiphertext,aad(a.workspaceId,operationId,"fields"),this.keyring)) as Record<string,string>;
    const receipt=row.receiptCiphertext?JSON.parse(unseal(row.receiptCiphertext,aad(a.workspaceId,operationId,"receipt"),this.keyring)) as OutboundReceipt:null;
    if(!fieldsValid(fields)||!leadPattern.test(row.legacyLeadId)||Boolean(receipt)!==(row.state!=="prepared"))throw Error("invalid ledger");
    return {operationId,leadId:row.legacyLeadId,authorityEpoch:row.authorityEpoch,state:row.state,fields,receipt};
   }catch{throw new AppError("UNAVAILABLE");}
  });
 }
 async pendingLeads(a:Actor,leadIds:readonly string[]):Promise<Set<string>>{
  if(leadIds.length>10000||leadIds.some(id=>!leadPattern.test(id)))throw new AppError("INVALID_REQUEST");
  if(!leadIds.length)return new Set();
  return this.db.transaction(async tx=>{
   await this.actor(tx,a);
   const rows=await tx.query<{leadId:string}>(`SELECT DISTINCT legacy_lead_id AS "leadId"
    FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1 AND state<>'projected'
     AND legacy_lead_id IN (SELECT jsonb_array_elements_text($2::jsonb))`,[a.workspaceId,JSON.stringify(leadIds)]);
   return new Set(rows.map(row=>row.leadId));
  });
 }
}
