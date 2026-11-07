import 'server-only';
import {createHmac,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one} from '../identity/store.ts';
import type {Actor} from '../identity/types.ts';
import {
 billingId,ledgerReceiptSchema,type LedgerReceipt,type FamilyOffer,
} from './contracts.ts';
import {requireBilling,projectBalance} from './domain.ts';
import {FishingBillingStore,type BillingCardLedger,type BillingLedgerContext} from './native.ts';
import {
 prepareBillingTestCheckout,billingStripeSignedReceiptSchema,
 type BillingStripeSignedReceipt,type BillingStripeInboxAuthority,
} from './stripe-test.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from './card-binding.ts';
import {
 CARD_VERSION,prepareCardCommandSchema,cardAttemptSchema,cardPreparationReceiptSchema,
 providerPaymentSnapshotSchema,cardSessionResultSchema,cardExceptionSchema,
 type CardAttempt,type ProviderPaymentSnapshot,type ProviderRefund,
} from './card-contracts.ts';

type CheckoutRequest=ReturnType<typeof prepareBillingTestCheckout>;
type Allocation=LedgerReceipt['allocations'][number];
/** Root's reviewed official-SDK adapter only. It must enforce the current
 * effect-specific test account/service admission immediately before an SDK
 * effect, preserve request idempotency and tag creation with the required
 * integration_identifier+8randomletters. No environment reader or transport
 * is installed by this module; null denies all provider work. */
export interface BillingStripeTestProvider{
 createCheckout(request:CheckoutRequest):Promise<z.infer<typeof cardSessionResultSchema>>;
 readPayment(receipt:BillingStripeSignedReceipt,binding:BillingStripeBinding):Promise<ProviderPaymentSnapshot>;
}
export interface BillingRefundAllocationAuthority{
 /** Read the separately approved native refund allocation. No inferred sibling
  * policy and no refund request is executed here. Null means hold for review. */
 allocations(context:BillingLedgerContext,quote:FamilyOffer,refund:ProviderRefund,original:LedgerReceipt):Promise<Allocation[]|null>;
}
type AttemptRow={id:string;quoteId:string;revision:number;state:CardAttempt['state'];ciphertext:string};
type EventRow={workspaceId:string;digest:string;ciphertext:string;state:string;processedCiphertext:string|null};
type SettlementRow={workspaceId:string;quoteId:string;attemptId:string;receiptId:string;ciphertext:string};
const attemptSelect='SELECT id,quote_id AS "quoteId",revision,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempts';
const eventSelect='SELECT workspace_id AS "workspaceId",body_digest AS digest,receipt_ciphertext AS ciphertext,state,processed_ciphertext AS "processedCiphertext" FROM ls_fishing_billing.stripe_events';
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
const processedSchema=z.object({
 version:z.literal(CARD_VERSION),workspaceId:billingId,accountId:z.string(),eventId:z.string(),digest:z.string(),
 quoteId:billingId,attemptId:billingId,review:z.boolean(),receiptIds:z.array(billingId),reason:z.string().nullable(),
}).strict();
const settlementSchema=z.object({workspaceId:billingId,quoteId:billingId,attemptId:billingId,receiptId:billingId,accountId:z.string(),livemode:z.literal(false),amountMinor:z.number().int().positive(),transactionId:z.string(),kind:z.enum(['payment','refund'])}).strict();
type Processing=z.infer<typeof processedSchema>;
const aad=(kind:string,workspace:string,id:string)=>'ls_fishing_billing/card/v1/'+kind+'/'+workspace+'/'+id;
export class FishingBillingCards{
 private readonly binding:BillingStripeBinding;private readonly key:Buffer;
 constructor(
  private readonly ledger:FishingBillingStore,private readonly ring:Keyring,digestKey:Buffer,
  private readonly configuration:{binding:BillingStripeBinding;cardOnlyConfigurationId:string;approvedProductLabel:string},
  private readonly inboxAuthority:BillingStripeInboxAuthority,
  private readonly provider:BillingStripeTestProvider|null=null,
  private readonly refundAuthority:BillingRefundAllocationAuthority|null=null,
 ){
  this.binding=billingStripeBindingSchema.parse(configuration.binding);requireBilling(digestKey.length>=32,'UNAVAILABLE');this.key=Buffer.from(digestKey);
 }
 private digest(v:unknown){return createHmac('sha256',this.key).update(canonical(v)).digest('hex');}
 private sameBinding(a:BillingStripeBinding){requireBilling(canonical(a)===canonical(this.binding),'UNAVAILABLE');}
 private async attempt(c:BillingLedgerContext,id:string,quoteId:string):Promise<CardAttempt>{
  const row=await one<AttemptRow>(c.tx,attemptSelect+' WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[c.workspaceId,id]);if(!row)throw new AppError('NOT_FOUND');
  const a=cardAttemptSchema.parse(JSON.parse(unseal(row.ciphertext,aad('attempt',c.workspaceId,id),this.ring)));
  requireBilling(a.id===id&&a.id===a.command.operationId&&a.workspaceId===c.workspaceId&&a.quoteId===quoteId&&row.quoteId===quoteId&&
   a.command.quoteId===quoteId&&a.revision===row.revision&&a.state===row.state&&a.requestDigest===this.digest(a.command)&&
   a.preparation.operationId===id&&a.preparation.quoteId===quoteId&&a.preparation.result.attemptId===id&&
   canonical(a.preparation.result.allocations)===canonical(a.command.selection)&&a.preparation.result.amountMinor===a.command.selection.reduce((s,x)=>s+x.amountMinor,0),'UNAVAILABLE');
  this.sameBinding(a.binding);return a;
 }
 private async save(c:BillingLedgerContext,before:CardAttempt,after:CardAttempt){
  const parsed=cardAttemptSchema.parse(after);
  requireBilling(after.revision===before.revision+1&&after.id===before.id&&after.quoteId===before.quoteId&&
   canonical(after.command)===canonical(before.command)&&canonical(after.preparation)===canonical(before.preparation),'UNAVAILABLE');
  const row=await one(c.tx,'UPDATE ls_fishing_billing.card_attempts SET revision=$4,state=$5,payload_ciphertext=$6 WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id',[c.workspaceId,before.id,before.revision,after.revision,after.state,seal(JSON.stringify(parsed),aad('attempt',c.workspaceId,before.id),this.ring)]);
  requireBilling(row,'CONFLICT');
 }
 async prepare(actor:Actor,raw:unknown){
  const cmd=prepareCardCommandSchema.parse(raw);
  return this.ledger.withCardActor(actor,cmd.quoteId,async l=>{
   const exists=await one(l.context.tx,'SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND id=$2',[l.context.workspaceId,cmd.operationId]);
   if(exists){
    const a=await this.attempt(l.context,cmd.operationId,cmd.quoteId);
    requireBilling(a.actorId===l.actor.id&&a.requestDigest===this.digest(cmd),'CONFLICT');
    return {...a.preparation,replayed:true};
   }
   requireBilling(l.quote.revision===cmd.expectedVersion,'CONFLICT');
   requireBilling(!['review_required','overpaid'].includes(l.balance.state),'UNAVAILABLE');
   const active=await l.context.tx.query("SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND quote_id=$2 AND state IN('prepared','unknown','open','pending')",[l.context.workspaceId,l.quote.id]);
   requireBilling(active.length===0,'CONFLICT');
   const request=prepareBillingTestCheckout({quote:l.quote,balance:l.balance,operationId:cmd.operationId,selection:cmd.selection,...this.configuration});
   const preparation=cardPreparationReceiptSchema.parse({version:CARD_VERSION,operationId:cmd.operationId,quoteId:cmd.quoteId,entityVersion:l.quote.revision+1,replayed:false,result:{attemptId:cmd.operationId,amountMinor:request.amountMinor,allocations:request.allocations}});
   const a=cardAttemptSchema.parse({
    version:CARD_VERSION,id:cmd.operationId,workspaceId:l.context.workspaceId,quoteId:l.quote.id,familyId:l.quote.familyId,
    actorId:l.actor.id,revision:1,balanceVersion:preparation.entityVersion,binding:this.binding,command:cmd,
    requestDigest:this.digest(cmd),preparation,createdAt:l.context.now.toISOString(),state:'prepared',
    dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null,
   });
   await l.context.tx.query('INSERT INTO ls_fishing_billing.card_attempts(workspace_id,id,quote_id,revision,state,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[l.context.workspaceId,a.id,a.quoteId,a.revision,a.state,seal(JSON.stringify(a),aad('attempt',l.context.workspaceId,a.id),this.ring)]);
   await l.advance();return preparation;
  });
 }
 async readAttempt(actor:Actor,quoteId:string,attemptId:string){
  billingId.parse(quoteId);billingId.parse(attemptId);
  return this.ledger.withCardActor(actor,quoteId,async l=>{
   const a=await this.attempt(l.context,attemptId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');return a;
  });
 }
 async readPreparationReceipt(actor:Actor,quoteId:string,operationId:string){
  billingId.parse(operationId);
  return this.ledger.withCardActor(actor,quoteId,async l=>{
   const exists=await one(l.context.tx,'SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND id=$2',[l.context.workspaceId,operationId]);if(!exists)return null;
   const a=await this.attempt(l.context,operationId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');return {...a.preparation,replayed:true};
  });
 }
 async createCheckout(actor:Actor,quoteId:string,attemptId:string){
  requireBilling(this.provider,'UNAVAILABLE');
  // Reject missing/revoked service binding BEFORE reserving or calling a provider.
  await this.ledger.withCardService(this.binding,quoteId,async()=>undefined);
  const reserved=await this.ledger.withCardActor(actor,quoteId,async l=>{
   const a=await this.attempt(l.context,attemptId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');
   if(a.state!=='prepared')return {dispatch:false as const,attempt:a};
   if(l.quote.revision!==a.balanceVersion||l.quote.state!=='accepted'||l.quote.paused||['review_required','overpaid'].includes(l.balance.state)){
    const stale={...a,state:'stale' as const,revision:a.revision+1,balanceVersion:l.quote.revision+1};
    await this.save(l.context,a,stale);await l.advance();return {dispatch:false as const,attempt:stale};
   }
   const request=prepareBillingTestCheckout({quote:l.quote,balance:l.balance,operationId:a.id,selection:a.preparation.result.allocations,...this.configuration});
   const unknown={...a,state:'unknown' as const,dispatchId:randomUUID(),revision:a.revision+1,balanceVersion:l.quote.revision+1};
   await this.save(l.context,a,unknown);await l.advance();return {dispatch:true as const,attempt:unknown,request};
  });
  if(!reserved.dispatch)return reserved.attempt;
  let session:z.infer<typeof cardSessionResultSchema>;
  try{session=cardSessionResultSchema.parse(await this.provider!.createCheckout(reserved.request));}
  catch{return reserved.attempt;} // UNKNOWN is durable; no automatic new key/retry.
  requireBilling(session.accountId===this.binding.accountId&&session.livemode===false&&session.apiVersion===this.binding.apiVersion&&
   session.quoteId===quoteId&&session.attemptId===attemptId&&session.amountMinor===reserved.request.amountMinor&&session.currency==='USD'&&session.paymentStatus!=='no_payment_required','CONFLICT');
  const url=new URL(session.url);requireBilling(url.origin==='https://checkout.stripe.com'&&!url.username&&!url.password,'UNAVAILABLE');
  return this.ledger.withCardService(this.binding,quoteId,async l=>{
   const a=await this.attempt(l.context,attemptId,quoteId);
   requireBilling(a.dispatchId===reserved.attempt.dispatchId&&a.state==='unknown','CONFLICT');
   const stale=l.quote.revision!==a.balanceVersion||l.quote.state!=='accepted'||l.quote.paused||l.balance.remainingMinor===0;
   const after={...a,revision:a.revision+1,balanceVersion:l.quote.revision+1,state:stale?'stale' as const:'open' as const,sessionId:session.id,checkoutUrl:session.url};
   await this.save(l.context,a,after);await l.advance();return after;
  });
 }
 private async event(eventId:string){
  requireBilling(/^evt_[A-Za-z0-9_]{1,150}$/.test(eventId));
  return this.ledger.db.transaction(async tx=>{
   await this.inboxAuthority.authorize(tx,this.ledger.workspaceId,this.binding);
   const row=await one<EventRow>(tx,eventSelect+' WHERE account_id=$1 AND livemode=false AND event_id=$2',[this.binding.accountId,eventId]);if(!row)throw new AppError('NOT_FOUND');
   requireBilling(row.workspaceId===this.ledger.workspaceId,'FORBIDDEN');
   const eventAad='ls_fishing_billing/stripe_event/v1/'+this.ledger.workspaceId+'/'+this.binding.accountId+'/'+eventId;
   const receipt=billingStripeSignedReceiptSchema.parse(JSON.parse(unseal(row.ciphertext,eventAad,this.ring)));
   requireBilling(receipt.eventId===eventId&&receipt.providerAccountId===this.binding.accountId&&receipt.livemode===false&&receipt.digest===row.digest,'UNAVAILABLE');
   let processed:Processing|null=null;
   if(row.state==='processed'){
    requireBilling(row.processedCiphertext,'UNAVAILABLE');
    processed=processedSchema.parse(JSON.parse(unseal(row.processedCiphertext!,aad('event_result',this.ledger.workspaceId,eventId),this.ring)));
    requireBilling(processed.workspaceId===row.workspaceId&&processed.accountId===this.binding.accountId&&processed.eventId===eventId&&processed.digest===receipt.digest,'UNAVAILABLE');
   }
   return {row,receipt,processed};
  });
 }
 private async finish(l:BillingCardLedger,event:BillingStripeSignedReceipt,result:Processing){
  const fresh=await one<EventRow>(l.context.tx,eventSelect+' WHERE account_id=$1 AND livemode=false AND event_id=$2 FOR UPDATE',[this.binding.accountId,event.eventId]);
  requireBilling(fresh&&fresh.workspaceId===l.context.workspaceId&&fresh.digest===event.digest,'CONFLICT');
  const eventAad='ls_fishing_billing/stripe_event/v1/'+l.context.workspaceId+'/'+this.binding.accountId+'/'+event.eventId;
  const stored=billingStripeSignedReceiptSchema.parse(JSON.parse(unseal(fresh!.ciphertext,eventAad,this.ring)));
  requireBilling(canonical(stored)===canonical(event),'UNAVAILABLE');
  await l.context.tx.query('UPDATE ls_fishing_billing.stripe_events SET state=$3,processed_ciphertext=$4 WHERE account_id=$1 AND livemode=false AND event_id=$2',[this.binding.accountId,event.eventId,result.review?'review_required':'processed',seal(JSON.stringify(result),aad('event_result',l.context.workspaceId,event.eventId),this.ring)]);
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
 private processing(l:BillingCardLedger,a:CardAttempt,event:BillingStripeSignedReceipt,review:boolean,receiptIds:string[],reason:string|null):Processing{
  return processedSchema.parse({version:CARD_VERSION,workspaceId:l.context.workspaceId,accountId:this.binding.accountId,eventId:event.eventId,digest:event.digest,quoteId:a.quoteId,attemptId:a.id,review,receiptIds,reason});
 }
 private async hold(l:BillingCardLedger,a:CardAttempt,event:BillingStripeSignedReceipt,snapshot:ProviderPaymentSnapshot,reason:string){
  const id=randomUUID(),record=cardExceptionSchema.parse({version:'JLFA-FISHING-CARD-EXCEPTION-v1',id,workspaceId:l.context.workspaceId,quoteId:a.quoteId,familyId:a.familyId,eventId:event.eventId,eventDigest:event.digest,reason,snapshot,state:'open',recordedAt:l.context.now.toISOString()});
  const old=await one<{id:string;state:string;ciphertext:string}>(l.context.tx,'SELECT id,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_exceptions WHERE workspace_id=$1 AND quote_id=$2 AND event_id=$3',[l.context.workspaceId,a.quoteId,event.eventId]);
  if(!old)await l.context.tx.query("INSERT INTO ls_fishing_billing.card_exceptions(workspace_id,id,quote_id,event_id,state,payload_ciphertext) VALUES($1,$2,$3,$4,'open',$5)",[l.context.workspaceId,id,a.quoteId,event.eventId,seal(JSON.stringify(record),aad('exception',l.context.workspaceId,id),this.ring)]);
  else{
   const previous=cardExceptionSchema.parse(JSON.parse(unseal(old.ciphertext,aad('exception',l.context.workspaceId,old.id),this.ring)));
   requireBilling(previous.id===old.id&&previous.workspaceId===l.context.workspaceId&&previous.quoteId===a.quoteId&&previous.familyId===a.familyId&&previous.eventId===event.eventId&&previous.eventDigest===event.digest&&previous.state===old.state,'UNAVAILABLE');
   await l.context.tx.query("UPDATE ls_fishing_billing.card_exceptions SET state='open',payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[l.context.workspaceId,old.id,seal(JSON.stringify({...previous,state:'open'}),aad('exception',l.context.workspaceId,old.id),this.ring)]);
  }
  const after={...a,state:'review_required' as const,revision:a.revision+1,balanceVersion:l.quote.revision+1};
  await this.save(l.context,a,after);await l.advance();
  const result=this.processing(l,a,event,true,[],reason);await this.finish(l,event,result);return result;
 }
 async processEvent(eventId:string){
  requireBilling(this.provider,'UNAVAILABLE');
  const event=await this.event(eventId);
  if(event.processed){
   return this.ledger.withCardService(this.binding,event.processed.quoteId,async()=>event.processed!);
  }
  // Provider GET outside native locks. Root's adapter reads current official
  // account-bound facts; event order and redirect/query strings cannot pay.
  const snapshot=providerPaymentSnapshotSchema.parse(await this.provider!.readPayment(event.receipt,this.binding));
  requireBilling(snapshot.accountId===this.binding.accountId&&snapshot.livemode===false&&snapshot.apiVersion===this.binding.apiVersion,'FORBIDDEN');
  requireBilling(event.receipt.objectId.startsWith('cs_')?snapshot.sessionId===event.receipt.objectId:
   event.receipt.objectId.startsWith('pi_')?snapshot.paymentIntentId===event.receipt.objectId:
   event.receipt.objectId.startsWith('re_')?snapshot.refunds.some(r=>r.id===event.receipt.objectId):false,'CONFLICT');
  return this.ledger.withCardService(this.binding,snapshot.quoteId,async l=>{
   const a=await this.attempt(l.context,snapshot.attemptId,snapshot.quoteId);
   requireBilling(a.familyId===l.quote.familyId&&l.quote.acceptance,'FORBIDDEN');
   if(a.sessionId!==null&&a.sessionId!==snapshot.sessionId)return this.hold(l,a,event.receipt,snapshot,'session_mismatch');
   if(snapshot.amountMinor!==a.preparation.result.amountMinor)return this.hold(l,a,event.receipt,snapshot,'amount_mismatch');
   if(Date.parse(snapshot.observedAt)>l.context.now.valueOf()||snapshot.paidAt&&Date.parse(snapshot.paidAt)>l.context.now.valueOf())return this.hold(l,a,event.receipt,snapshot,'future_provider_fact');
   const known=await this.existingSettlement(l.context,'payment',snapshot.paymentIntentId);
   if(known&&(known.quoteId!==a.quoteId||known.attemptId!==a.id))return this.hold(l,a,event.receipt,snapshot,'transaction_already_bound');
   if(known&&(known.fact.amountMinor!==snapshot.receivedMinor||snapshot.status!=='paid'))return this.hold(l,a,event.receipt,snapshot,'provider_state_conflict');
   if(snapshot.status!=='paid'&&snapshot.receivedMinor!==0)return this.hold(l,a,event.receipt,snapshot,'received_funds_unreconciled');
   if(snapshot.status==='paid'&&(!snapshot.paidAt||snapshot.receivedMinor!==a.preparation.result.amountMinor))return this.hold(l,a,event.receipt,snapshot,'received_amount_mismatch');
   const additions:LedgerReceipt[]=[],settlements:{r:LedgerReceipt;kind:'payment'|'refund';id:string}[]=[];
   let payment=known?l.receipts.find(r=>r.id===known.receiptId):undefined;
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
    const allocations=this.refundAuthority?await this.refundAuthority.allocations(l.context,l.quote,refund,payment):null;
    if(!allocations||allocations.reduce((s,x)=>s+x.amountMinor,0)!==refund.amountMinor){holdReason='refund_allocation_required';break;}
    const r=ledgerReceiptSchema.parse({id:randomUUID(),operationId:randomUUID(),quoteId:a.quoteId,familyId:a.familyId,kind:'refund',currency:'USD',
     amountMinor:refund.amountMinor,allocations,originalReceiptId:payment.id,actorId:null,reason:'Verified provider refund; native allocation',
     receivedAt:refund.occurredAt,recordedAt:l.context.now.toISOString(),provider:{accountId:this.binding.accountId,mode:'test',transactionId:refund.id}});
    additions.push(r);settlements.push({r,kind:'refund',id:refund.id});
   }
   if(holdReason)return this.hold(l,a,event.receipt,snapshot,holdReason);
   projectBalance(l.quote,[...l.receipts,...additions]);
   const nextState=snapshot.status==='paid'?'paid' as const:snapshot.status==='failed'?'failed' as const:'pending' as const;
   if(additions.length||a.state!==nextState){
    const after={...a,state:nextState,revision:a.revision+1,balanceVersion:l.quote.revision+1,sessionId:snapshot.sessionId,paymentIntentId:snapshot.paymentIntentId};
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
