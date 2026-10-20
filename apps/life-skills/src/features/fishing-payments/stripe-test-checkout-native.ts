import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {asId} from '../../lib/ids.ts';
import {lockWorkspace} from '../identity/data.ts';
import {one} from '../identity/store.ts';
import type {Actor,SqlSession} from '../fishing/contract.ts';
import {approvedOffer,digest,invariant} from './domain.ts';
import {FishingPaymentStore} from './store.ts';
import type {NativeContext,ProviderOperation,PurchaseRecord,Receipt} from './ports.ts';
import {checkoutBindingSchema,checkoutProviderId,checkoutRequestDigest,assertCheckoutCreateWindow,validateCheckoutContext,validateCheckoutKnown,validateCheckoutClaim,validateCheckoutObservation,validateCheckoutReturnUrls,validateCheckoutUrl,publishCheckoutRedirect,type StripeTestCheckoutBinding,type StripeTestCheckoutContext,type CheckoutKnownBinding,type CheckoutDispatchClaim,type CheckoutObservation,type CheckoutRedirect,type CheckoutReturnUrls,type CheckoutPublicationBoundary} from './stripe-test-checkout-ports.ts';

const uuid=z.uuid(),opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),sha=z.string().regex(/^[a-f0-9]{64}$/),pid=checkoutProviderId;
const customerSchema=z.object({id:uuid,revision:z.number().int().positive(),payerAccountId:uuid,customerId:pid('cus'),merchantBindingId:opaque,apiVersion:z.literal('2026-09-30.endive'),verifiedAt:z.date(),revokedAt:z.date().nullable()});
const resultSchema=z.strictObject({kind:z.literal('hosted_invoice'),providerObjectId:pid('in'),url:z.string().max(2048),providerAccountId:pid('acct'),livemode:z.literal(false),currency:z.literal('USD'),amountCents:z.number().int().positive(),purchaseId:uuid,dueId:opaque,idempotencyKey:opaque});
const operationSchema=z.strictObject({id:uuid,kind:z.literal('hosted_invoice'),workspaceId:uuid,purchaseId:uuid,dueId:opaque,refundPaymentId:z.null(),providerAccountId:pid('acct'),livemode:z.literal(false),amountCents:z.number().int().positive().max(100000000),currency:z.literal('USD'),idempotencyKey:opaque,state:z.enum(['reserved','unknown','confirmed']),requestDigest:sha,result:resultSchema.nullable()});
const decisionSchema=z.strictObject({decisionId:opaque,revision:sha});
const receiptSchema=z.strictObject({eventId:pid('evt'),eventType:z.string().min(1).max(100),objectId:pid('cs'),providerAccountId:pid('acct'),livemode:z.literal(false),apiVersion:z.literal('2026-09-30.endive'),digest:sha,createdAt:z.iso.datetime({offset:true})});
const claimSchema=z.strictObject({context:z.unknown(),dispatch:z.unknown(),known:z.unknown(),authorityRevision:sha});
const terminalSchema=z.strictObject({sessionId:pid('cs'),status:z.enum(['complete','expired'])});
export const checkoutNativeJournalActions=Object.freeze({intent:'stripe-test.checkout.intent',claim:'stripe-test.checkout.claim',consumed:'stripe-test.checkout.consumed',pending:'stripe-test.checkout.pending',observed:'stripe-test.checkout.observed',read:'stripe-test.checkout.read',terminal:'stripe-test.checkout.terminal',published:'stripe-test.checkout.published',promoted:'stripe-test.checkout.promoted'});
const A=checkoutNativeJournalActions;
type Journal={actorId:string;value:unknown;hash:string;at:Date};
type SaveContext={tx:SqlSession;actor:{id:string;workspaceId:string};now:Date};
export type CheckoutNativeCustomer=Readonly<z.infer<typeof customerSchema>>;
export type CheckoutNativePurpose='prepare'|'dispatch'|'inspect'|'publish'|'promote';
export type CheckoutNativeAdmission=Readonly<Pick<StripeTestCheckoutContext,'entryPoint'|'schedule'|'agreements'|'window'|'expiresAt'>&{revision:string;effectDecisionId:string}>;
export type CheckoutNativeClaim=Readonly<{context:StripeTestCheckoutContext;dispatch:CheckoutDispatchClaim;known:CheckoutKnownBinding|null;authorityRevision:string}>;

/** Trusted CURRENT server capabilities, not flags, browser DTOs or approval-ID
 * assertions. Root must load actual guardian/fit/capacity, reviewed EN/HE legal
 * acceptance, merchant/effect admission and finite schedule in this transaction.
 * Revisions must cover those records and remain stable across read purposes.
 * expire uses the separate financial-owner closure authority after revocation.
 * promotion independently verifies the observed invoice/PI/customer chain for
 * the committed signed receipt. It grants references only, never cash/entitlement.
 * These callbacks run INSIDE a transaction: no provider/network I/O. Root must
 * obtain any additional strict provider readback beforehand, then verify its
 * exact server-held proof and current native revisions in promotion here.
 * Missing capability leaves this coordinator unmounted/fail-closed. */
export interface NativeStripeCheckoutPolicy{
 load(c:NativeContext,purchase:PurchaseRecord,customer:CheckoutNativeCustomer,purpose:CheckoutNativePurpose,dueId:string):Promise<CheckoutNativeAdmission>;
 expire(c:NativeContext,purchase:PurchaseRecord,customer:CheckoutNativeCustomer,context:StripeTestCheckoutContext,known:CheckoutKnownBinding):Promise<z.infer<typeof decisionSchema>>;
 promotion(c:NativeContext,purchase:PurchaseRecord,context:StripeTestCheckoutContext,known:CheckoutKnownBinding,observation:CheckoutObservation,receipt:Receipt):Promise<void>;
}

/** Source183 candidate, no SDK/env/network/SQL schema changes. Journal entries
 * reuse existing commands; pending cs_ never enters invoice_id NOT NULL tables.
 * Legacy hosted_invoice operation_json remains EXACT and uses the same unique
 * purchased due and GLOBAL operation.dispatch fence as the invoice coordinator.
 * All I/O is supplied by Root OUTSIDE transactions: claim/consume -> provider ->
 * observe, or inspect known ID -> provider GET -> reconcile -> publish/promote.
 * Lost create without a committed ID remains UNKNOWN; no new generation/search.
 * Durable intent/pending journals survive no browser return and coordinator
 * reconstruction. Root's existing admitted operator/dispatcher owns recovery;
 * this class starts no job, loop, scheduler, provider call or message.
 */
export class NativeStripeCheckoutCoordinator implements CheckoutPublicationBoundary{
 readonly #binding:StripeTestCheckoutBinding;readonly #urls:CheckoutReturnUrls;
 constructor(private readonly store:FishingPaymentStore,private readonly policy:NativeStripeCheckoutPolicy|null,urls:CheckoutReturnUrls){this.#binding=Object.freeze(checkoutBindingSchema.parse(store.deps.merchant));this.#urls=validateCheckoutReturnUrls(urls);}
 private async journal(tx:SqlSession,workspace:string,action:string,key:string):Promise<Journal|null>{
  const rows=await tx.query<Journal>('SELECT actor_id AS "actorId",result_json AS value,digest AS hash,created_at AS at FROM ls_fishing_payments.commands WHERE workspace_id=$1 AND action=$2 AND command_id=$3 AND octet_length(result_json::text)<=131072 ORDER BY actor_id LIMIT 2 FOR SHARE',[workspace,action,key]);
  invariant(rows.length<=1,'CONFLICT');const row=rows[0];if(!row)return null;invariant(row.hash===digest(row.value)&&row.at instanceof Date,'UNAVAILABLE');return row;
 }
 private async save(c:SaveContext,action:string,key:string,value:unknown){
  opaque.parse(key);invariant(Buffer.byteLength(JSON.stringify(value))<=131072,'UNAVAILABLE');const old=await this.journal(c.tx,c.actor.workspaceId,action,key);if(old){invariant(old.hash===digest(value),'CONFLICT');return;}
  await c.tx.query('INSERT INTO ls_fishing_payments.commands(workspace_id,actor_id,action,command_id,digest,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[c.actor.workspaceId,c.actor.id,action,key,digest(value),JSON.stringify(value),c.now]);
 }
 private async operation(c:SaveContext,id:string):Promise<ProviderOperation>{
  const row=await one<{purchaseId:string;kind:string;dueId:string;hash:string;value:unknown}>(c.tx,'SELECT purchase_id AS "purchaseId",kind,due_id AS "dueId",request_digest AS hash,operation_json AS value FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND id=$2 AND octet_length(operation_json::text)<=131072 FOR UPDATE',[c.actor.workspaceId,uuid.parse(id)]);invariant(row,'NOT_FOUND');
  const op=operationSchema.parse(row.value);invariant(op.workspaceId===c.actor.workspaceId&&op.id===id&&op.purchaseId===row.purchaseId&&op.kind===row.kind&&op.dueId===row.dueId&&op.requestDigest===row.hash&&op.providerAccountId===this.#binding.accountId&&op.idempotencyKey===`rm:${op.workspaceId}:${op.id}`&&(op.state==='confirmed'?op.result!==null:op.result===null),'CONFLICT');return op;
 }
 private async customer(c:NativeContext,p:PurchaseRecord,historicalId?:string){
  const rows=await c.tx.query('SELECT id,revision,payer_account_id AS "payerAccountId",customer_id AS "customerId",merchant_binding_id AS "merchantBindingId",api_version AS "apiVersion",verified_at AS "verifiedAt",revoked_at AS "revokedAt" FROM ls_fishing_payments.customer_bindings WHERE workspace_id=$1 AND payer_account_id=$2 AND provider_account_id=$3 AND livemode=false AND '+(historicalId?'id=$4':'revoked_at IS NULL')+' ORDER BY id LIMIT 2 FOR SHARE',historicalId?[c.actor.workspaceId,p.offer.payerAccountId,this.#binding.accountId,uuid.parse(historicalId)]:[c.actor.workspaceId,p.offer.payerAccountId,this.#binding.accountId]);
  invariant(rows.length===1,'APPROVAL_REQUIRED');const customer=customerSchema.parse(rows[0]);invariant(customer.verifiedAt<=c.now&&customer.merchantBindingId===this.#binding.verifiedBindingId&&(!customer.revokedAt||!!historicalId),'APPROVAL_REQUIRED');return customer;
 }
 private async authority(c:NativeContext,p:PurchaseRecord,dueId:string,purpose:CheckoutNativePurpose){
  await this.store.access(c,p.offer,purpose==='inspect'||purpose==='promote'?'read':'hosted');
  const canonical=await this.store.deps.authority.loadApprovedOffer(c.tx,c.actor,p.offer.id);invariant(canonical&&digest(approvedOffer(canonical))===digest(p.offer),'APPROVAL_CHANGED');
  invariant(p.state.providerAccountId===this.#binding.accountId&&!p.state.livemode&&p.state.dues.some(d=>d.id===dueId),'CONFLICT');
  if(purpose==='prepare'||purpose==='dispatch'||purpose==='publish'){
   await this.store.assertHostedActivationAllowed(c,p.offer);const due=p.state.dues.find(d=>d.id===dueId),issued=await this.store.loadOffer(c,p.offer.id);invariant(due&&due.paidCents===0&&issued.state==='approved','DUE_NOT_PAYABLE');
   if(due.index===1||p.state.dues[0]?.state!=='paid')invariant(Date.parse(p.offer.expiresAt)>c.now.valueOf(),'OFFER_EXPIRED');
  }
 }
 private async snapshot(c:NativeContext,p:PurchaseRecord,customer:CheckoutNativeCustomer,operationId:string,dueId:string,purpose:CheckoutNativePurpose){
  invariant(this.policy,'APPROVAL_REQUIRED');await this.authority(c,p,dueId,purpose);const a=await this.policy.load(c,p,customer,purpose,dueId);sha.parse(a.revision);opaque.parse(a.effectDecisionId);
  const context=validateCheckoutContext({offer:p.offer,offerDigest:digest(p.offer),purchaseId:p.state.purchaseId,purchaseLineId:p.line.id,dueId,operationId,generation:1,entryPoint:a.entryPoint,schedule:a.schedule,scheduleDigest:digest(a.schedule),authorizationVersion:digest({revision:a.revision,effectDecisionId:a.effectDecisionId,customerId:customer.id,customerRevision:customer.revision}),customer:{bindingId:customer.id,revision:customer.revision,payerAccountId:customer.payerAccountId,customerId:customer.customerId,merchantBindingId:customer.merchantBindingId,verifiedAt:customer.verifiedAt.toISOString()},agreements:a.agreements,window:a.window,expiresAt:a.expiresAt},this.#binding);
  return {context,effectDecisionId:a.effectDecisionId};
 }
 private async current(c:NativeContext,operationId:string,purpose:CheckoutNativePurpose){
  const op=await this.operation(c,operationId),intent=await this.journal(c.tx,c.actor.workspaceId,A.intent,op.id);invariant(intent,'CHECKOUT_INTENT_REQUIRED');const prior=validateCheckoutContext(intent.value,this.#binding),p=await this.store.purchase(c,op.purchaseId),customer=await this.customer(c,p);
  const due=p.line.dues.find(d=>d.id===op.dueId);invariant(due&&prior.operationId===op.id&&prior.purchaseId===op.purchaseId&&prior.purchaseLineId===p.line.id&&op.dueId===prior.dueId&&op.amountCents===due.amountCents&&op.requestDigest===digest([p.offer.id,p.offer.revision,p.line.id,due]),'CONFLICT');const actual=await this.snapshot(c,p,customer,op.id,prior.dueId,purpose);invariant(digest(actual.context)===digest(prior),'CONFLICT');
  return {...actual,op,purchase:p,customer};
 }
 private async known(c:SaveContext,context:StripeTestCheckoutContext){const row=await this.journal(c.tx,c.actor.workspaceId,A.pending,context.operationId);return row?validateCheckoutKnown(row.value,context):null;}
 private async fence(c:SaveContext,operationId:string,phase:'create'|'expire'){return one(c.tx,'SELECT id FROM ls_fishing_payments.outbox WHERE workspace_id=$1 AND topic=$2 AND aggregate_id=$3 AND revision=1 FOR SHARE',[c.actor.workspaceId,phase==='create'?'operation.dispatch':'stripe-test.checkout.expire.dispatch',operationId]);}
 private async consumed(c:SaveContext,claim:CheckoutNativeClaim){const row=await this.journal(c.tx,c.actor.workspaceId,A.consumed,claim.context.operationId+':'+claim.dispatch.phase);return !!row&&row.hash===digest({claimId:claim.dispatch.id,claimDigest:digest(claim)})&&!!await this.fence(c,claim.context.operationId,claim.dispatch.phase);}
 private async createConsumed(c:SaveContext,operationId:string){const row=await this.journal(c.tx,c.actor.workspaceId,A.claim,operationId+':create');return !!row&&await this.consumed(c,this.parseClaim(row.value));}
 private parseClaim(raw:unknown):CheckoutNativeClaim{
  const s=claimSchema.parse(raw),context=validateCheckoutContext(s.context,this.#binding),known=s.known===null?null:validateCheckoutKnown(s.known,context),phase=z.object({phase:z.enum(['create','expire'])}).parse(s.dispatch).phase;
  invariant(context.generation===1&&(phase==='create'?known===null:known!==null),'CONFLICT');const dispatch=validateCheckoutClaim(s.dispatch,context,phase,this.#urls,known?.sessionId??null);return {context,known,dispatch,authorityRevision:s.authorityRevision};
 }
 async prepare(actor:Actor,commandId:string,purchaseId:string,dueId:string){
  const initial=await this.store.command(actor,commandId,'stripe-test.checkout.prepare',{purchaseId,dueId},async c=>{const rows=await c.tx.query<{id:string}>("SELECT id FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 AND due_id=$3 AND kind='hosted_invoice' FOR UPDATE",[c.actor.workspaceId,purchaseId,dueId]);invariant(rows.length<=1,'CONFLICT');if(rows[0]){const current=await this.current(c,rows[0].id,'prepare');invariant(c.now.valueOf()<Date.parse(current.context.expiresAt),'OFFER_EXPIRED');}else{const p=await this.store.purchase(c,purchaseId),customer=await this.customer(c,p),check=await this.snapshot(c,p,customer,randomUUID(),dueId,'prepare');assertCheckoutCreateWindow(check.context,c.now);}},async c=>{
   const rows=await c.tx.query<{id:string}>("SELECT id FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 AND due_id=$3 AND kind='hosted_invoice' FOR UPDATE",[c.actor.workspaceId,purchaseId,dueId]);invariant(rows.length<=1,'CONFLICT');if(rows[0])return (await this.current(c,rows[0].id,'prepare')).context;
   const p=await this.store.purchase(c,purchaseId),customer=await this.customer(c,p),operationId=randomUUID(),{context}=await this.snapshot(c,p,customer,operationId,dueId,'prepare');assertCheckoutCreateWindow(context,c.now);const due=p.line.dues.find(d=>d.id===dueId)!;
   const op:ProviderOperation={id:operationId,kind:'hosted_invoice',workspaceId:c.actor.workspaceId,purchaseId,dueId,refundPaymentId:null,providerAccountId:this.#binding.accountId,livemode:false,amountCents:due.amountCents,currency:'USD',idempotencyKey:`rm:${c.actor.workspaceId}:${operationId}`,state:'reserved',requestDigest:digest([p.offer.id,p.offer.revision,p.line.id,due]),result:null};
   await c.tx.query('INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[c.actor.workspaceId,op.id,purchaseId,op.kind,dueId,op.requestDigest,JSON.stringify(op)]);await this.save(c,A.intent,op.id,context);await this.store.event(c,'operation.reserved',op.id,1);return context;
  });
  return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const current=await this.current(c,initial.operationId,'prepare');invariant(c.now.valueOf()<Date.parse(current.context.expiresAt),'OFFER_EXPIRED');return current.context;});
 }
 private async expiryAuthority(c:NativeContext,context:StripeTestCheckoutContext,known:CheckoutKnownBinding){
  invariant(this.policy&&c.actor.role==='practitioner','APPROVAL_REQUIRED');const p=await this.store.purchase(c,context.purchaseId),customer=await this.customer(c,p,context.customer.bindingId);
  const pending=await this.known(c,context);invariant(pending&&digest(pending)===digest(known),'CONFLICT');
  const verified=await one(c.tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active' AND email_verified_at<=clock_timestamp() FOR SHARE",[c.actor.workspaceId,c.actor.id]);
  invariant(verified&&p.offer.operatorAccountId===c.actor.id&&digest(p.offer)===context.offerDigest&&p.line.id===context.purchaseLineId&&customer.customerId===context.customer.customerId&&customer.payerAccountId===context.customer.payerAccountId&&customer.verifiedAt.toISOString()===context.customer.verifiedAt&&customer.revision>=context.customer.revision,'APPROVAL_REQUIRED');
  return decisionSchema.parse(await this.policy.expire(c,p,customer,context,known));
 }
 async claim(actor:Actor,commandId:string,operationId:string,phase:'create'|'expire'):Promise<CheckoutNativeClaim>{
  invariant(phase==='create'||phase==='expire','CONFLICT');
  const authorize=async(c:NativeContext)=>{if(phase==='create'){const current=await this.current(c,operationId,'dispatch');assertCheckoutCreateWindow(current.context,c.now);}else{const intent=await this.journal(c.tx,c.actor.workspaceId,A.intent,uuid.parse(operationId));invariant(intent,'NOT_FOUND');const context=validateCheckoutContext(intent.value,this.#binding),known=await this.known(c,context);invariant(known,'UNKNOWN_CREATE');await this.expiryAuthority(c,context,known);}};
  return this.store.command(actor,commandId,'stripe-test.checkout.claim.request',{operationId,phase},authorize,async c=>{
   const old=await this.journal(c.tx,c.actor.workspaceId,A.claim,operationId+':'+phase);if(old)return this.parseClaim(old.value);
   const intent=await this.journal(c.tx,c.actor.workspaceId,A.intent,operationId);invariant(intent,'NOT_FOUND');const context=validateCheckoutContext(intent.value,this.#binding),known=await this.known(c,context),op=await this.operation(c,operationId);let authorityRevision:string,effectDecisionId:string;
   if(phase==='create'){invariant(op.state==='reserved'&&!known&&!await this.journal(c.tx,c.actor.workspaceId,A.claim,operationId+':expire'),'CONFLICT');const current=await this.current(c,operationId,'dispatch');authorityRevision=context.authorizationVersion;effectDecisionId=current.effectDecisionId;await c.tx.query('UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,op.id,JSON.stringify({...op,state:'unknown'})]);}
   else{invariant(known&&op.state!=='reserved','UNKNOWN_CREATE');const decision=await this.expiryAuthority(c,context,known);authorityRevision=decision.revision;effectDecisionId=decision.decisionId;}
   const dispatch:CheckoutDispatchClaim={id:randomUUID(),phase,operationId,generation:1,contextDigest:digest(context),requestDigest:checkoutRequestDigest(context,phase,this.#urls,known?.sessionId??null),idempotencyKey:`rm:${c.actor.workspaceId}:${operationId}:checkout:1:${phase}`,effectDecisionId,sessionId:known?.sessionId??null};
   const claim=this.parseClaim({context,known:phase==='create'?null:known,dispatch,authorityRevision});await this.save(c,A.claim,operationId+':'+phase,claim);return claim;
  });
 }
 async consume(actor:Actor,raw:CheckoutNativeClaim){
  const claim=this.parseClaim(raw),{context,dispatch}=claim;
  return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const saved=await this.journal(c.tx,c.actor.workspaceId,A.claim,context.operationId+':'+dispatch.phase);invariant(saved?.hash===digest(claim),'CONFLICT');const op=await this.operation(c,context.operationId);
   if(dispatch.phase==='create'){const current=await this.current(c,op.id,'dispatch');invariant(op.state==='unknown'&&digest(current.context)===digest(context)&&current.effectDecisionId===dispatch.effectDecisionId,'CONFLICT');assertCheckoutCreateWindow(context,c.now);}
   else{invariant(claim.known,'UNKNOWN_CREATE');const decision=await this.expiryAuthority(c,context,claim.known);invariant(decision.decisionId===dispatch.effectDecisionId&&decision.revision===claim.authorityRevision,'APPROVAL_CHANGED');}
   const rows=await c.tx.query('INSERT INTO ls_fishing_payments.outbox(id,workspace_id,topic,aggregate_id,revision,recorded_at) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT DO NOTHING RETURNING id',[randomUUID(),c.actor.workspaceId,dispatch.phase==='create'?'operation.dispatch':'stripe-test.checkout.expire.dispatch',context.operationId,c.now]);if(rows.length!==1)return false;await this.save(c,A.consumed,context.operationId+':'+dispatch.phase,{claimId:dispatch.id,claimDigest:digest(claim)});return true;
  });
 }
 private async record(c:SaveContext,context:StripeTestCheckoutContext,known:CheckoutKnownBinding,raw:CheckoutObservation,action:string,key:string){
  const checked=validateCheckoutObservation(raw,context,known),terminal=await this.journal(c.tx,c.actor.workspaceId,A.terminal,context.operationId);if(terminal){const t=terminalSchema.parse(terminal.value);invariant(t.sessionId===known.sessionId&&t.status===checked.status,'CONFLICT');}
  await this.save(c,action,key,checked);if(checked.status!=='open')await this.save(c,A.terminal,context.operationId,{sessionId:known.sessionId,status:checked.status});return checked;
 }
 async observe(raw:CheckoutNativeClaim,observation:CheckoutObservation):Promise<void>{
  const claim=this.parseClaim(raw),{context,dispatch}=claim,workspace=asId(context.offer.workspaceId,'workspace');await this.store.deps.database.transaction(async tx=>{await lockWorkspace(tx,workspace);
   const saved=await this.journal(tx,workspace,A.claim,context.operationId+':'+dispatch.phase);invariant(saved?.hash===digest(claim),'CONFLICT');const c={tx,actor:{id:saved.actorId,workspaceId:workspace},now:this.store.deps.clock.now()};await this.operation(c,context.operationId);invariant(await this.consumed(c,claim),'CONFLICT');const checked=validateCheckoutObservation(observation,context,claim.known??undefined);let known=await this.known(c,context);
   if(dispatch.phase==='create'){invariant(checked.status==='open'&&checked.paymentStatus==='unpaid'&&checked.url,'CONFLICT');if(!known){known={id:randomUUID(),revision:1,sessionId:checked.sessionId,contextDigest:digest(context),operationId:context.operationId,purchaseId:context.purchaseId,purchaseLineId:context.purchaseLineId,dueId:context.dueId,customerBindingId:context.customer.bindingId,offerDigest:context.offerDigest,scheduleDigest:context.scheduleDigest};await this.save(c,A.pending,context.operationId,known);}}
   else invariant(claim.known&&checked.status!=='open','CONFLICT');invariant(known&&known.sessionId===checked.sessionId,'CONFLICT');await this.record(c,context,known,checked,A.observed,context.operationId+':'+dispatch.phase);
  });
 }
 async inspect(actor:Actor,operationId:string){return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const {context}=await this.current(c,operationId,'inspect');return {context,known:await this.known(c,context)};});}
 /** Read-only historical financial-owner authority, including after ordinary
  * customer/guardian revocation. Checking expiry here creates no closure claim. */
 async inspectForExpiry(actor:Actor,operationId:string){return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const intent=await this.journal(c.tx,c.actor.workspaceId,A.intent,uuid.parse(operationId));invariant(intent,'NOT_FOUND');const context=validateCheckoutContext(intent.value,this.#binding),known=await this.known(c,context);invariant(known,'UNKNOWN_CREATE');await this.expiryAuthority(c,context,known);return {context,known};});}
 async inspectExpiry(actor:Actor,operationId:string){return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const row=await this.journal(c.tx,c.actor.workspaceId,A.claim,uuid.parse(operationId)+':expire');invariant(row,'NOT_FOUND');const claim=this.parseClaim(row.value);invariant(claim.known,'UNKNOWN_CREATE');const decision=await this.expiryAuthority(c,claim.context,claim.known);invariant(decision.decisionId===claim.dispatch.effectDecisionId&&decision.revision===claim.authorityRevision&&await this.consumed(c,claim),'APPROVAL_CHANGED');return claim;});}
 async reconcile(actor:Actor,commandId:string,operationId:string,observation:CheckoutObservation){
  return this.store.command(actor,commandId,'stripe-test.checkout.reconcile',{operationId,observation:digest(observation)},async c=>{const {context}=await this.current(c,operationId,'inspect'),known=await this.known(c,context);invariant(known&&await this.createConsumed(c,operationId),'UNKNOWN_CREATE');validateCheckoutObservation(observation,context,known);},async c=>{const {context}=await this.current(c,operationId,'inspect'),known=await this.known(c,context);invariant(known,'UNKNOWN_CREATE');await this.record(c,context,known,observation,A.read,operationId+':'+digest(observation));return {state:'observed' as const};});
 }
 command<T>(actor:Actor,commandId:string,body:unknown,authorize:(c:NativeContext)=>Promise<void>,work:(c:NativeContext)=>Promise<T>){return this.store.command(actor,commandId,'stripe-test.checkout.publish.request',body,authorize,work);}
 async authorizePublication(c:NativeContext,context:StripeTestCheckoutContext,known:CheckoutKnownBinding){
  await lockWorkspace(c.tx,c.actor.workspaceId);const current=await this.current(c,context.operationId,'publish'),pending=await this.known(c,context);invariant(digest(current.context)===digest(context)&&pending&&digest(pending)===digest(validateCheckoutKnown(known,context))&&await this.createConsumed(c,context.operationId),'CONFLICT');
  invariant(!await this.journal(c.tx,c.actor.workspaceId,A.claim,context.operationId+':expire')&&!await this.journal(c.tx,c.actor.workspaceId,A.terminal,context.operationId)&&c.now.valueOf()<Date.parse(context.expiresAt),'APPROVAL_REQUIRED');
 }
 private async recorded(c:SaveContext,context:StripeTestCheckoutContext,o:CheckoutObservation){const created=await this.journal(c.tx,c.actor.workspaceId,A.observed,context.operationId+':create'),read=await this.journal(c.tx,c.actor.workspaceId,A.read,context.operationId+':'+digest(o));invariant(created?.hash===digest(o)||read?.hash===digest(o),'OBSERVATION_REQUIRED');}
 async publish(c:NativeContext,context:StripeTestCheckoutContext,known:CheckoutKnownBinding,observation:CheckoutObservation):Promise<CheckoutRedirect>{
  await this.authorizePublication(c,context,known);const o=validateCheckoutObservation(observation,context,known);invariant(o.status==='open'&&o.paymentStatus==='unpaid'&&o.url,'CONFLICT');await this.recorded(c,context,o);
  const ready:CheckoutRedirect={state:'ready',operationId:context.operationId,purchaseId:context.purchaseId,dueId:context.dueId,sessionId:known.sessionId,url:validateCheckoutUrl(o.url)};await this.save(c,A.published,context.operationId,ready);return ready;
 }
 redirect(actor:Actor,commandId:string,context:StripeTestCheckoutContext,known:CheckoutKnownBinding,observation:CheckoutObservation){return publishCheckoutRedirect(actor,commandId,context,known,observation,this);}
 private async receipt(c:NativeContext,context:StripeTestCheckoutContext,known:CheckoutKnownBinding,eventId:string){
  const row=await one<{receipt:unknown;hash:string}>(c.tx,'SELECT receipt_json AS receipt,digest AS hash FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=false AND event_id=$2 AND octet_length(receipt_json::text)<=131072 FOR SHARE',[this.#binding.accountId,pid('evt').parse(eventId)]);invariant(row,'NATIVE_RECEIPT_REQUIRED');const receipt=receiptSchema.parse(row.receipt);
  invariant(receipt.eventId===eventId&&receipt.objectId===known.sessionId&&receipt.providerAccountId===this.#binding.accountId&&receipt.digest===row.hash&&Date.parse(receipt.createdAt)<=c.now.valueOf()&&['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(receipt.eventType)&&known.contextDigest===digest(context),'NATIVE_RECEIPT_REQUIRED');return receipt;
 }
 private async verifyMapping(c:NativeContext,context:StripeTestCheckoutContext,invoiceId:string,kind:'invoice'|'payment_intent'|'checkout_session',objectId:string){
  const m=await one<{customer:string;purchase:string;hosted:string;operation:string;invoice:string;kind:string;object:string;revoked:Date|null}>(c.tx,'SELECT customer_binding_id AS customer,purchase_id AS purchase,hosted_operation_id AS hosted,operation_id AS operation,invoice_id AS invoice,object_kind AS kind,object_id AS object,revoked_at AS revoked FROM ls_fishing_payments.object_bindings WHERE workspace_id=$1 AND provider_account_id=$2 AND livemode=false AND object_id=$3 FOR SHARE',[c.actor.workspaceId,this.#binding.accountId,objectId]);invariant(m&&m.customer===context.customer.bindingId&&m.purchase===context.purchaseId&&m.hosted===context.operationId&&m.operation===context.operationId&&m.invoice===invoiceId&&m.kind===kind&&m.object===objectId&&!m.revoked,'CONFLICT');
 }
 /** Bootstrap only existing native references, never ledger money. Root's
  * strict receipt normalizer still must read InvoicePayment/PI/captured charge
  * and apply exactly one durable settlement before any balance/enrollment claim. */
 async promote(actor:Actor,commandId:string,operationId:string,observation:CheckoutObservation,eventId:string){
  const authorize=async(c:NativeContext)=>{const current=await this.current(c,operationId,'promote'),known=await this.known(c,current.context);invariant(this.policy&&known&&c.actor.role==='practitioner'&&c.actor.id===current.purchase.offer.operatorAccountId,'APPROVAL_REQUIRED');const o=validateCheckoutObservation(observation,current.context,known);invariant(o.status==='complete'&&o.paymentStatus==='paid'&&o.invoiceId&&o.paymentIntentId&&await this.createConsumed(c,operationId),'CONFLICT');await this.recorded(c,current.context,o);const receipt=await this.receipt(c,current.context,known,eventId);await this.policy.promotion(c,current.purchase,current.context,known,o,receipt);
   if(current.op.state==='confirmed'){invariant(current.op.result?.kind==='hosted_invoice'&&current.op.result.providerObjectId===o.invoiceId,'CONFLICT');for(const [kind,id] of [['invoice',o.invoiceId],['payment_intent',o.paymentIntentId],['checkout_session',known.sessionId]] as const)await this.verifyMapping(c,current.context,o.invoiceId,kind,id);}
  };
  return this.store.command(actor,commandId,'stripe-test.checkout.promote.request',{operationId,eventId,observation:digest(observation)},authorize,async c=>{
   const {context,op}=await this.current(c,operationId,'promote'),known=await this.known(c,context);invariant(known,'UNKNOWN_CREATE');const o=validateCheckoutObservation(observation,context,known);invariant(o.invoiceId&&o.paymentIntentId,'CONFLICT');const created=await this.journal(c.tx,c.actor.workspaceId,A.observed,operationId+':create');invariant(created,'OBSERVATION_REQUIRED');const original=validateCheckoutObservation(created.value,context,known);invariant(original.url,'CONFLICT');
   for(const [kind,objectId] of [['invoice',o.invoiceId],['payment_intent',o.paymentIntentId],['checkout_session',known.sessionId]] as const){
    await c.tx.query('INSERT INTO ls_fishing_payments.object_bindings(workspace_id,id,revision,provider_account_id,livemode,customer_binding_id,purchase_id,hosted_operation_id,operation_id,invoice_id,object_kind,object_id,provenance_reference,verified_at) VALUES($1,$2,1,$3,false,$4,$5,$6,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING',[c.actor.workspaceId,randomUUID(),this.#binding.accountId,context.customer.bindingId,context.purchaseId,operationId,o.invoiceId,kind,objectId,'checkout:'+context.authorizationVersion,c.now]);
    await this.verifyMapping(c,context,o.invoiceId,kind,objectId);
   }
   const result={kind:'hosted_invoice' as const,providerObjectId:o.invoiceId,url:validateCheckoutUrl(original.url),providerAccountId:this.#binding.accountId,livemode:false,currency:'USD' as const,amountCents:op.amountCents,purchaseId:context.purchaseId,dueId:context.dueId,idempotencyKey:op.idempotencyKey};if(op.state==='confirmed')invariant(digest(op.result)===digest(result),'CONFLICT');else{invariant(op.state==='unknown','CONFLICT');await c.tx.query('UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,op.id,JSON.stringify({...op,state:'confirmed',result})]);await this.store.event(c,'operation.confirmed',op.id,1);}
   const value={state:'references_promoted' as const,operationId,sessionId:known.sessionId,invoiceId:o.invoiceId,paymentIntentId:o.paymentIntentId,settlementRecorded:false as const};await this.save(c,A.promoted,operationId,value);return value;
  });
 }
}
