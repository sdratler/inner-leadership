import 'server-only';
import {randomUUID,randomInt} from 'node:crypto';
import {z} from 'zod';
import {seal,type Keyring} from '../identity/crypto.ts';
import {one} from '../identity/store.ts';
import type {Actor} from '../identity/types.ts';
import {
 billingId,type LedgerReceipt,type FamilyOffer,
} from './contracts.ts';
import {requireBilling} from './domain.ts';
import type {FishingBillingStore,BillingLedgerContext} from './native.ts';
import type {CurrentLedgerFrameV3} from '../../lib/fishing-billing-current-contract-v3.ts';
import {
 prepareBillingCurrentTestCheckoutV3,
 type BillingStripeSignedReceipt,type BillingStripeInboxAuthority,
} from './stripe-test.ts';
import {type BillingStripeBinding} from './card-binding.ts';
import {
 CARD_VERSION,prepareCardCommandSchema,cardAttemptSchema,cardPreparationReceiptSchema,
 cardSessionResultSchema,
 type ProviderPaymentSnapshot,type ProviderRefund,
} from './card-contracts.ts';

import {frozenRequestSchema,requestRecordSchema,type CheckoutRequest} from './card-checkout-request.ts';

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
export interface BillingCurrentRefundAllocationAuthorityV3{
 /** Current source/provenance and full authenticated balance, with the same
  * separately approved native allocation. No inferred or executed refund. */
 allocations(context:BillingLedgerContext,frame:CurrentLedgerFrameV3,refund:ProviderRefund,original:LedgerReceipt):Promise<Allocation[]|null>;
}
import {FishingBillingCardEventProcessor,cardRecordAad as aad} from './card-event-processor.ts';

export class FishingBillingCards extends FishingBillingCardEventProcessor<CurrentLedgerFrameV3>{
 constructor(
  private readonly ledger:FishingBillingStore,ring:Keyring,digestKey:Buffer,
  private readonly configuration:{binding:BillingStripeBinding;cardOnlyConfigurationId:string;approvedProductLabel:string},
  inboxAuthority:BillingStripeInboxAuthority,
  provider:BillingStripeTestProvider|null=null,
  refundAuthority:BillingRefundAllocationAuthority|null=null,
  currentRefundAuthority:BillingCurrentRefundAllocationAuthorityV3|null=null,
 ){
  super({db:ledger.db,workspaceId:ledger.workspaceId,
   withReconciliation:(binding,id,work)=>ledger.withCurrentCardServiceV3(binding,id,work),
   view:frame=>({quote:frame.source.quote,receipts:frame.balance.receipts}),
   refundAllocations:async(c,frame,refund,original)=>currentRefundAuthority?currentRefundAuthority.allocations(c,frame,refund,original):
    frame.source.kind==='historical_account'&&refundAuthority?refundAuthority.allocations(c,frame.source.quote,refund,original):null,
  },ring,digestKey,configuration.binding,inboxAuthority,provider);
 }
 async prepare(actor:Actor,raw:unknown){
  const cmd=prepareCardCommandSchema.parse(raw);
  return this.ledger.withCurrentCardActorV3(actor,cmd.quoteId,async l=>{
   const exists=await one(l.context.tx,'SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND id=$2',[l.context.workspaceId,cmd.operationId]);
   if(exists){
    const a=await this.attempt(l.context,cmd.operationId,cmd.quoteId);
    requireBilling(a.actorId===l.actor.id&&a.requestDigest===this.digest(cmd),'CONFLICT');
    return {...a.preparation,replayed:true};
   }
   requireBilling(l.frame.source.quote.revision===cmd.expectedVersion,'CONFLICT');
   requireBilling(!['review_required','overpaid'].includes(l.frame.balance.state),'UNAVAILABLE');
   const active=await l.context.tx.query("SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND quote_id=$2 AND state IN('prepared','unknown','open','pending')",[l.context.workspaceId,l.frame.source.quote.id]);
   requireBilling(active.length===0,'CONFLICT');
   const draft=prepareBillingCurrentTestCheckoutV3({frame:l.frame,operationId:cmd.operationId,selection:cmd.selection,...this.configuration});
   const identifier='jlfa_monthly_'+Array.from({length:8},()=>String.fromCharCode(97+randomInt(26))).join('');
   const request=frozenRequestSchema.parse({...draft,params:{...draft.params,integration_identifier:identifier}});
   const preparation=cardPreparationReceiptSchema.parse({version:CARD_VERSION,operationId:cmd.operationId,quoteId:cmd.quoteId,entityVersion:l.frame.source.quote.revision+1,replayed:false,result:{attemptId:cmd.operationId,amountMinor:request.amountMinor,allocations:request.allocations}});
   const a=cardAttemptSchema.parse({
    version:CARD_VERSION,id:cmd.operationId,workspaceId:l.context.workspaceId,quoteId:l.frame.source.quote.id,familyId:l.frame.source.quote.familyId,
    actorId:l.actor.id,revision:1,balanceVersion:preparation.entityVersion,binding:this.binding,command:cmd,
    requestDigest:this.digest(cmd),preparation,createdAt:l.context.now.toISOString(),state:'prepared',
    dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null,
   });
   await l.context.tx.query('INSERT INTO ls_fishing_billing.card_attempts(workspace_id,id,quote_id,revision,state,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[l.context.workspaceId,a.id,a.quoteId,a.revision,a.state,seal(JSON.stringify(a),aad('attempt',l.context.workspaceId,a.id),this.ring)]);
   const record=requestRecordSchema.parse({version:'JLFA-FISHING-CHECKOUT-REQUEST-v1',workspaceId:l.context.workspaceId,attemptId:a.id,quoteId:a.quoteId,actorId:a.actorId,digest:this.digest(request),request});
   await l.context.tx.query('INSERT INTO ls_fishing_billing.card_attempt_requests(workspace_id,attempt_id,quote_id,payload_ciphertext) VALUES($1,$2,$3,$4)',[l.context.workspaceId,a.id,a.quoteId,seal(JSON.stringify(record),aad('checkout_request',l.context.workspaceId,a.id),this.ring)]);
   await l.advance();return preparation;
  });
 }
 async readAttempt(actor:Actor,quoteId:string,attemptId:string){
  billingId.parse(quoteId);billingId.parse(attemptId);
  return this.ledger.withCurrentCardActorV3(actor,quoteId,async l=>{
   const a=await this.attempt(l.context,attemptId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');return a;
  });
 }
 async readPreparationReceipt(actor:Actor,quoteId:string,operationId:string){
  billingId.parse(operationId);
  return this.ledger.withCurrentCardActorV3(actor,quoteId,async l=>{
   const exists=await one(l.context.tx,'SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND id=$2',[l.context.workspaceId,operationId]);if(!exists)return null;
   const a=await this.attempt(l.context,operationId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');return {...a.preparation,replayed:true};
  });
 }
 async createCheckout(actor:Actor,quoteId:string,attemptId:string){
  requireBilling(this.provider,'UNAVAILABLE');
  // Reject missing/revoked service binding BEFORE reserving or calling a provider.
  await this.ledger.withCurrentCardServiceV3(this.binding,quoteId,async()=>undefined);
  const reserved=await this.ledger.withCurrentCardActorV3(actor,quoteId,async l=>{
   const a=await this.attempt(l.context,attemptId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');
   if(a.state!=='prepared')return {dispatch:false as const,attempt:a};
   if(l.frame.source.quote.revision!==a.balanceVersion||l.frame.source.quote.state!=='accepted'||l.frame.source.quote.paused||['review_required','overpaid'].includes(l.frame.balance.state)){
    const stale={...a,state:'stale' as const,revision:a.revision+1,balanceVersion:l.frame.source.quote.revision+1};
    await this.save(l.context,a,stale);await l.advance();return {dispatch:false as const,attempt:stale};
   }
   const request=await this.frozenRequest(l.context,a);
   requireBilling(request.allocations.every(x=>x.amountMinor<=(l.frame.balance.lines.find(line=>line.lineId===x.lineId)?.remainingMinor??0)),'CONFLICT');
   const unknown={...a,state:'unknown' as const,dispatchId:randomUUID(),revision:a.revision+1,balanceVersion:l.frame.source.quote.revision+1};
   await this.save(l.context,a,unknown);await l.advance();return {dispatch:true as const,attempt:unknown,request};
  });
  if(!reserved.dispatch)return reserved.attempt;
  let session:z.infer<typeof cardSessionResultSchema>;
  try{session=cardSessionResultSchema.parse(await this.provider!.createCheckout(reserved.request));}
  catch{return reserved.attempt;} // UNKNOWN is durable; no automatic new key/retry.
  requireBilling(session.accountId===this.binding.accountId&&session.livemode===false&&session.apiVersion===this.binding.apiVersion&&
   session.quoteId===quoteId&&session.attemptId===attemptId&&session.amountMinor===reserved.request.amountMinor&&session.currency==='USD'&&session.paymentStatus!=='no_payment_required','CONFLICT');
  const url=new URL(session.url);requireBilling(url.origin==='https://checkout.stripe.com'&&!url.username&&!url.password,'UNAVAILABLE');
  return this.ledger.withCurrentCardServiceV3(this.binding,quoteId,async l=>{
   const a=await this.attempt(l.context,attemptId,quoteId);
   requireBilling(a.dispatchId===reserved.attempt.dispatchId,'CONFLICT');
   if(a.state!=='unknown'){
    requireBilling(a.sessionId===session.id&&['paid','pending','failed'].includes(a.state),'CONFLICT');return a;
   }
   const stale=l.frame.source.quote.revision!==a.balanceVersion||l.frame.source.quote.state!=='accepted'||l.frame.source.quote.paused||l.frame.balance.remainingMinor===0;
   const after={...a,revision:a.revision+1,balanceVersion:l.frame.source.quote.revision+1,state:stale?'stale' as const:'open' as const,sessionId:session.id,checkoutUrl:session.url};
   await this.save(l.context,a,after);await l.advance();return after;
  });
 }
}
