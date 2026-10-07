import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {freshActor} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import type {InboundInquiry} from "../core/inbound.ts";
import {acquisitionCandidateMetadataSchema,type AcquisitionCandidate,type AcquisitionCandidateMetadata} from "../core/acquisition.ts";
import {privateDigest} from "./digests.ts";

const hex=z.string().regex(/^[a-f0-9]{64}$/);
const keysSchema=z.object({binding:hex,message:hex,thread:hex,sender:hex,messageDigest:hex});
type Keys=z.infer<typeof keysSchema>;
type Row=Keys&{id:string;ciphertext:string;occurredAt:Date};
export type StoredAcquisitionCandidate=Keys&{metadata:AcquisitionCandidateMetadata};
const aad=(workspace:string,binding:string,message:string)=>`ls_contact_ops/acquisition-candidate/v1/${workspace}/${binding}/${message}`;
const MAX_CANDIDATES=1000;
/** The already-authenticated receipt transaction owns candidate capture. It
 * creates no canonical person/lead, account, case, sales task or provider send.
 * Original metadata and replay identities are append-only; owner decisions are
 * a separate admitted operation, never an edit to the provider receipt.
 */
export class AcquisitionCandidateStore{
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){}
 private decode(workspace:string,row:Row):AcquisitionCandidateMetadata{
  let metadata:AcquisitionCandidateMetadata;
  try{metadata=acquisitionCandidateMetadataSchema.parse(JSON.parse(unseal(row.ciphertext,aad(workspace,row.binding,row.message),this.keyring)));}
  catch{throw new AppError("UNAVAILABLE");}
  if(metadata.id!==row.id||metadata.occurredAt!==row.occurredAt.toISOString()||
   privateDigest({domain:"contact-endpoint-v1",workspace,phone:metadata.phone},this.integrityKey)!==row.sender)throw new AppError("UNAVAILABLE");
  return metadata;
 }
 async getInTransaction(tx:SqlSession,workspace:string,id:string):Promise<StoredAcquisitionCandidate>{
  if(!z.string().uuid().safeParse(id).success)throw new AppError("INVALID_REQUEST");
  const rows=await tx.query<Row>(`SELECT id,provider_binding_id AS binding,provider_message_key AS message,
   provider_thread_key AS thread,sender_endpoint_key AS sender,message_digest AS "messageDigest",
   metadata_ciphertext AS ciphertext,occurred_at AS "occurredAt" FROM ls_contact_ops.inbound_activity_candidates
   WHERE workspace_id=$1 AND id=$2`,[workspace,id]);
  if(!rows.length)throw new AppError("NOT_FOUND");if(rows.length!==1)throw new AppError("UNAVAILABLE");
  return {...keysSchema.parse(rows[0]),metadata:this.decode(workspace,rows[0]!)};
 }
 async pendingInTransaction(tx:SqlSession,actor:Actor):Promise<{items:StoredAcquisitionCandidate[];hasMore:boolean}>{
  requirePractitioner(await freshActor(tx,actor,this.clock.now()));
  const rows=await tx.query<Row>(`SELECT c.id,c.provider_binding_id AS binding,c.provider_message_key AS message,
   c.provider_thread_key AS thread,c.sender_endpoint_key AS sender,c.message_digest AS "messageDigest",
   c.metadata_ciphertext AS ciphertext,c.occurred_at AS "occurredAt" FROM ls_contact_ops.inbound_activity_candidates c
   WHERE c.workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.lead_promotion_operations d
    WHERE d.workspace_id=c.workspace_id AND d.candidate_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.call_activity_links l WHERE l.workspace_id=c.workspace_id AND l.candidate_id=c.id)
   ORDER BY c.occurred_at DESC,c.id DESC LIMIT $2`,[actor.workspaceId,MAX_CANDIDATES+1]);
  return {items:rows.slice(0,MAX_CANDIDATES).map(row=>({...keysSchema.parse(row),metadata:this.decode(actor.workspaceId,row)})),
   hasMore:rows.length>MAX_CANDIDATES};
 }
 async priorInTransaction(tx:SqlSession,workspace:string,input:Keys):Promise<boolean>{
  const keys=keysSchema.parse(input);
  const rows=await tx.query<Row>(`SELECT id,provider_binding_id AS binding,provider_message_key AS message,
   provider_thread_key AS thread,sender_endpoint_key AS sender,message_digest AS "messageDigest",
   metadata_ciphertext AS ciphertext,occurred_at AS "occurredAt" FROM ls_contact_ops.inbound_activity_candidates
   WHERE workspace_id=$1 AND provider_binding_id=$2 AND provider_message_key=$3`,[workspace,keys.binding,keys.message]);
  if(rows.length>1)throw new AppError("UNAVAILABLE");const row=rows[0];if(!row)return false;
  if(row.messageDigest!==keys.messageDigest||row.thread!==keys.thread||row.sender!==keys.sender)throw new AppError("CONFLICT");
  this.decode(workspace,row);return true;
 }
 async captureInTransaction(tx:SqlSession,workspace:string,inquiry:InboundInquiry,input:Keys):Promise<{replayed:boolean}>{
  const result=await this.captureMetadataInTransaction(tx,workspace,{source:"organic_whatsapp",
   phone:inquiry.fromNumber,displayName:inquiry.pushName,occurredAt:inquiry.occurredAt},input);
  return {replayed:result.replayed};
 }
 /** Trusted authenticated metadata capture; no person/profile/clinical mutation. */
 async captureMetadataInTransaction(tx:SqlSession,workspace:string,inputMetadata:Omit<AcquisitionCandidateMetadata,"id">,input:Keys):Promise<{replayed:boolean;id:string}>{
  const keys=keysSchema.parse(input);
  if(await this.priorInTransaction(tx,workspace,keys)){
   const rows=await tx.query<{id:string}>(`SELECT id FROM ls_contact_ops.inbound_activity_candidates
    WHERE workspace_id=$1 AND provider_binding_id=$2 AND provider_message_key=$3`,[workspace,keys.binding,keys.message]);
   if(rows.length!==1)throw new AppError("UNAVAILABLE");return {replayed:true,id:rows[0]!.id};
  }
  // MAX_CANDIDATES bounds the pending review read, not append-only lifetime
  // storage. A full review window must never roll back the durable incoming
  // receipt. Replay/conflict, encryption and every read-envelope gate remain.
  const metadata=acquisitionCandidateMetadataSchema.parse({...inputMetadata,id:randomUUID()});
  await tx.query(`INSERT INTO ls_contact_ops.inbound_activity_candidates(workspace_id,id,provider_binding_id,
   provider_message_key,provider_thread_key,sender_endpoint_key,message_digest,metadata_ciphertext,occurred_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[workspace,metadata.id,keys.binding,keys.message,keys.thread,keys.sender,
   keys.messageDigest,seal(JSON.stringify(metadata),aad(workspace,keys.binding,keys.message),this.keyring),metadata.occurredAt]);
  return {replayed:false,id:metadata.id};
 }
 /** Ordinary current practitioner only. Bounded persisted metadata, no provider
  * history fetch, partial-success overflow, clinical join or customer access.
  */
 async recent(actor:Actor,limit=50):Promise<{items:AcquisitionCandidate[];hasMore:boolean}>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const rows=await tx.query<Row>(`SELECT id,provider_binding_id AS binding,provider_message_key AS message,
    provider_thread_key AS thread,sender_endpoint_key AS sender,message_digest AS "messageDigest",
    metadata_ciphertext AS ciphertext,occurred_at AS "occurredAt" FROM ls_contact_ops.inbound_activity_candidates
    WHERE workspace_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT $2`,[actor.workspaceId,limit+1]);
   return {items:rows.slice(0,limit).map(row=>({...this.decode(actor.workspaceId,row),state:"NEEDS_REVIEW" as const})),hasMore:rows.length>limit};
  });
 }
}
