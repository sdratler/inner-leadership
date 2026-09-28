import "server-only";
import {AppError} from "../../../lib/errors.ts";
import {asId} from "../../../lib/ids.ts";
import type {IdentityStore} from "../../identity/store.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {freshActor} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {inboundInquirySchema,type InboundInquiry} from "../core/inbound.ts";
import {digest,privateDigest} from "./digests.ts";
export const inboundBindingDigest=(input:Pick<InboundInquiry,"provider"|"channelId"|"businessNumber">)=>
 digest({provider:input.provider,channelId:input.channelId,businessNumber:input.businessNumber});
const aad=(w:string,b:string,e:string)=>`ls_contact_ops/message-receipt/v1/${w}/whatsapp/${b}/${e}`;
type Stored={binding:string;event:string;message:string;digest:string;cipher:string;occurredAt:Date;storedAt:Date};
/** Trusted internal capture, after existing bridge authentication. Durable and
 * encrypted before HTTP acknowledgement. No actor/person auto-provisioning,
 * contact matching, provider effects or authority switch. Binding is operator-
 * supplied from the actual receiver, not accepted from a browser/request flag.
 */
export class ContactInboundStore {
 constructor(private readonly db:IdentityStore,private readonly workspaceId:string,private readonly keyring:Keyring,
  private readonly integrityKey:string,private readonly expectedBindingDigest:string|null,private readonly clock:IdentityClock=systemClock){
  asId(workspaceId,"workspace");
  if(expectedBindingDigest!==null&&!/^[a-f0-9]{64}$/.test(expectedBindingDigest))throw new AppError("UNAVAILABLE");
 }
 async capture(input:unknown):Promise<{replayed:boolean;storedAt:string}>{
  // A read-only inbox has no capture binding, even when called accidentally.
  if(this.expectedBindingDigest===null)throw new AppError("UNAVAILABLE");
  const parsed=inboundInquirySchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const inquiry=parsed.data;if(inboundBindingDigest(inquiry)!==this.expectedBindingDigest)throw new AppError("FORBIDDEN");
  const binding=privateDigest({domain:"contact-binding-v1",binding:this.expectedBindingDigest,workspace:this.workspaceId},this.integrityKey);
  const event=privateDigest({domain:"contact-event-v1",binding,id:inquiry.providerEventId},this.integrityKey);
  const message=privateDigest({domain:"contact-message-v1",binding,id:inquiry.providerMessageId},this.integrityKey);
  const payloadDigest=privateDigest({domain:"contact-payload-v1",workspace:this.workspaceId,inquiry},this.integrityKey);
  const ciphertext=seal(JSON.stringify(inquiry),aad(this.workspaceId,binding,event),this.keyring);
  return this.db.transaction(async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${this.workspaceId}:contact-receipt:${binding}:${event}`]);
   const rows=await tx.query<{digest:string;storedAt:Date}>(`SELECT payload_digest AS digest,stored_at AS "storedAt"
    FROM ls_contact_ops.message_receipts WHERE workspace_id=$1 AND channel='whatsapp' AND provider_binding_id=$2 AND provider_event_key=$3`,[this.workspaceId,binding,event]);
   if(rows[0]){if(rows[0].digest!==payloadDigest)throw new AppError("CONFLICT");return {replayed:true,storedAt:rows[0].storedAt.toISOString()};}
   const inserted=await tx.query<{storedAt:Date}>(`INSERT INTO ls_contact_ops.message_receipts
    (workspace_id,channel,provider_binding_id,provider_event_key,provider_message_key,event_type,payload_digest,payload_ciphertext,occurred_at)
    VALUES($1,'whatsapp',$2,$3,$4,'inbound_message',$5,$6,$7) RETURNING stored_at AS "storedAt"`,
    [this.workspaceId,binding,event,message,payloadDigest,ciphertext,inquiry.occurredAt]);
   return {replayed:false,storedAt:inserted[0]!.storedAt.toISOString()};
  });
 }
 /** Private future inbox projection only, not an API/history scan. Bounded to
  * receipts already captured here. Clinical/case data is never joined/shared.
  */
 async recent(actor:Actor,limit=50):Promise<{receiptKey:string;inquiry:InboundInquiry;storedAt:string}[]>{
  if(actor.workspaceId!==this.workspaceId)throw new AppError("FORBIDDEN");
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const rows=await tx.query<Stored>(`SELECT provider_binding_id AS binding,provider_event_key AS event,provider_message_key AS message,
    payload_digest AS digest,payload_ciphertext AS cipher,occurred_at AS "occurredAt",stored_at AS "storedAt"
    FROM ls_contact_ops.message_receipts WHERE workspace_id=$1 AND channel='whatsapp' ORDER BY stored_at DESC,provider_binding_id,provider_event_key LIMIT $2`,[this.workspaceId,limit]);
   return rows.map(row=>{
    let inquiry:InboundInquiry;try{inquiry=inboundInquirySchema.parse(JSON.parse(unseal(row.cipher,aad(this.workspaceId,row.binding,row.event),this.keyring)));}catch{throw new AppError("UNAVAILABLE");}
    const binding=privateDigest({domain:"contact-binding-v1",binding:inboundBindingDigest(inquiry),workspace:this.workspaceId},this.integrityKey);
    if(binding!==row.binding||privateDigest({domain:"contact-event-v1",binding,id:inquiry.providerEventId},this.integrityKey)!==row.event||
     privateDigest({domain:"contact-message-v1",binding,id:inquiry.providerMessageId},this.integrityKey)!==row.message||
     privateDigest({domain:"contact-payload-v1",workspace:this.workspaceId,inquiry},this.integrityKey)!==row.digest||row.occurredAt.toISOString()!==inquiry.occurredAt)throw new AppError("UNAVAILABLE");
    return {receiptKey:row.event,inquiry,storedAt:row.storedAt.toISOString()};
   });
  });
 }
}
