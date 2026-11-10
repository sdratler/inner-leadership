import 'server-only';
import {createHmac,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type IdentityStore} from '../identity/store.ts';
import type {WorkspaceId} from '../identity/types.ts';
import {billingId,ledgerReceiptSchema,type LedgerReceipt,type FamilyOffer} from './contracts.ts';
import type {LedgerReceiptV2} from './contracts-v2.ts';
import {requireBilling} from './domain.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingStripeSignedReceiptSchema,type BillingStripeSignedReceipt,type BillingStripeInboxAuthority} from './stripe-test.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from './card-binding.ts';
import {CARD_VERSION,cardAttemptSchema,providerPaymentSnapshotSchema,cardExceptionSchema,type CardAttempt,type ProviderPaymentSnapshot,type ProviderRefund} from './card-contracts.ts';
import type {BillingStripeTestProvider} from './cards.ts';
import {requestRecordSchema,type CheckoutRequest} from './card-checkout-request.ts';

/** The exact same event/attempt/settlement machinery consumes either genuine
 * native V3 or V4 frames. These structural views do not convert provenance or
 * confer authority. All original event, storage, AAD and receipt formats stay. */
export type NativeCardEventLedger<Frame>={context:Readonly<BillingLedgerContext>;frame:Frame;advance(receipts?:readonly LedgerReceipt[]):Promise<unknown>};
export interface NativeCardEventAccess<Frame>{
 db:IdentityStore;workspaceId:WorkspaceId;
 withReconciliation<T>(binding:BillingStripeBinding,quoteId:string,work:(ledger:NativeCardEventLedger<Frame>)=>Promise<T>):Promise<T>;
 view(frame:Frame):{quote:Pick<FamilyOffer,'id'|'familyId'|'revision'>&{acceptance:unknown|null};receipts:readonly LedgerReceiptV2[]};
 refundAllocations(context:BillingLedgerContext,frame:Frame,refund:ProviderRefund,original:LedgerReceipt):Promise<LedgerReceipt['allocations']|null>;
}

type AttemptRow={id:string;quoteId:string;revision:number;state:CardAttempt['state'];ciphertext:string};
type EventRow={workspaceId:string;digest:string;ciphertext:string;state:string;processedCiphertext:string|null};
type SettlementRow={workspaceId:string;quoteId:string;attemptId:string;receiptId:string;ciphertext:string};
const attemptSelect='SELECT id,quote_id AS "quoteId",revision,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempts';
const eventSelect='SELECT workspace_id AS "workspaceId",body_digest AS digest,receipt_ciphertext AS ciphertext,state,processed_ciphertext AS "processedCiphertext" FROM ls_fishing_billing.stripe_events';
export const cardRecordCanonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
const processedSchema=z.object({
 version:z.literal(CARD_VERSION),workspaceId:billingId,accountId:z.string(),eventId:z.string(),digest:z.string(),
 quoteId:billingId,attemptId:billingId,review:z.boolean(),receiptIds:z.array(billingId),reason:z.string().nullable(),
}).strict();
const settlementSchema=z.object({workspaceId:billingId,quoteId:billingId,attemptId:billingId,receiptId:billingId,accountId:z.string(),livemode:z.literal(false),amountMinor:z.number().int().positive(),transactionId:z.string(),kind:z.enum(['payment','refund'])}).strict();
type Processing=z.infer<typeof processedSchema>;
export const cardRecordAad=(kind:string,workspace:string,id:string)=>'ls_fishing_billing/card/v1/'+kind+'/'+workspace+'/'+id;

const canonical=cardRecordCanonical,aad=cardRecordAad;
export class FishingBillingCardEventProcessor<Frame>{
 protected readonly binding:BillingStripeBinding;private readonly key:Buffer;
 constructor(private readonly native:NativeCardEventAccess<Frame>,protected readonly ring:Keyring,digestKey:Buffer,binding:BillingStripeBinding,
  private readonly inboxAuthority:BillingStripeInboxAuthority,protected readonly provider:BillingStripeTestProvider|null=null){
  this.binding=billingStripeBindingSchema.parse(binding);requireBilling(digestKey.length>=32,'UNAVAILABLE');this.key=Buffer.from(digestKey);
 }
 protected digest(v:unknown){return createHmac('sha256',this.key).update(canonical(v)).digest('hex');}
 protected sameBinding(a:BillingStripeBinding){requireBilling(canonical(a)===canonical(this.binding),'UNAVAILABLE');}
 protected async attempt(c:BillingLedgerContext,id:string,quoteId:string):Promise<CardAttempt>{
  const row=await one<AttemptRow>(c.tx,attemptSelect+' WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[c.workspaceId,id]);if(!row)throw new AppError('NOT_FOUND');
  const a=cardAttemptSchema.parse(JSON.parse(unseal(row.ciphertext,aad('attempt',c.workspaceId,id),this.ring)));
  requireBilling(a.id===id&&a.id===a.command.operationId&&a.workspaceId===c.workspaceId&&a.quoteId===quoteId&&row.quoteId===quoteId&&
   a.command.quoteId===quoteId&&a.revision===row.revision&&a.state===row.state&&a.requestDigest===this.digest(a.command)&&
   a.preparation.operationId===id&&a.preparation.quoteId===quoteId&&a.preparation.result.attemptId===id&&
   canonical(a.preparation.result.allocations)===canonical(a.command.selection)&&a.preparation.result.amountMinor===a.command.selection.reduce((s,x)=>s+x.amountMinor,0),'UNAVAILABLE');
  this.sameBinding(a.binding);return a;
 }
 protected async save(c:BillingLedgerContext,before:CardAttempt,after:CardAttempt){
  const parsed=cardAttemptSchema.parse(after);
  requireBilling(after.revision===before.revision+1&&after.id===before.id&&after.quoteId===before.quoteId&&
   canonical(after.command)===canonical(before.command)&&canonical(after.preparation)===canonical(before.preparation),'UNAVAILABLE');
  const row=await one(c.tx,'UPDATE ls_fishing_billing.card_attempts SET revision=$4,state=$5,payload_ciphertext=$6 WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id',[c.workspaceId,before.id,before.revision,after.revision,after.state,seal(JSON.stringify(parsed),aad('attempt',c.workspaceId,before.id),this.ring)]);
  requireBilling(row,'CONFLICT');
 }
 protected async frozenRequest(c:BillingLedgerContext,a:CardAttempt):Promise<CheckoutRequest>{
  const row=await one<{quoteId:string;ciphertext:string}>(c.tx,'SELECT quote_id AS "quoteId",payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempt_requests WHERE workspace_id=$1 AND attempt_id=$2',[c.workspaceId,a.id]);requireBilling(row,'UNAVAILABLE');
  const record=requestRecordSchema.parse(JSON.parse(unseal(row!.ciphertext,aad('checkout_request',c.workspaceId,a.id),this.ring))),r=record.request;
  requireBilling(record.workspaceId===c.workspaceId&&record.attemptId===a.id&&record.quoteId===a.quoteId&&row!.quoteId===a.quoteId&&record.actorId===a.actorId&&record.digest===this.digest(r)&&
   r.operationId===a.id&&r.idempotencyKey===a.id&&r.quoteId===a.quoteId&&r.expectedVersion===a.command.expectedVersion&&
   r.amountMinor===a.preparation.result.amountMinor&&canonical(r.allocations)===canonical(a.preparation.result.allocations)&&
   r.params.client_reference_id===a.quoteId&&r.params.metadata.billing_quote_id===a.quoteId&&r.params.metadata.billing_attempt_id===a.id&&
   canonical(r.params.metadata)===canonical(r.params.payment_intent_data.metadata)&&r.params.line_items[0]!.price_data.unit_amount===r.amountMinor,'UNAVAILABLE');
  this.sameBinding(r.binding);return r;
 }
 private async event(eventId:string){
  requireBilling(/^evt_[A-Za-z0-9_]{1,150}$/.test(eventId));
  return this.native.db.transaction(async tx=>{
   await this.inboxAuthority.authorize(tx,this.native.workspaceId,this.binding);
   const row=await one<EventRow>(tx,eventSelect+' WHERE account_id=$1 AND livemode=false AND event_id=$2',[this.binding.accountId,eventId]);if(!row)throw new AppError('NOT_FOUND');
   requireBilling(row.workspaceId===this.native.workspaceId,'FORBIDDEN');
   const eventAad='ls_fishing_billing/stripe_event/v1/'+this.native.workspaceId+'/'+this.binding.accountId+'/'+eventId;
   const receipt=billingStripeSignedReceiptSchema.parse(JSON.parse(unseal(row.ciphertext,eventAad,this.ring)));
   requireBilling(receipt.eventId===eventId&&receipt.providerAccountId===this.binding.accountId&&receipt.livemode===false&&receipt.digest===row.digest,'UNAVAILABLE');
   let processed:Processing|null=null;
   if(row.state==='processed'){
    requireBilling(row.processedCiphertext,'UNAVAILABLE');
    processed=processedSchema.parse(JSON.parse(unseal(row.processedCiphertext!,aad('event_result',this.native.workspaceId,eventId),this.ring)));
    requireBilling(processed.workspaceId===row.workspaceId&&processed.accountId===this.binding.accountId&&processed.eventId===eventId&&processed.digest===receipt.digest,'UNAVAILABLE');
   }
   return {row,receipt,processed};
  });
 }
 private async finish(l:NativeCardEventLedger<Frame>,event:BillingStripeSignedReceipt,result:Processing){
  const fresh=await one<EventRow>(l.context.tx,eventSelect+' WHERE account_id=$1 AND livemode=false AND event_id=$2 FOR UPDATE',[this.binding.accountId,event.eventId]);
  requireBilling(fresh&&fresh.workspaceId===l.context.workspaceId&&fresh.digest===event.digest,'CONFLICT');
  const eventAad='ls_fishing_billing/stripe_event/v1/'+l.context.workspaceId+'/'+this.binding.accountId+'/'+event.eventId;
  const stored=billingStripeSignedReceiptSchema.parse(JSON.parse(unseal(fresh!.ciphertext,eventAad,this.ring)));
  requireBilling(canonical(stored)===canonical(event),'UNAVAILABLE');
  if(fresh!.state==='processed'){
   const original=await this.committedProcessing(l.context,event);requireBilling(original&&canonical(original)===canonical(result),'CONFLICT');return;
  }
  await l.context.tx.query('UPDATE ls_fishing_billing.stripe_events SET state=$3,processed_ciphertext=$4 WHERE account_id=$1 AND livemode=false AND event_id=$2',[this.binding.accountId,event.eventId,result.review?'review_required':'processed',seal(JSON.stringify(result),aad('event_result',l.context.workspaceId,event.eventId),this.ring)]);
 }
 private async committedProcessing(c:BillingLedgerContext,event:BillingStripeSignedReceipt){
  const row=await one<EventRow>(c.tx,eventSelect+' WHERE account_id=$1 AND livemode=false AND event_id=$2 FOR UPDATE',[this.binding.accountId,event.eventId]);
  requireBilling(row&&row.workspaceId===c.workspaceId&&row.digest===event.digest,'UNAVAILABLE');
  const eventAad='ls_fishing_billing/stripe_event/v1/'+c.workspaceId+'/'+this.binding.accountId+'/'+event.eventId;
  requireBilling(canonical(billingStripeSignedReceiptSchema.parse(JSON.parse(unseal(row!.ciphertext,eventAad,this.ring))))===canonical(event),'UNAVAILABLE');
  if(row!.state!=='processed')return null;
  requireBilling(row!.processedCiphertext,'UNAVAILABLE');
  const p=processedSchema.parse(JSON.parse(unseal(row!.processedCiphertext!,aad('event_result',c.workspaceId,event.eventId),this.ring)));
  requireBilling(p.workspaceId===c.workspaceId&&p.accountId===this.binding.accountId&&p.eventId===event.eventId&&p.digest===event.digest&&!p.review,'UNAVAILABLE');return p;
 }
 private async existingSettlement(c:BillingLedgerContext,kind:'payment'|'refund',transactionId:string){
  const row=await one<SettlementRow>(c.tx,'SELECT workspace_id AS "workspaceId",quote_id AS "quoteId",attempt_id AS "attemptId",receipt_id AS "receiptId",fact_ciphertext AS ciphertext FROM ls_fishing_billing.card_settlements WHERE account_id=$1 AND livemode=false AND kind=$2 AND transaction_id=$3 FOR UPDATE',[this.binding.accountId,kind,transactionId]);
  if(!row)return null;
  const fact=settlementSchema.parse(JSON.parse(unseal(row.ciphertext,aad('settlement',row.workspaceId,kind+'/'+transactionId),this.ring)));
  requireBilling(fact.workspaceId===c.workspaceId&&row.workspaceId===c.workspaceId&&fact.quoteId===row.quoteId&&fact.attemptId===row.attemptId&&fact.receiptId===row.receiptId&&fact.kind===kind&&fact.transactionId===transactionId&&fact.accountId===this.binding.accountId&&fact.livemode===false,'UNAVAILABLE');
  return {...row,fact};
 }
 private async saveSettlement(c:BillingLedgerContext,a:CardAttempt,r:LedgerReceipt,kind:'payment'|'refund',transactionId:string){
  const fact=settlementSchema.parse({workspaceId:c.workspaceId,quoteId:a.quoteId,attemptId:a.id,receiptId:r.id,kind,transactionId,amountMinor:r.amountMinor,accountId:this.binding.accountId,livemode:false});
  await c.tx.query('INSERT INTO ls_fishing_billing.card_settlements(account_id,livemode,kind,transaction_id,workspace_id,quote_id,attempt_id,receipt_id,fact_ciphertext) VALUES($1,false,$2,$3,$4,$5,$6,$7,$8)',[this.binding.accountId,kind,transactionId,c.workspaceId,a.quoteId,a.id,r.id,seal(JSON.stringify(fact),aad('settlement',c.workspaceId,kind+'/'+transactionId),this.ring)]);
 }
 private processing(l:NativeCardEventLedger<Frame>,a:CardAttempt,event:BillingStripeSignedReceipt,review:boolean,receiptIds:string[],reason:string|null):Processing{
  return processedSchema.parse({version:CARD_VERSION,workspaceId:l.context.workspaceId,accountId:this.binding.accountId,eventId:event.eventId,digest:event.digest,quoteId:a.quoteId,attemptId:a.id,review,receiptIds,reason});
 }
 private async hold(l:NativeCardEventLedger<Frame>,a:CardAttempt,event:BillingStripeSignedReceipt,snapshot:ProviderPaymentSnapshot,reason:string){
  const id=randomUUID(),record=cardExceptionSchema.parse({version:'JLFA-FISHING-CARD-EXCEPTION-v1',id,workspaceId:l.context.workspaceId,quoteId:a.quoteId,familyId:a.familyId,eventId:event.eventId,eventDigest:event.digest,reason,snapshot,state:'open',recordedAt:l.context.now.toISOString()});
  const old=await one<{id:string;state:string;ciphertext:string}>(l.context.tx,'SELECT id,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_exceptions WHERE workspace_id=$1 AND quote_id=$2 AND event_id=$3',[l.context.workspaceId,a.quoteId,event.eventId]);
  if(!old)await l.context.tx.query("INSERT INTO ls_fishing_billing.card_exceptions(workspace_id,id,quote_id,event_id,state,payload_ciphertext) VALUES($1,$2,$3,$4,'open',$5)",[l.context.workspaceId,id,a.quoteId,event.eventId,seal(JSON.stringify(record),aad('exception',l.context.workspaceId,id),this.ring)]);
  else{
   const previous=cardExceptionSchema.parse(JSON.parse(unseal(old.ciphertext,aad('exception',l.context.workspaceId,old.id),this.ring)));
   requireBilling(previous.id===old.id&&previous.workspaceId===l.context.workspaceId&&previous.quoteId===a.quoteId&&previous.familyId===a.familyId&&previous.eventId===event.eventId&&previous.eventDigest===event.digest&&previous.state===old.state,'UNAVAILABLE');
   await l.context.tx.query("UPDATE ls_fishing_billing.card_exceptions SET state='open',payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[l.context.workspaceId,old.id,seal(JSON.stringify({...previous,state:'open'}),aad('exception',l.context.workspaceId,old.id),this.ring)]);
  }
  const after={...a,state:'review_required' as const,revision:a.revision+1,balanceVersion:this.native.view(l.frame).quote.revision+1};
  await this.save(l.context,a,after);await l.advance();
  const result=this.processing(l,a,event,true,[],reason);await this.finish(l,event,result);return result;
 }
 async processEvent(eventId:string){
  requireBilling(this.provider,'UNAVAILABLE');
  const event=await this.event(eventId);
  if(event.processed){
   return this.native.withReconciliation(this.binding,event.processed.quoteId,async l=>{
    const p=await this.committedProcessing(l.context,event.receipt);requireBilling(p&&p.quoteId===this.native.view(l.frame).quote.id,'UNAVAILABLE');return p!;
   });
  }
  // Provider GET outside native locks. Root's adapter reads current official
  // account-bound facts; event order and redirect/query strings cannot pay.
  const snapshot=providerPaymentSnapshotSchema.parse(await this.provider!.readPayment(event.receipt,this.binding));
  requireBilling(snapshot.accountId===this.binding.accountId&&snapshot.livemode===false&&snapshot.apiVersion===this.binding.apiVersion,'FORBIDDEN');
  requireBilling(event.receipt.objectId.startsWith('cs_')?snapshot.sessionId===event.receipt.objectId:
   event.receipt.objectId.startsWith('pi_')?snapshot.paymentIntentId===event.receipt.objectId:
   event.receipt.objectId.startsWith('re_')?snapshot.refunds.some(r=>r.id===event.receipt.objectId):false,'CONFLICT');
  return this.native.withReconciliation(this.binding,snapshot.quoteId,async l=>{
   const completed=await this.committedProcessing(l.context,event.receipt);
   if(completed){requireBilling(completed.quoteId===this.native.view(l.frame).quote.id&&completed.attemptId===snapshot.attemptId,'FORBIDDEN');return completed;}
   const a=await this.attempt(l.context,snapshot.attemptId,snapshot.quoteId);
   requireBilling(a.familyId===this.native.view(l.frame).quote.familyId&&this.native.view(l.frame).quote.acceptance,'FORBIDDEN');
   if(!a.dispatchId)return this.hold(l,a,event.receipt,snapshot,'never_dispatched_funds');
   if(a.sessionId!==null&&a.sessionId!==snapshot.sessionId)return this.hold(l,a,event.receipt,snapshot,'session_mismatch');
   if(snapshot.amountMinor!==a.preparation.result.amountMinor)return this.hold(l,a,event.receipt,snapshot,'amount_mismatch');
   if(Date.parse(snapshot.observedAt)>l.context.now.valueOf()||snapshot.paidAt&&Date.parse(snapshot.paidAt)>l.context.now.valueOf())return this.hold(l,a,event.receipt,snapshot,'future_provider_fact');
   const known=await this.existingSettlement(l.context,'payment',snapshot.paymentIntentId);
   if(known&&(known.quoteId!==a.quoteId||known.attemptId!==a.id))return this.hold(l,a,event.receipt,snapshot,'transaction_already_bound');
   if(known&&(known.fact.amountMinor!==snapshot.receivedMinor||snapshot.status!=='paid'))return this.hold(l,a,event.receipt,snapshot,'provider_state_conflict');
   if(snapshot.status!=='paid'&&snapshot.receivedMinor!==0)return this.hold(l,a,event.receipt,snapshot,'received_funds_unreconciled');
   if(snapshot.status==='paid'&&(!snapshot.paidAt||snapshot.receivedMinor!==a.preparation.result.amountMinor))return this.hold(l,a,event.receipt,snapshot,'received_amount_mismatch');
   const additions:LedgerReceipt[]=[],settlements:{r:LedgerReceipt;kind:'payment'|'refund';id:string}[]=[];
   const matching=known?this.native.view(l.frame).receipts.find(r=>r.id===known.receiptId):undefined;
   let payment=matching?ledgerReceiptSchema.parse(matching):undefined;
   if(known)requireBilling(payment&&payment.kind==='card'&&payment.provider?.accountId===this.binding.accountId&&payment.provider.transactionId===snapshot.paymentIntentId&&payment.amountMinor===known.fact.amountMinor,'UNAVAILABLE');
   if(snapshot.status==='paid'&&!payment){
    payment=ledgerReceiptSchema.parse({id:randomUUID(),operationId:randomUUID(),quoteId:a.quoteId,familyId:a.familyId,kind:'card',currency:'USD',
     amountMinor:snapshot.receivedMinor,allocations:a.preparation.result.allocations,originalReceiptId:null,actorId:null,reason:null,
     receivedAt:snapshot.paidAt,recordedAt:l.context.now.toISOString(),provider:{accountId:this.binding.accountId,mode:'test',transactionId:snapshot.paymentIntentId}});
    additions.push(payment);settlements.push({r:payment,kind:'payment',id:snapshot.paymentIntentId});
   }
   let holdReason:string|null=snapshot.dispute==='none'?null:'dispute_requires_reconciliation';
   for(const refund of snapshot.refunds.filter(r=>r.state==='succeeded')){
    const prior=await this.existingSettlement(l.context,'refund',refund.id);
    if(prior){requireBilling(prior.quoteId===a.quoteId&&prior.attemptId===a.id&&prior.fact.amountMinor===refund.amountMinor,'CONFLICT');continue;}
    if(!payment){holdReason='refund_before_payment_unresolved';break;}
    const allocations=await this.native.refundAllocations(l.context,l.frame,refund,payment);
    if(!allocations||allocations.reduce((s,x)=>s+x.amountMinor,0)!==refund.amountMinor){holdReason='refund_allocation_required';break;}
    const r=ledgerReceiptSchema.parse({id:randomUUID(),operationId:randomUUID(),quoteId:a.quoteId,familyId:a.familyId,kind:'refund',currency:'USD',
     amountMinor:refund.amountMinor,allocations,originalReceiptId:payment.id,actorId:null,reason:'Verified provider refund; native allocation',
     receivedAt:refund.occurredAt,recordedAt:l.context.now.toISOString(),provider:{accountId:this.binding.accountId,mode:'test',transactionId:refund.id}});
    additions.push(r);settlements.push({r,kind:'refund',id:refund.id});
   }
   if(holdReason)return this.hold(l,a,event.receipt,snapshot,holdReason);
   // Native advance validates additions against the complete current fact set
   // in this same transaction before persisting them; no V1 quote conversion.
   const nextState=snapshot.status==='paid'?'paid' as const:snapshot.status==='failed'?'failed' as const:'pending' as const;
   if(additions.length||a.state!==nextState){
    const after={...a,state:nextState,revision:a.revision+1,balanceVersion:this.native.view(l.frame).quote.revision+1,sessionId:snapshot.sessionId,paymentIntentId:snapshot.paymentIntentId};
    await this.save(l.context,a,after);await l.advance(additions);
    for(const s of settlements)await this.saveSettlement(l.context,a,s.r,s.kind,s.id);
   }
   const oldException=await one<{id:string;state:string;ciphertext:string}>(l.context.tx,'SELECT id,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_exceptions WHERE workspace_id=$1 AND quote_id=$2 AND event_id=$3',[l.context.workspaceId,a.quoteId,eventId]);
   if(oldException){
    const e=cardExceptionSchema.parse(JSON.parse(unseal(oldException.ciphertext,aad('exception',l.context.workspaceId,oldException.id),this.ring)));
    requireBilling(e.id===oldException.id&&e.workspaceId===l.context.workspaceId&&e.quoteId===a.quoteId&&e.familyId===a.familyId&&e.eventId===eventId&&e.eventDigest===event.receipt.digest&&e.state===oldException.state,'UNAVAILABLE');
    await l.context.tx.query("UPDATE ls_fishing_billing.card_exceptions SET state='resolved',payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[l.context.workspaceId,e.id,seal(JSON.stringify({...e,state:'resolved'}),aad('exception',l.context.workspaceId,e.id),this.ring)]);
   }
   const result=this.processing(l,a,event.receipt,false,settlements.map(s=>s.r.id),null);await this.finish(l,event.receipt,result);return result;
  });
 }
}
