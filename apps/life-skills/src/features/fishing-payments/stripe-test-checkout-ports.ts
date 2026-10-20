import {z} from 'zod';
import {approvedOffer,digest,type MerchantBinding} from './domain.ts';
import type {ApprovedOffer,Actor} from '../fishing/contract.ts';
import type {NativeContext} from './ports.ts';

export const checkoutSdkVersion='23.0.0' as const;
export const checkoutApiVersion='2026-09-30.endive' as const;
export const checkoutAmendment='JLFA-REGISTRATION-20261020-01' as const;
const opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),instant=z.iso.datetime({offset:true});
const cents=z.number().int().positive().max(100_000_000),index=z.union([z.literal(1),z.literal(2),z.literal(3)]);
export const checkoutProviderId=(prefix:string)=>z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,150}$`));
export type StripeTestCheckoutBinding=Readonly<MerchantBinding&{livemode:false;apiVersion:typeof checkoutApiVersion}>;
export const checkoutBindingSchema=z.strictObject({accountId:checkoutProviderId('acct'),livemode:z.literal(false),apiVersion:z.literal(checkoutApiVersion),verifiedBindingId:opaque});
const dueSchema=z.strictObject({id:opaque,index,amountCents:cents,dueAt:instant});
const scheduleSchema=z.strictObject({id:opaque,revision:z.number().int().positive(),sourceVersion:opaque,offerId:opaque,offerRevision:z.number().int().positive(),purchaseLineId:opaque,learnerId:uuid,currency:z.literal('USD'),mode:z.enum(['prepay','installments']),totalCents:cents,dues:z.array(dueSchema).min(1).max(3)});
export type CheckoutSchedule=Readonly<z.infer<typeof scheduleSchema>>;
const contextSchema=z.strictObject({offer:z.unknown(),offerDigest:sha,purchaseId:uuid,purchaseLineId:opaque,dueId:opaque,operationId:uuid,generation:z.number().int().positive().max(1000),entryPoint:z.enum(['registration','due_payment']),
 schedule:scheduleSchema,scheduleDigest:sha,authorizationVersion:sha,
 customer:z.strictObject({bindingId:uuid,revision:z.number().int().positive(),payerAccountId:uuid,customerId:checkoutProviderId('cus'),merchantBindingId:opaque,verifiedAt:instant}),
 agreements:z.strictObject({approvalId:opaque,documentSetId:opaque,documentSetRevision:z.number().int().positive(),acceptanceId:uuid,termsVersion:opaque,program:z.literal('sunday_fishing_academy'),sessions:z.literal(12),acceptedBy:uuid,acceptedAt:instant,language:z.enum(['en','he'])}),
 window:z.strictObject({policyId:opaque,revision:z.number().int().positive(),sourceVersion:opaque,opensAt:instant,closesAt:instant}),expiresAt:instant});
export type StripeTestCheckoutContext=Readonly<Omit<z.infer<typeof contextSchema>,'offer'>&{offer:ApprovedOffer}>;
const knownSchema=z.strictObject({id:uuid,revision:z.number().int().positive(),sessionId:checkoutProviderId('cs'),contextDigest:sha,operationId:uuid,purchaseId:uuid,purchaseLineId:opaque,dueId:opaque,customerBindingId:uuid,offerDigest:sha,scheduleDigest:sha});
export type CheckoutKnownBinding=Readonly<z.infer<typeof knownSchema>>;
const claimSchema=z.strictObject({id:uuid,phase:z.enum(['create','expire']),operationId:uuid,generation:z.number().int().positive(),contextDigest:sha,requestDigest:sha,idempotencyKey:z.string().min(1).max(255),effectDecisionId:opaque,sessionId:checkoutProviderId('cs').nullable()});
export type CheckoutDispatchClaim=Readonly<z.infer<typeof claimSchema>>;
export type CheckoutReturnUrls=Readonly<{successUrl:string;cancelUrl:string}>;
export type CheckoutAction=Readonly<{phase:'create';claim:CheckoutDispatchClaim}>|Readonly<{phase:'read';known:CheckoutKnownBinding}>|Readonly<{phase:'expire';known:CheckoutKnownBinding;claim:CheckoutDispatchClaim}>;
export type CheckoutObservation=Readonly<{contextDigest:string;sessionId:string;customerId:string;status:'open'|'complete'|'expired';paymentStatus:'paid'|'unpaid';amountCents:number;expiresAt:number;invoiceId:string|null;paymentIntentId:string|null;url:string|null}>;
export type CheckoutRedirect=Readonly<{state:'ready';operationId:string;purchaseId:string;dueId:string;sessionId:string;url:string}>;
export interface StripeTestCheckoutProvider {
 readonly execution:'stripe_test_checkout';readonly binding:StripeTestCheckoutBinding;
 perform(context:StripeTestCheckoutContext,action:CheckoutAction,signal:AbortSignal):Promise<CheckoutObservation>;
}
export class StripeTestCheckoutError extends Error {
 readonly code='STRIPE_TEST_CHECKOUT_UNAVAILABLE';
 constructor(){super('Stripe test Checkout unavailable');this.name='StripeTestCheckoutError';}
}
export function requireCheckout(value:unknown):asserts value{if(!value)throw new StripeTestCheckoutError();}
export function checkoutParse<T>(schema:z.ZodType<T>,value:unknown):T{try{return schema.parse(value);}catch{throw new StripeTestCheckoutError();}}

/** Server snapshots only. These IDs/versions are NOT legal/merchant/guardian
 * verification. Root MUST reload real current records before dispatch/publication.
 * Source173/174: recovered four-session drafts and contact consent are not the
 * reviewed EN/HE twelve-session agreements. No approval is inferred here. */
export function validateCheckoutContext(raw:unknown,binding:StripeTestCheckoutBinding):StripeTestCheckoutContext{
 try{
  const b=checkoutParse(checkoutBindingSchema,binding),c=checkoutParse(contextSchema,raw),offer=approvedOffer(c.offer),line=offer.lines.find(l=>l.id===c.purchaseLineId),s=c.schedule;
  requireCheckout(line&&digest(offer)===c.offerDigest&&digest(s)===c.scheduleDigest);
  requireCheckout(s.offerId===offer.id&&s.offerRevision===offer.revision&&s.purchaseLineId===line.id&&s.learnerId===line.learnerId&&s.mode===line.mode&&s.totalCents===line.totalCents);
  requireCheckout(digest(s.dues)===digest(line.dues.map(d=>({id:d.id,index:d.index,amountCents:d.amountCents,dueAt:d.dueAt}))));
  const due=s.dues.find(d=>d.id===c.dueId);requireCheckout(due&&(c.entryPoint!=='registration'||due.index===1));
  requireCheckout(c.customer.payerAccountId===offer.payerAccountId&&c.customer.merchantBindingId===b.verifiedBindingId);
  requireCheckout(c.agreements.termsVersion===offer.terms.version&&c.agreements.acceptedBy===offer.payerAccountId&&c.agreements.acceptedAt===offer.terms.acceptedAt);
  requireCheckout(Date.parse(c.window.opensAt)<Date.parse(c.window.closesAt)&&Date.parse(c.expiresAt)<=Date.parse(c.window.closesAt));
  if(due.index===1)requireCheckout(Date.parse(c.window.closesAt)<=Date.parse(offer.expiresAt));
  // Later-due window/dates must come from this explicit approved schedule/policy;
  // Root verifies their actual authority. No inferred grace or automatic renewal.
  return {...c,offer};
 }catch{throw new StripeTestCheckoutError();}
}
export function checkoutDue(c:StripeTestCheckoutContext){const due=c.schedule.dues.find(d=>d.id===c.dueId);requireCheckout(due);return due;}
export function checkoutFinitePlan(c:StripeTestCheckoutContext,paidDueIds:readonly string[]){
 const offer=approvedOffer(c.offer),line=offer.lines.find(l=>l.id===c.purchaseLineId),s=checkoutParse(scheduleSchema,c.schedule);
 requireCheckout(line&&s.offerId===offer.id&&s.offerRevision===offer.revision&&s.purchaseLineId===line.id&&s.learnerId===line.learnerId&&s.mode===line.mode&&s.totalCents===line.totalCents&&digest(s)===c.scheduleDigest&&digest(s.dues)===digest(line.dues.map(d=>({id:d.id,index:d.index,amountCents:d.amountCents,dueAt:d.dueAt}))));
 requireCheckout(new Set(paidDueIds).size===paidDueIds.length&&paidDueIds.every(id=>c.schedule.dues.some(d=>d.id===id)));
 const remaining=c.schedule.dues.filter(d=>!paidDueIds.includes(d.id));
 return {totalPayments:c.schedule.dues.length,registrationDueId:c.schedule.dues[0]!.id,remainingDueIds:remaining.map(d=>d.id),remainingCents:remaining.reduce((sum,d)=>sum+d.amountCents,0),automaticDebits:false as const};
}
export function assertCheckoutCreateWindow(c:StripeTestCheckoutContext,now:Date){
 const seconds=Math.floor(now.valueOf()/1000),expiry=Math.floor(Date.parse(c.expiresAt)/1000);
 requireCheckout(Number.isFinite(seconds)&&now.valueOf()>=Date.parse(c.window.opensAt)&&expiry-seconds>=1800&&expiry-seconds<=86400&&expiry*1000<=Date.parse(c.window.closesAt));
}
export function checkoutMetadata(c:StripeTestCheckoutContext){return {rm_operation_id:c.operationId,rm_purchase_id:c.purchaseId,rm_purchase_line_id:c.purchaseLineId,rm_due_id:c.dueId,rm_offer_id:c.offer.id,rm_offer_revision:String(c.offer.revision),rm_schedule_digest:c.scheduleDigest,rm_learner_id:c.schedule.learnerId,rm_checkout_generation:String(c.generation)};}
export function validateCheckoutReturnUrls(raw:CheckoutReturnUrls):CheckoutReturnUrls{
 const parsed=checkoutParse(z.strictObject({successUrl:z.string().max(2048),cancelUrl:z.string().max(2048)}),raw);
 for(const value of Object.values(parsed)){try{const url=new URL(value);requireCheckout(url.origin==='https://life-skills.bneineviimacademy.org'&&!url.username&&!url.password&&!url.hash&&!/[\r\n]/.test(value));}catch{throw new StripeTestCheckoutError();}}
 return Object.freeze(parsed);
}
export function checkoutRequestDigest(c:StripeTestCheckoutContext,phase:'create'|'expire',urls:CheckoutReturnUrls,sessionId:string|null=null){return digest({context:digest(c),phase,sessionId,urls,sdk:checkoutSdkVersion,api:checkoutApiVersion});}
export function validateCheckoutKnown(raw:unknown,c:StripeTestCheckoutContext):CheckoutKnownBinding{
 const k=checkoutParse(knownSchema,raw);
 requireCheckout(k.contextDigest===digest(c)&&k.operationId===c.operationId&&k.purchaseId===c.purchaseId&&k.purchaseLineId===c.purchaseLineId&&k.dueId===c.dueId&&k.customerBindingId===c.customer.bindingId&&k.offerDigest===c.offerDigest&&k.scheduleDigest===c.scheduleDigest);return k;
}
export function validateCheckoutClaim(raw:unknown,c:StripeTestCheckoutContext,phase:'create'|'expire',urls:CheckoutReturnUrls,sessionId:string|null=null):CheckoutDispatchClaim{
 const claim=checkoutParse(claimSchema,raw);
 requireCheckout(claim.phase===phase&&claim.operationId===c.operationId&&claim.generation===c.generation&&claim.contextDigest===digest(c)&&claim.sessionId===sessionId&&claim.requestDigest===checkoutRequestDigest(c,phase,urls,sessionId)&&claim.idempotencyKey===`rm:${c.offer.workspaceId}:${c.operationId}:checkout:${c.generation}:${phase}`);return claim;
}
export function validateCheckoutUrl(value:string){try{const url=new URL(value);requireCheckout(url.protocol==='https:'&&url.hostname==='checkout.stripe.com'&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname.startsWith('/c/pay/')&&!/[\r\n]/.test(value));return value;}catch{throw new StripeTestCheckoutError();}}
const observationSchema=z.strictObject({contextDigest:sha,sessionId:checkoutProviderId('cs'),customerId:checkoutProviderId('cus'),status:z.enum(['open','complete','expired']),paymentStatus:z.enum(['paid','unpaid']),amountCents:cents,expiresAt:z.number().int().nonnegative(),invoiceId:checkoutProviderId('in').nullable(),paymentIntentId:checkoutProviderId('pi').nullable(),url:z.string().max(2048).nullable()});
export function validateCheckoutObservation(raw:unknown,c:StripeTestCheckoutContext,known?:CheckoutKnownBinding):CheckoutObservation{
 const o=checkoutParse(observationSchema,raw);
 requireCheckout(o.contextDigest===digest(c)&&o.customerId===c.customer.customerId&&o.amountCents===checkoutDue(c).amountCents&&o.expiresAt===Math.floor(Date.parse(c.expiresAt)/1000)&&(!known||o.sessionId===known.sessionId));
 if(o.paymentStatus==='paid')requireCheckout(o.status==='complete');
 if(o.url){validateCheckoutUrl(o.url);requireCheckout(o.status==='open'&&o.paymentStatus==='unpaid');}
 return o;
}

/** Root implements ALL native persistence/authority. Before create: current
 * verified account/test mode, actual reviewed agreement bundle/acceptance,
 * guardian/fit/capacity/offer/schedule/customer, no paid due or competing payable
 * invoice/Checkout, durable UNKNOWN request and GLOBAL consumed dispatch fence.
 * observe commits a canonical pending cs_ binding BEFORE any redirect; invoice
 * may be null. Lost create without ID stays UNKNOWN: no search/recreate.
 * Existing invoice_id NOT NULL mapping is promoted only after trusted provider
 * invoice/PI/charge readback; never fabricate in_ IDs or write browser success.
 * Current financial owner can expire/reconcile a KNOWN session after revocation
 * under a separate effect decision. No refund/automatic debit or messages.
 * Publication command MUST authorize under its current transaction/locks BEFORE
 * cached lookup, then atomically persist the pending binding before returning. */
export interface CheckoutPublicationBoundary {
 command<T>(actor:Actor,commandId:string,body:unknown,authorize:(c:NativeContext)=>Promise<void>,work:(c:NativeContext)=>Promise<T>):Promise<T>;
 authorizePublication(c:NativeContext,context:StripeTestCheckoutContext,known:CheckoutKnownBinding):Promise<void>;
 publish(c:NativeContext,context:StripeTestCheckoutContext,known:CheckoutKnownBinding,observation:CheckoutObservation):Promise<CheckoutRedirect>;
}
/** Adapter for Root's ordinary transactional command API; no SQL or SDK.
 * The callback boundary must retain normal session/guardian/legal checks and
 * refuse close-pending/customer/policy changes even for a cached ready URL. */
export async function publishCheckoutRedirect(actor:Actor,commandId:string,c:StripeTestCheckoutContext,rawKnown:CheckoutKnownBinding,rawObservation:CheckoutObservation,boundary:CheckoutPublicationBoundary):Promise<CheckoutRedirect>{
 const known=validateCheckoutKnown(rawKnown,c),o=validateCheckoutObservation(rawObservation,c,known);
 requireCheckout(o.status==='open'&&o.paymentStatus==='unpaid'&&o.url);
 const result=await boundary.command(actor,commandId,{operationId:c.operationId,generation:c.generation},async tx=>{
  requireCheckout(Number.isFinite(tx.now.valueOf())&&tx.now.valueOf()<o.expiresAt*1000);
  await boundary.authorizePublication(tx,c,known);
 },tx=>boundary.publish(tx,c,known,o));
 requireCheckout(result.state==='ready'&&result.operationId===c.operationId&&result.purchaseId===c.purchaseId&&result.dueId===c.dueId&&result.sessionId===known.sessionId&&result.url===o.url);
 return {state:'ready',operationId:result.operationId,purchaseId:result.purchaseId,dueId:result.dueId,sessionId:result.sessionId,url:validateCheckoutUrl(result.url)};
}
