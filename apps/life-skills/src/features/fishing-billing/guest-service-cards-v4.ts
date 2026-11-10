import 'server-only';
import {randomUUID,randomInt} from 'node:crypto';
import {one,type IdentityStore} from '../identity/store.ts';
import {seal,type Keyring} from '../identity/crypto.ts';
import type {Actor,WorkspaceId} from '../identity/types.ts';
import {billingId} from './contracts.ts';
import {requireBilling} from './domain.ts';
import type {BillingStripeBinding} from './card-binding.ts';
import {prepareBillingServiceTestCheckoutV4,type BillingStripeInboxAuthority} from './stripe-test.ts';
import {CARD_VERSION,prepareCardCommandSchema,cardAttemptSchema,cardPreparationReceiptSchema,type PrepareCardCommand} from './card-contracts.ts';
import {frozenRequestSchema,requestRecordSchema} from './card-checkout-request.ts';
import {cardRecordAad as aad} from './card-event-processor.ts';
import type {BillingStripeTestProvider} from './cards.ts';
import {FishingServiceCardEventsV4,type ServiceRefundAllocationAuthorityV4} from './guest-service-card-events-v4.ts';
import {FishingServiceCurrentCardV4} from './guest-service-current-card-v4.ts';
import {FishingServiceBillingOwnerV4} from './guest-service-owner-financial-v4.ts';
import type {ServiceCurrentCardLedgerV4} from './guest-service-current-card-contract-v4.ts';
import type {AccountFacts} from '../identity/types.ts';

/** Existing card storage/protocol with actual V4 owner preparation and durable
 * reservation, plus the shared event reconciler. No SDK creation/transport is
 * invoked here. A reserved request is UNKNOWN, never sent/paid/permission to
 * charge; future provider execution needs Root's actual effect admission.
 * Repeated reservation cannot emit a second dispatch or idempotency key. */
export class FishingServiceBillingCardsV4 extends FishingServiceCardEventsV4{
 constructor(db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly current:FishingServiceCurrentCardV4,private readonly owner:FishingServiceBillingOwnerV4,
  ring:Keyring,digestKey:Buffer,private readonly configuration:{binding:BillingStripeBinding;cardOnlyConfigurationId:string;approvedProductLabel:string},inbox:BillingStripeInboxAuthority,
  provider:BillingStripeTestProvider|null=null,refund:ServiceRefundAllocationAuthorityV4|null=null){
  super(db,workspaceId,current,ring,digestKey,configuration.binding,inbox,provider,refund);
 }
 private withOwner<T>(actor:Actor,id:string,work:(ledger:ServiceCurrentCardLedgerV4&{actor:Readonly<AccountFacts>})=>Promise<T>){
  return this.owner.withCurrentCardActorV4(actor,id,l=>{requireBilling(l.context.workspaceId===this.workspaceId,'FORBIDDEN');return work(l);});
 }
 private async original(l:ServiceCurrentCardLedgerV4&{actor:Readonly<AccountFacts>},cmd:PrepareCardCommand){
  const exists=await one(l.context.tx,'SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND id=$2',[l.context.workspaceId,cmd.operationId]);if(!exists)return null;
  const a=await this.attempt(l.context,cmd.operationId,cmd.quoteId);requireBilling(a.actorId===l.actor.id&&a.requestDigest===this.digest(cmd),'CONFLICT');return a;
 }
 async prepare(actor:Actor,raw:unknown){
  const cmd=prepareCardCommandSchema.parse(raw);
  return this.withOwner(actor,cmd.quoteId,async l=>{
   const previous=await this.original(l,cmd);if(previous)return {...previous.preparation,replayed:true};
   const q=l.frame.quote;requireBilling(q.revision===cmd.expectedVersion,'CONFLICT');
   requireBilling(!['review_required','overpaid'].includes(l.frame.balance.state),'UNAVAILABLE');
   const active=await l.context.tx.query("SELECT id FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND quote_id=$2 AND state IN('prepared','unknown','open','pending')",[l.context.workspaceId,q.id]);requireBilling(active.length===0,'CONFLICT');
   const draft=prepareBillingServiceTestCheckoutV4({frame:l.frame,operationId:cmd.operationId,selection:cmd.selection,...this.configuration});
   const identifier='jlfa_monthly_'+Array.from({length:8},()=>String.fromCharCode(97+randomInt(26))).join('');
   const request=frozenRequestSchema.parse({...draft,params:{...draft.params,integration_identifier:identifier}});
   const preparation=cardPreparationReceiptSchema.parse({version:CARD_VERSION,operationId:cmd.operationId,quoteId:q.id,entityVersion:q.revision+1,replayed:false,result:{attemptId:cmd.operationId,amountMinor:request.amountMinor,allocations:request.allocations}});
   const a=cardAttemptSchema.parse({version:CARD_VERSION,id:cmd.operationId,workspaceId:l.context.workspaceId,quoteId:q.id,familyId:q.familyId,actorId:l.actor.id,revision:1,balanceVersion:preparation.entityVersion,binding:this.binding,command:cmd,requestDigest:this.digest(cmd),preparation,createdAt:l.context.now.toISOString(),state:'prepared',dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
   await l.context.tx.query('INSERT INTO ls_fishing_billing.card_attempts(workspace_id,id,quote_id,revision,state,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6)',[l.context.workspaceId,a.id,q.id,1,a.state,seal(JSON.stringify(a),aad('attempt',l.context.workspaceId,a.id),this.ring)]);
   const record=requestRecordSchema.parse({version:'JLFA-FISHING-CHECKOUT-REQUEST-v1',workspaceId:l.context.workspaceId,attemptId:a.id,quoteId:q.id,actorId:a.actorId,digest:this.digest(request),request});
   await l.context.tx.query('INSERT INTO ls_fishing_billing.card_attempt_requests(workspace_id,attempt_id,quote_id,payload_ciphertext) VALUES($1,$2,$3,$4)',[l.context.workspaceId,a.id,q.id,seal(JSON.stringify(record),aad('checkout_request',l.context.workspaceId,a.id),this.ring)]);
   await l.advance();return preparation;
  });
 }
 /** Exact original command only; this lookup never creates an absent attempt.
  * Original preparation is not evidence that today's balance is still payable. */
 async readPreparationReceipt(actor:Actor,raw:unknown){
  const cmd=prepareCardCommandSchema.parse(raw);return this.withOwner(actor,cmd.quoteId,async l=>{const a=await this.original(l,cmd);return a?{...a.preparation,replayed:true}:null;});
 }
 async readAttempt(actor:Actor,quoteId:string,attemptId:string){
  billingId.parse(quoteId);billingId.parse(attemptId);return this.withOwner(actor,quoteId,async l=>{const a=await this.attempt(l.context,attemptId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');return a;});
 }
 async reserveCheckout(actor:Actor,quoteId:string,attemptId:string){
  billingId.parse(quoteId);billingId.parse(attemptId);
  requireBilling(this.provider,'UNAVAILABLE');
  // Existing independent service gate, not owner impersonation or SDK access.
  await this.current.withCurrentCardServiceV4(this.binding,quoteId,async()=>undefined);
  return this.withOwner(actor,quoteId,async l=>{
   const a=await this.attempt(l.context,attemptId,quoteId);requireBilling(a.actorId===l.actor.id,'FORBIDDEN');
   if(a.state!=='prepared')return {dispatch:false as const,attempt:a};
   const q=l.frame.quote;
   if(q.revision!==a.balanceVersion||q.state!=='accepted'||q.paused||['review_required','overpaid'].includes(l.frame.balance.state)){
    const stale={...a,state:'stale' as const,revision:a.revision+1,balanceVersion:q.revision+1};await this.save(l.context,a,stale);await l.advance();return {dispatch:false as const,attempt:stale};
   }
   const request=await this.frozenRequest(l.context,a);
   requireBilling(request.allocations.every(x=>x.amountMinor<=(l.frame.balance.lines.find(line=>line.lineId===x.lineId)?.remainingMinor??0)),'CONFLICT');
   const unknown={...a,state:'unknown' as const,dispatchId:randomUUID(),revision:a.revision+1,balanceVersion:q.revision+1};
   await this.save(l.context,a,unknown);await l.advance();return {dispatch:true as const,attempt:unknown,request};
  });
 }
}
