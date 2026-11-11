import 'server-only';
import {createHash,createHmac} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import type {WorkspaceId,IdentityClock,Actor,AccountId} from '../identity/types.ts';
import type {IdentityStore,SqlSession} from '../identity/store.ts';
import {lockWorkspace} from '../identity/data.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingId} from './contracts.ts';
import {cardAttemptSchema,type CardAttempt} from './card-contracts.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from './card-binding.ts';
import {billingStripeSignedReceiptSchema} from './stripe-test.ts';
import {requestRecordSchema} from './card-checkout-request.ts';
import {FishingProgramSourceNativeV3} from './program-source-native-v3.ts';
import {cardRecordAad,cardRecordCanonical} from './card-event-processor.ts';
import type {ServiceCardReconciliationAuthorityV4,ServiceCardReconciliationScopeV4} from './guest-service-current-card-contract-v4.ts';
import {FishingBillingInquiryFamilyProposals} from '../../lib/fishing-billing-inquiry-family-proposal.ts';
import {readServiceAcceptanceDataV4} from './guest-service-acceptance-data-v4.ts';
import {readServiceCurrentFamilyDataV4,readServiceFinancialSnapshotV4} from './guest-service-financial-data-v4.ts';
import {readIssuedServiceQuoteWithRowV4} from './guest-service-quote-readback-v4.ts';
import {guardedCardServicePermissionV4} from './card-service-permission-v4.ts';
import type {ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import {SERVICE_CARD_EVENT_EVIDENCE_V4,serviceCardEventEvidenceQueryV4Schema,storedCardProcessingEvidenceV4Schema,
 type ServiceCardEventEvidenceV4,type ServiceCardEventEvidenceQueryV4} from './guest-service-card-event-evidence-v4-contract.ts';

type Context=Readonly<BillingLedgerContext>;
type EventRow={workspaceId:string;accountId:string;livemode:boolean;eventId:string;digest:string;ciphertext:string;state:string;processedCiphertext:string|null;receivedAt:Date;receivedExactTime:boolean};
type AttemptRow={id:string;quoteId:string;revision:number;state:string;ciphertext:string};
type SettlementRow={workspaceId:string;quoteId:string;attemptId:string;receiptId:string;ciphertext:string;kind:string;transactionId:string};
// Existing event processor settlement format; no separate ledger/calculator.
const settlementSchema=z.object({workspaceId:billingId,quoteId:billingId,attemptId:billingId,receiptId:billingId,accountId:z.string(),livemode:z.literal(false),amountMinor:z.number().int().positive(),transactionId:z.string(),kind:z.enum(['payment','refund'])}).strict();
const canonical=cardRecordCanonical,sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fact(v:unknown):asserts v{if(!v)throw new AppError('UNAVAILABLE');}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function decode(ciphertext:string,aad:string,ring:Keyring){fact(ciphertext.length>0&&ciphertext.length<=262144);return JSON.parse(unseal(ciphertext,aad,ring)) as unknown;}
/** Read-only configured-owner composition of actual native owner/session, V4
 * acceptance/family/source/data and independent service permission readers.
 * It DOES NOT call the reconciliation kernel or its suppressQueued postlude.
 * No SDK/inbox capability, authority cache, advance, settlement or send is made.
 * Native policy/readers must be trusted read-only implementations; this borrowed
 * SELECT-only session permits their required row locks, not PG READ ONLY mode.
 * Unlinked inbox data is never exposed as a family's event. Facts do not choose
 * first/latest failure policy or turn event/attempt/read time into a due clock. */
export class FishingServiceCardEventEvidenceV4{
 private readonly binding:BillingStripeBinding;private readonly key:Buffer;private readonly commandKey:Buffer;
 private readonly families:FishingBillingInquiryFamilyProposals;private readonly now:()=>Date;private readonly authority:ServiceCardReconciliationAuthorityV4;
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,private readonly sourceKey:string,
  commandKey:Buffer,ledgerKey:Buffer,clock:IdentityClock,private readonly ownerId:AccountId,authority:ServiceCardReconciliationAuthorityV4,binding:BillingStripeBinding){
  fact(billingId.safeParse(workspaceId).success&&billingId.safeParse(ownerId).success&&sourceKey.length>=32&&commandKey.length>=32&&ledgerKey.length>=32&&typeof authority?.target==='function'&&typeof authority?.authorize==='function');
  this.key=Buffer.from(ledgerKey);this.commandKey=Buffer.from(commandKey);this.binding=Object.freeze(billingStripeBindingSchema.parse(binding));this.now=clock.now.bind(clock);
  this.authority=Object.freeze({target:authority.target.bind(authority),authorize:authority.authorize.bind(authority)});
  this.families=new FishingBillingInquiryFamilyProposals(db,workspaceId,ring,sourceKey,clock);
 }
 private currentNow(){const t=this.now();fact(t instanceof Date&&Number.isFinite(t.valueOf()));return new Date(t);}
 private async permission(c:Context,scope?:ServiceCardReconciliationScopeV4){
  const view=Object.freeze({...c,now:this.currentNow()});
  await guardedCardServicePermissionV4(view,this.workspaceId,this.binding,this.authority,scope??null);
 }
 private async frame(c:Context,id:string){
  const data=await readServiceAcceptanceDataV4(c,this.workspaceId,id,this.ring,this.sourceKey,this.commandKey);fact(data.original&&data.quote.acceptance);
  await readServiceCurrentFamilyDataV4(c,this.workspaceId,data.quote,this.ring,this.sourceKey,this.families);
  const snapshot=await readServiceFinancialSnapshotV4(c,this.workspaceId,data.quote,this.ring,this.key);
  const source=await readIssuedServiceQuoteWithRowV4(c,this.workspaceId,id,this.ring,this.sourceKey);fact(canonical(source.quote)===canonical(snapshot.quote));
  return {snapshot,physicalQuote:{...source.row,createdAt:source.row.createdAt.toISOString()}};
 }
 async readExact(actor:Actor,raw:ServiceCardEventEvidenceQueryV4):Promise<ServiceCardEventEvidenceV4>{
  const parsed=serviceCardEventEvidenceQueryV4Schema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const query=parsed.data,principal=Object.freeze({...actor});
  let callbackFailure:unknown,rejected=false;
  try{return await this.db.transaction(async physical=>{
   callbackFailure=undefined;rejected=false;
   const original=physical.query,perform=original.bind(physical),time=this.currentNow(),at=time.valueOf();let open=true,failed=false,borrowed=false;
   const pending=new Set<Promise<unknown>>();
   const guard=()=>fact(open&&physical.query===original&&c.tx===tx&&c.workspaceId===this.workspaceId&&c.now===time&&time.valueOf()===at);
   const tx:SqlSession=Object.freeze({query:<R extends object>(sql:string,v:readonly unknown[]=[])=>{
    const task=(async()=>{guard();fact(/^\s*SELECT\b/i.test(sql)&&!sql.includes(';')&&!/\bINTO\b/i.test(sql));const rows=await perform<R>(sql,v);guard();return rows;})().catch(error=>{failed=true;throw error;});
    pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
   }}),c=Object.freeze({workspaceId:this.workspaceId,now:time,tx});
   // Private single-use adapter to THIS physical transaction. The actual native
   // owner class still performs its configured-account, fresh session, subject,
   // demo exclusion and terminal owner checks with genuine SQL. No nested DB,
   // fabricated Actor, cached permission or public transaction port is created.
   const nativeDb:IdentityStore={transaction:async work=>{guard();fact(!borrowed);borrowed=true;return work(tx);}};
   const programme=new FishingProgramSourceNativeV3(nativeDb,this.workspaceId,this.ring,this.sourceKey,this.ownerId,{now:()=>this.currentNow()});
   try{
    guard();let baseline:Awaited<ReturnType<typeof this.frame>>|undefined,scope:ServiceCardReconciliationScopeV4|undefined;
    const result=await programme.withOwnerTransaction(principal,async owner=>{
     fact(owner.workspaceId===this.workspaceId&&owner.actor.id===this.ownerId);
     await this.permission(c);await lockWorkspace(tx,this.workspaceId);
     baseline=await this.frame(c,query.quoteId);const q=baseline.snapshot.quote;
     scope=freeze({action:'reconcile',programKey:'fishing_monthly_club',quoteId:q.id,familyId:q.familyId,childIds:q.lines.map(l=>l.childId),offerSha256:q.offer.sha256,acceptanceId:q.acceptance!.id});
     await this.permission(c,scope);const current=await this.frame(c,query.quoteId);fact(canonical(current)===canonical(baseline));
     return freeze(structuredClone(await this.read(c,current.snapshot,query)));
    });
    // Native terminal owner/session postludes are complete. Their locks remain
    // in this actual TX; then re-read all current facts and make the independent
    // final read permission LAST. No mutable callback or SQL follows success.
    fact(baseline&&scope);fact(canonical(await this.frame(c,query.quoteId))===canonical(baseline));
    await this.permission(c,scope);guard();fact(!failed&&pending.size===0);return result;
   }catch(error){callbackFailure=error instanceof AppError?error:new AppError('UNAVAILABLE');rejected=true;throw callbackFailure;}
   finally{if(pending.size)await Promise.allSettled([...pending]);open=false;}
  });}catch(error){if(rejected&&error===callbackFailure&&error instanceof AppError)throw error;throw new AppError('UNAVAILABLE');}
 }
 private async attempt(c:Context,frame:ServiceOwnerSnapshotV4,id:string){
  const rows=await c.tx.query<AttemptRow>('SELECT id,quote_id AS "quoteId",revision,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND id=$2 LIMIT 2 FOR SHARE',[this.workspaceId,id]);
  fact(rows.length===1);const row=rows[0]!,q=frame.quote,a=cardAttemptSchema.parse(decode(row.ciphertext,cardRecordAad('attempt',this.workspaceId,id),this.ring));
  fact(a.id===id&&a.command.operationId===id&&a.workspaceId===this.workspaceId&&a.quoteId===q.id&&row.id===id&&row.quoteId===q.id&&a.familyId===q.familyId&&
   a.command.quoteId===q.id&&a.revision===row.revision&&a.state===row.state&&canonical(a.binding)===canonical(this.binding)&&
   a.requestDigest===createHmac('sha256',this.key).update(canonical(a.command)).digest('hex')&&a.preparation.operationId===id&&a.preparation.quoteId===q.id&&
   a.preparation.result.attemptId===id&&a.preparation.entityVersion===a.command.expectedVersion+1&&a.balanceVersion>=a.preparation.entityVersion&&a.balanceVersion<=q.revision&&
   canonical(a.preparation.result.allocations)===canonical(a.command.selection)&&a.preparation.result.amountMinor===a.command.selection.reduce((s,x)=>s+x.amountMinor,0)&&
   new Set(a.command.selection.map(x=>x.lineId)).size===a.command.selection.length&&a.command.selection.every(x=>q.lines.some(l=>l.id===x.lineId&&x.amountMinor<=l.amountMinor)));
  const requests=await c.tx.query<{quoteId:string;ciphertext:string}>('SELECT quote_id AS "quoteId",payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempt_requests WHERE workspace_id=$1 AND attempt_id=$2 LIMIT 2 FOR SHARE',[this.workspaceId,id]);
  fact(requests.length===1);const requestRow=requests[0]!,record=requestRecordSchema.parse(decode(requestRow.ciphertext,cardRecordAad('checkout_request',this.workspaceId,id),this.ring)),r=record.request;
  // Decode the EXISTING immutable request schema, exactly matching shared
  // processor joins. Its ciphertext/HMAC is DATA, never current authority.
  fact(record.workspaceId===this.workspaceId&&record.attemptId===a.id&&record.quoteId===q.id&&requestRow.quoteId===q.id&&record.actorId===a.actorId&&
   record.digest===createHmac('sha256',this.key).update(canonical(r)).digest('hex')&&canonical(r.binding)===canonical(this.binding)&&
   r.operationId===id&&r.idempotencyKey===id&&r.quoteId===q.id&&r.expectedVersion===a.command.expectedVersion&&r.amountMinor===a.preparation.result.amountMinor&&
   canonical(r.allocations)===canonical(a.preparation.result.allocations)&&r.params.client_reference_id===q.id&&r.params.metadata.billing_quote_id===q.id&&
   r.params.metadata.billing_attempt_id===id&&canonical(r.params.metadata)===canonical(r.params.payment_intent_data.metadata)&&r.params.line_items[0]!.price_data.unit_amount===r.amountMinor);
  return {a,row,requestRow};
 }
 private async settlement(c:Context,frame:ServiceOwnerSnapshotV4,a:CardAttempt,kind:'payment'|'refund',transactionId:string){
  const rows=await c.tx.query<SettlementRow>('SELECT workspace_id AS "workspaceId",quote_id AS "quoteId",attempt_id AS "attemptId",receipt_id AS "receiptId",fact_ciphertext AS ciphertext,kind,transaction_id AS "transactionId" FROM ls_fishing_billing.card_settlements WHERE account_id=$1 AND livemode=false AND kind=$2 AND transaction_id=$3 AND workspace_id=$4 AND quote_id=$5 AND attempt_id=$6 LIMIT 2 FOR SHARE',[this.binding.accountId,kind,transactionId,this.workspaceId,a.quoteId,a.id]);
  fact(rows.length<=1);if(!rows.length)return null;return this.checkSettlement(frame,a,rows[0]!);
 }
 private checkSettlement(frame:ServiceOwnerSnapshotV4,a:CardAttempt,row:SettlementRow){
  const s=settlementSchema.parse(decode(row.ciphertext,cardRecordAad('settlement',this.workspaceId,row.kind+'/'+row.transactionId),this.ring));
  fact(s.workspaceId===this.workspaceId&&row.workspaceId===this.workspaceId&&s.quoteId===a.quoteId&&row.quoteId===a.quoteId&&s.attemptId===a.id&&row.attemptId===a.id&&
   s.receiptId===row.receiptId&&s.kind===row.kind&&s.transactionId===row.transactionId&&s.accountId===this.binding.accountId&&s.livemode===false);
  const receipt=frame.balance.receipts.find(r=>r.id===s.receiptId);
  fact(receipt&&receipt.quoteId===a.quoteId&&receipt.familyId===a.familyId&&receipt.kind===(s.kind==='payment'?'card':'refund')&&receipt.currency==='USD'&&
   receipt.provider?.accountId===this.binding.accountId&&receipt.provider.mode==='test'&&receipt.provider.transactionId===s.transactionId&&receipt.amountMinor===s.amountMinor&&
   receipt.allocations.every(x=>frame.quote.lines.some(l=>l.id===x.lineId))&&
   (s.kind!=='payment'||receipt.amountMinor===a.preparation.result.amountMinor&&canonical(receipt.allocations)===canonical(a.preparation.result.allocations)));
  return s.receiptId;
 }
 private async read(c:Context,frame:ServiceOwnerSnapshotV4,query:ServiceCardEventEvidenceQueryV4):Promise<ServiceCardEventEvidenceV4>{
  const base={version:SERVICE_CARD_EVENT_EVIDENCE_V4,query,observedAt:c.now.toISOString()},q=frame.quote;
  const unresolved=(reason:Extract<ServiceCardEventEvidenceV4,{state:'unresolved'}>['reason']):ServiceCardEventEvidenceV4=>({...base,state:'unresolved',reason,evidence:null});
  fact(q.workspaceId===this.workspaceId&&q.id===query.quoteId&&q.definition.programKey==='fishing_monthly_club'&&q.acceptance);
  const rows=await c.tx.query<EventRow>('SELECT workspace_id AS "workspaceId",account_id AS "accountId",livemode,event_id AS "eventId",body_digest AS digest,receipt_ciphertext AS ciphertext,state,processed_ciphertext AS "processedCiphertext",received_at AS "receivedAt",received_at=date_trunc(\'milliseconds\',received_at) AS "receivedExactTime" FROM ls_fishing_billing.stripe_events WHERE account_id=$1 AND livemode=false AND event_id=$2 AND workspace_id=$3 LIMIT 2 FOR SHARE',[this.binding.accountId,query.eventId,this.workspaceId]);
  fact(rows.length<=1);if(!rows.length)return unresolved('missing_or_unlinked');const row=rows[0]!;
  fact(row.workspaceId===this.workspaceId&&row.accountId===this.binding.accountId&&row.livemode===false&&row.eventId===query.eventId);
  fact(['pending','processed','review_required'].includes(row.state));if(row.state==='pending')return unresolved('missing_or_unlinked');fact(row.processedCiphertext);
  const p=storedCardProcessingEvidenceV4Schema.parse(decode(row.processedCiphertext,cardRecordAad('event_result',this.workspaceId,query.eventId),this.ring));
  fact(p.workspaceId===this.workspaceId&&p.accountId===this.binding.accountId&&p.eventId===query.eventId&&p.digest===row.digest&&p.receiptIds.length<=101&&new Set(p.receiptIds).size===p.receiptIds.length&&(!p.reason||p.reason.length<=500));
  if(p.quoteId!==q.id||p.attemptId!==query.attemptId)return unresolved('missing_or_unlinked');
  const receipt=billingStripeSignedReceiptSchema.parse(decode(row.ciphertext,'ls_fishing_billing/stripe_event/v1/'+this.workspaceId+'/'+this.binding.accountId+'/'+query.eventId,this.ring));
  fact(receipt.eventId===query.eventId&&receipt.providerAccountId===this.binding.accountId&&receipt.livemode===false&&receipt.apiVersion===this.binding.apiVersion&&receipt.digest===row.digest);
  if(p.review||row.state==='review_required'){fact(p.review&&row.state==='review_required');return unresolved('event_review_required');}
  fact(row.state==='processed'&&p.reason===null);
  if(receipt.eventType.startsWith('invoice.'))return unresolved('unsupported_event_family');
  const {a,row:attemptRow,requestRow}=await this.attempt(c,frame,query.attemptId);
  const eventAt=Date.parse(receipt.createdAt),attemptAt=Date.parse(a.createdAt),acceptAt=Date.parse(q.acceptance!.acceptedAt);
  if(eventAt%1000!==0||eventAt>c.now.valueOf()||attemptAt>c.now.valueOf()||row.receivedExactTime!==true||!(row.receivedAt instanceof Date)||row.receivedAt.valueOf()>c.now.valueOf()||
   Math.floor(eventAt/1000)<Math.floor(attemptAt/1000)||Math.floor(eventAt/1000)<Math.floor(acceptAt/1000))return unresolved('event_time_unproven');
  const family=receipt.eventType.startsWith('payment_intent.')?'pi_':receipt.eventType.startsWith('checkout.session.')?'cs_':receipt.eventType.startsWith('refund.')?'re_':null;
  if(!a.dispatchId||!family||!receipt.objectId.startsWith(family))return unresolved('event_object_unproven');
  let objectSettlementReceiptId:string|null=null;
  if(family==='re_'){
   objectSettlementReceiptId=await this.settlement(c,frame,a,'refund',receipt.objectId);if(!objectSettlementReceiptId)return unresolved('event_object_unproven');
  }else if(family==='pi_')objectSettlementReceiptId=await this.settlement(c,frame,a,'payment',receipt.objectId);
  // A committed authenticated processing record is the historical object join.
  // Current PI/session fields may have advanced: they do not erase the original
  // event or select a latest failure. A cs receipt alone has no persisted PI.
  const linked=p.receiptIds.length?await c.tx.query<SettlementRow>('SELECT workspace_id AS "workspaceId",quote_id AS "quoteId",attempt_id AS "attemptId",receipt_id AS "receiptId",fact_ciphertext AS ciphertext,kind,transaction_id AS "transactionId" FROM ls_fishing_billing.card_settlements WHERE account_id=$1 AND livemode=false AND workspace_id=$2 AND quote_id=$3 AND attempt_id=$4 AND receipt_id=ANY($5::uuid[]) LIMIT 102 FOR SHARE',[this.binding.accountId,this.workspaceId,q.id,a.id,p.receiptIds]):[];
  fact(linked.length===p.receiptIds.length&&new Set(linked.map(r=>r.receiptId)).size===linked.length);
  for(const r of linked)fact(p.receiptIds.includes(this.checkSettlement(frame,a,r)));
  const children=a.command.selection.map(x=>{const l=q.lines.find(l=>l.id===x.lineId)!;return {lineId:l.id,childId:l.childId,periodId:l.period.id,startsAt:l.period.startsAt,endsAt:l.period.endsAt,timeZone:l.period.timeZone,groupId:l.groupId,selectedMinor:x.amountMinor};});
  return {...base,state:'committed',evidence:{provenance:'original_stored_receipt_and_committed_native_processing',
   scope:{workspaceId:this.workspaceId,programKey:'fishing_monthly_club',familyId:q.familyId,quoteId:q.id,attemptId:a.id,acceptanceId:q.acceptance!.id,offerSha256:q.offer.sha256,children},
   original:{receipt,eventTimePrecision:'provider_event_second',receivedAt:row.receivedAt.toISOString(),receivedAtPrecision:'database_millisecond',processing:p,receiptCiphertextSha256:sha(row.ciphertext),processingCiphertextSha256:sha(row.processedCiphertext!),requestCiphertextSha256:sha(requestRow.ciphertext)},
   current:{attemptCiphertextSha256:sha(attemptRow.ciphertext),quoteRevision:q.revision,quoteState:q.state,paused:q.paused,balance:frame.balance,attempt:{id:a.id,revision:a.revision,balanceVersion:a.balanceVersion,state:a.state,dispatchId:a.dispatchId,sessionId:a.sessionId,paymentIntentId:a.paymentIntentId,createdAt:a.createdAt},processingReceiptIds:p.receiptIds,objectSettlementReceiptId}}};
 }
}
