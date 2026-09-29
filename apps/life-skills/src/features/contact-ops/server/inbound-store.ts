import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {asId} from "../../../lib/ids.ts";
import type {IdentityStore} from "../../identity/store.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {freshActor} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {inboundInquirySchema,type InboundInquiry} from "../core/inbound.ts";
import {digest,privateDigest} from "./digests.ts";
import {NativeInboundProjection,inboundProjectionKeys} from "./inbound-projection.ts";
import {readCutoverState} from "./cutover-state.ts";
import {inboundProjectionEnabled} from "../core/inbound-projection.ts";
export const inboundBindingDigest=(input:Pick<InboundInquiry,"provider"|"channelId"|"businessNumber">)=>
 digest({provider:input.provider,channelId:input.channelId,businessNumber:input.businessNumber});
const aad=(w:string,b:string,e:string)=>`ls_contact_ops/message-receipt/v1/${w}/whatsapp/${b}/${e}`;
type Stored={binding:string;event:string;message:string;digest:string;cipher:string;occurredAt:Date;storedAt:Date};
// This future-receipt reader has a fail-closed workspace scan budget, not an
// unbounded history aggregation. Never show a partial window that could hide a
// conflicting envelope or mistake a redelivery for an original message.
const MAX_INBOX_ENVELOPES=1000;
const drainCursorSchema=z.object({storedAt:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(v=>Number.isFinite(Date.parse(v))),
 eventKey:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type InboundDrainCursor=z.infer<typeof drainCursorSchema>;
/** Trusted internal capture, after existing bridge authentication. Durable and
 * encrypted before HTTP acknowledgement. Native administrative projection is
 * atomic with this receipt, only after the separately verified authority switch.
 * No account/case provisioning, sends or authority switch. Binding is operator-
 * supplied from the actual receiver, not accepted from a browser/request flag.
 */
export class ContactInboundStore {
 constructor(private readonly db:IdentityStore,private readonly workspaceId:string,private readonly keyring:Keyring,
  private readonly integrityKey:string,private readonly expectedBindingDigest:string|null,private readonly clock:IdentityClock=systemClock){
  asId(workspaceId,"workspace");
  if(expectedBindingDigest!==null&&!/^[a-f0-9]{64}$/.test(expectedBindingDigest))throw new AppError("UNAVAILABLE");
 }
 private decodeStored(row:Stored):InboundInquiry{
  let inquiry:InboundInquiry;try{inquiry=inboundInquirySchema.parse(JSON.parse(unseal(row.cipher,aad(this.workspaceId,row.binding,row.event),this.keyring)));}catch{throw new AppError("UNAVAILABLE");}
  const binding=privateDigest({domain:"contact-binding-v1",binding:inboundBindingDigest(inquiry),workspace:this.workspaceId},this.integrityKey);
  if(binding!==row.binding||privateDigest({domain:"contact-event-v1",binding,id:inquiry.providerEventId},this.integrityKey)!==row.event||
   privateDigest({domain:"contact-message-v1",binding,id:inquiry.providerMessageId},this.integrityKey)!==row.message||
   privateDigest({domain:"contact-payload-v1",workspace:this.workspaceId,inquiry},this.integrityKey)!==row.digest||row.occurredAt.toISOString()!==inquiry.occurredAt)throw new AppError("UNAVAILABLE");
  return inquiry;
 }
 /** Drain only this exact binding's already durable future receipts after the
  * verified native switch. NOT a provider history scan/backfill or a phase switch.
  * One fresh practitioner, fence and transaction; each projection counts once.
  * Ambiguous endpoints remain recorded as needs_resolution, never guessed. */
 async drain(actor:Actor,expectedEpoch:number,limit=50,after:InboundDrainCursor|null=null):Promise<{
  processed:number;projected:number;needsResolution:number;replayed:number;cursor:InboundDrainCursor|null;hasMore:boolean}>{
  if(actor.workspaceId!==this.workspaceId)throw new AppError("FORBIDDEN");
  if(this.expectedBindingDigest===null)throw new AppError("UNAVAILABLE");
  if(!Number.isSafeInteger(expectedEpoch)||expectedEpoch<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError("INVALID_REQUEST");
  if(after!==null&&!drainCursorSchema.safeParse(after).success)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${this.workspaceId}:contact-authority`]);
   const state=await readCutoverState(tx,this.workspaceId,this.keyring,true);
   if(state.epoch!==expectedEpoch||!inboundProjectionEnabled(state.phase))throw new AppError("CONFLICT");
   const binding=privateDigest({domain:"contact-binding-v1",binding:this.expectedBindingDigest,workspace:this.workspaceId},this.integrityKey);
   // Scan EVERY event envelope, including known messages captured during a
   // freeze. Filtering only by message would silently miss conflicting replays.
   // Exact PostgreSQL microseconds prevent the cursor re-reading a truncated
   // millisecond timestamp. The operator retains this private drain high-water.
   const rows=await tx.query<Stored&{cursorAt:string}>(`SELECT r.provider_binding_id AS binding,r.provider_event_key AS event,r.provider_message_key AS message,
    r.payload_digest AS digest,r.payload_ciphertext AS cipher,r.occurred_at AS "occurredAt",r.stored_at AS "storedAt",
    to_char(r.stored_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
    FROM ls_contact_ops.message_receipts r WHERE r.workspace_id=$1 AND r.channel='whatsapp' AND r.provider_binding_id=$2
     AND ($3::timestamptz IS NULL OR (r.stored_at,r.provider_event_key)>($3::timestamptz,$4::text))
    ORDER BY r.stored_at,r.provider_event_key LIMIT $5`,[this.workspaceId,binding,after?.storedAt??null,after?.eventKey??null,limit+1]);
   const pending=rows.slice(0,limit).map(row=>({row,inquiry:this.decodeStored(row)}));
   const projector=new NativeInboundProjection(this.workspaceId,this.keyring,this.integrityKey,this.clock,pending.map(item=>item.inquiry.fromNumber));
   const result={processed:0,projected:0,needsResolution:0,replayed:0,cursor:after,hasMore:rows.length>limit};
   for(const {row,inquiry} of pending){
    const outcome=await projector.projectInTransaction(tx,inquiry,inboundProjectionKeys(this.workspaceId,row.binding,row.event,row.message,row.digest,inquiry,this.integrityKey));
    if(outcome.state==="receipt_only")throw new AppError("CONFLICT");
    result.processed++;if(outcome.replayed)result.replayed++;
    else if(outcome.state==="projected")result.projected++;else result.needsResolution++;
    result.cursor=drainCursorSchema.parse({storedAt:row.cursorAt,eventKey:row.event});
   }
   return result;
  });
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
  const projector=new NativeInboundProjection(this.workspaceId,this.keyring,this.integrityKey,this.clock);
  const keys=inboundProjectionKeys(this.workspaceId,binding,event,message,payloadDigest,inquiry,this.integrityKey);
  return this.db.transaction(async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${this.workspaceId}:contact-receipt:${binding}:${event}`]);
   const rows=await tx.query<{digest:string;storedAt:Date}>(`SELECT payload_digest AS digest,stored_at AS "storedAt"
    FROM ls_contact_ops.message_receipts WHERE workspace_id=$1 AND channel='whatsapp' AND provider_binding_id=$2 AND provider_event_key=$3`,[this.workspaceId,binding,event]);
   if(rows[0]){
    if(rows.length!==1||rows[0].digest!==payloadDigest)throw new AppError("CONFLICT");
    await projector.projectInTransaction(tx,inquiry,keys);
    return {replayed:true,storedAt:rows[0].storedAt.toISOString()};
   }
   const inserted=await tx.query<{storedAt:Date}>(`INSERT INTO ls_contact_ops.message_receipts
    (workspace_id,channel,provider_binding_id,provider_event_key,provider_message_key,event_type,payload_digest,payload_ciphertext,occurred_at)
    VALUES($1,'whatsapp',$2,$3,$4,'inbound_message',$5,$6,$7) RETURNING stored_at AS "storedAt"`,
    [this.workspaceId,binding,event,message,payloadDigest,ciphertext,inquiry.occurredAt]);
   await projector.projectInTransaction(tx,inquiry,keys);
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
   // The existing primary key starts with workspace/channel/binding/event.
   // Read at most budget+1 in that indexed order BEFORE decrypting or grouping;
   // no full-history aggregate, sort, join or partial-history success. Exact SQL
   // microseconds retain the true first receipt even within one JS millisecond.
   const rows=await tx.query<Stored&{storedOrder:string}>(`SELECT provider_binding_id AS binding,provider_event_key AS event,provider_message_key AS message,
    payload_digest AS digest,payload_ciphertext AS cipher,occurred_at AS "occurredAt",stored_at AS "storedAt",
    to_char(stored_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "storedOrder"
    FROM ls_contact_ops.message_receipts WHERE workspace_id=$1 AND channel='whatsapp'
    ORDER BY provider_binding_id,provider_event_key LIMIT $2`,[this.workspaceId,MAX_INBOX_ENVELOPES+1]);
   if(rows.length>MAX_INBOX_ENVELOPES)throw new AppError("UNAVAILABLE");
   const messages=new Map<string,{receiptKey:string;inquiry:InboundInquiry;storedAt:string;messageDigest:string;storedOrder:string}>();
   for(const row of rows){
    const inquiry=this.decodeStored(row);
    const keys=inboundProjectionKeys(this.workspaceId,row.binding,row.event,row.message,row.digest,inquiry,this.integrityKey);
    const group=`${row.binding}:${row.message}`,previous=messages.get(group);
    if(previous&&previous.messageDigest!==keys.messageDigest)throw new AppError("CONFLICT");
    if(!previous||row.storedOrder<previous.storedOrder)messages.set(group,{receiptKey:row.message,inquiry,storedAt:row.storedAt.toISOString(),messageDigest:keys.messageDigest,storedOrder:row.storedOrder});
   }
   return Array.from(messages.entries()).sort(([a,x],[b,y])=>x.storedOrder===y.storedOrder?(a<b?-1:a>b?1:0):x.storedOrder<y.storedOrder?1:-1)
    .slice(0,limit).map(([, {messageDigest:_digest,storedOrder:_order,...item}])=>{void _digest;void _order;return item;});
  });
 }
}
