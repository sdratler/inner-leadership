/** Source174 AUTHORING ONLY, UNRUN. Pinned SDK serialization with fetch mocked;
 * synthetic snapshots are not merchant/legal/native/provider acceptance proof. */
import {randomUUID} from 'node:crypto';
import Stripe from 'stripe';
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {digest} from '../../../src/features/fishing-payments/domain.ts';
import {StripeTestCheckoutSessionProvider,checkoutTransportBounds} from '../../../src/features/fishing-payments/stripe-test-checkout-provider.ts';
import {checkoutSdkVersion,checkoutApiVersion,checkoutMetadata,checkoutRequestDigest,StripeTestCheckoutError,type StripeTestCheckoutBinding,type StripeTestCheckoutContext,type CheckoutKnownBinding,type CheckoutDispatchClaim} from '../../../src/features/fishing-payments/stripe-test-checkout-ports.ts';
import {offerFixture} from './fixture.ts';
const NOW=Date.parse('2027-01-05T15:00:00Z'),SECRET='rk_test_SYNTHETIC_CHECKOUT_NO_NETWORK',PRIVATE='SYNTHETIC_PRIVATE_PROVIDER_CANARY';
const binding:StripeTestCheckoutBinding={accountId:'acct_SYNTHETIC',livemode:false,apiVersion:checkoutApiVersion,verifiedBindingId:'SYNTHETIC_ROOT_BINDING'};
const urls={successUrl:'https://life-skills.bneineviimacademy.org/en/account',cancelUrl:'https://life-skills.bneineviimacademy.org/en/florida/apply'};
function context(mode:'prepay'|'installments'='installments',dueIndex=0):StripeTestCheckoutContext{
 const offer=offerFixture(mode,NOW),line=offer.lines[0]!,schedule={id:randomUUID(),revision:1,sourceVersion:'SYNTHETIC_EXPLICIT_SCHEDULE',offerId:offer.id,offerRevision:offer.revision,purchaseLineId:line.id,learnerId:line.learnerId,currency:'USD' as const,mode,totalCents:line.totalCents,dues:line.dues.map(d=>({id:d.id,index:d.index,amountCents:d.amountCents,dueAt:d.dueAt}))};
 return {offer,offerDigest:digest(offer),purchaseId:randomUUID(),purchaseLineId:line.id,dueId:line.dues[dueIndex]!.id,operationId:randomUUID(),generation:1,entryPoint:dueIndex===0?'registration':'due_payment',schedule,scheduleDigest:digest(schedule),authorizationVersion:'a'.repeat(64),
  customer:{bindingId:randomUUID(),revision:1,payerAccountId:offer.payerAccountId,customerId:'cus_SYNTHETIC',merchantBindingId:binding.verifiedBindingId,verifiedAt:new Date(NOW-1000).toISOString()},
  agreements:{approvalId:'SYNTHETIC_NOT_LEGAL_PROOF',documentSetId:'SYNTHETIC_TWELVE_SESSION_DOCUMENTS',documentSetRevision:1,acceptanceId:randomUUID(),termsVersion:offer.terms.version,program:'sunday_fishing_academy',sessions:12,acceptedBy:offer.payerAccountId,acceptedAt:offer.terms.acceptedAt,language:'en'},
  window:{policyId:'SYNTHETIC_EXPLICIT_WINDOW',revision:1,sourceVersion:'SYNTHETIC_SOURCE',opensAt:new Date(NOW-60000).toISOString(),closesAt:offer.expiresAt},expiresAt:new Date(NOW+3600000).toISOString()};
}
function known(c:StripeTestCheckoutContext):CheckoutKnownBinding{return {id:randomUUID(),revision:1,sessionId:'cs_test_SYNTHETIC',contextDigest:digest(c),operationId:c.operationId,purchaseId:c.purchaseId,purchaseLineId:c.purchaseLineId,dueId:c.dueId,customerBindingId:c.customer.bindingId,offerDigest:c.offerDigest,scheduleDigest:c.scheduleDigest};}
function claim(c:StripeTestCheckoutContext,phase:'create'|'expire'='create'):CheckoutDispatchClaim{return {id:randomUUID(),phase,operationId:c.operationId,generation:c.generation,contextDigest:digest(c),requestDigest:checkoutRequestDigest(c,phase,urls,phase==='expire'?'cs_test_SYNTHETIC':null),idempotencyKey:`rm:${c.offer.workspaceId}:${c.operationId}:checkout:1:${phase}`,effectDecisionId:'SYNTHETIC_CONSUMED_ROOT_EFFECT',sessionId:phase==='expire'?'cs_test_SYNTHETIC':null};}
function session(c:StripeTestCheckoutContext,status:'open'|'complete'|'expired'='open',paid=false){
 const amount=c.schedule.dues.find(d=>d.id===c.dueId)!.amountCents;
 return {id:'cs_test_SYNTHETIC',object:'checkout.session',livemode:false,customer:c.customer.customerId,mode:'payment',ui_mode:'hosted_page',currency:'usd',status,payment_status:paid?'paid':'unpaid',amount_subtotal:amount,amount_total:amount,allow_promotion_codes:false,automatic_tax:{enabled:false},total_details:{amount_discount:0,amount_shipping:0,amount_tax:0},invoice_creation:{enabled:true},invoice:paid?'in_SYNTHETIC':null,payment_intent:paid?'pi_SYNTHETIC':null,subscription:null,expires_at:Math.floor(Date.parse(c.expiresAt)/1000),url:status==='open'?'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC':null,metadata:checkoutMetadata(c),
  line_items:{object:'list',has_more:false,data:[{id:'li_SYNTHETIC',object:'item',quantity:1,currency:'usd',amount_subtotal:amount,amount_total:amount,amount_tax:0,amount_discount:0,adjustable_quantity:null,price:{id:'price_SYNTHETIC',currency:'usd',unit_amount:amount,type:'one_time',recurring:null}}]},customer_details:{email:PRIVATE,name:PRIVATE},client_secret:PRIVATE};
}
function transport(...values:unknown[]){let index=0;const fetch=vi.fn<typeof globalThis.fetch>(async()=>{if(index>=values.length)throw Error(PRIVATE);return new Response(JSON.stringify(values[index++]),{headers:{'content-type':'application/json'}});});vi.stubGlobal('fetch',fetch);return fetch;}
const provider=(clock=()=>new Date(NOW))=>new StripeTestCheckoutSessionProvider(SECRET,binding,urls,clock);
const signal=()=>new AbortController().signal;
async function denied(pending:Promise<unknown>){const error=await pending.then(()=>null,error=>error);expect(error).toBeInstanceOf(StripeTestCheckoutError);expect(String(error)).not.toContain(PRIVATE);expect(String(error)).not.toContain(SECRET);expect(error).not.toHaveProperty('cause');return error;}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe('genuine TEST hosted_page Checkout, mocked wire only',()=>{
 it('constructs without account/env discovery or any SDK request',()=>{
  const fetch=transport(),p=provider();expect(fetch).not.toHaveBeenCalled();expect(Stripe.PACKAGE_VERSION).toBe(checkoutSdkVersion);expect(Stripe.API_VERSION).toBe(checkoutApiVersion);expect(Object.isFrozen(p.binding)).toBe(true);expect(JSON.stringify(p)).not.toContain(SECRET);
  for(const method of['search','createCustomer','send','pay','refund','subscribe','reconcileReceipt'])expect(method in p).toBe(false);
  expect(()=>new StripeTestCheckoutSessionProvider('sk_live_SYNTHETIC_FORBIDDEN',binding,urls)).toThrow();expect(()=>new StripeTestCheckoutSessionProvider(SECRET,binding,{...urls,successUrl:'https://foreign.invalid/callback'})).toThrow();
 });
 it('creates actual hosted Checkout due1, accepts null invoice/PI and emits no recurring mandate or separate invoice',async()=>{
  const c=context(),fetch=transport(session(c)),o=await provider().perform(c,{phase:'create',claim:claim(c)},signal());
  expect(o).toMatchObject({status:'open',paymentStatus:'unpaid',amountCents:65000,invoiceId:null,paymentIntentId:null,url:'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC'});expect(JSON.stringify(o)).not.toContain(PRIVATE);
  expect(fetch).toHaveBeenCalledTimes(1);const[url,init]=fetch.mock.calls[0]!,params=new URLSearchParams(String(init?.body)),headers=new Headers(init?.headers);
  expect(String(url)).toBe('https://api.stripe.com/v1/checkout/sessions');expect(init).toMatchObject({method:'POST',redirect:'error',credentials:'omit',cache:'no-store'});
  expect(headers.get('stripe-version')).toBe(checkoutApiVersion);expect(headers.get('stripe-account')).toBe(binding.accountId);expect(headers.get('idempotency-key')).toBe(claim(c).idempotencyKey);
  expect(params.get('mode')).toBe('payment');expect(params.get('ui_mode')).toBe('hosted_page');expect(params.get('line_items[0][quantity]')).toBe('1');expect(params.get('line_items[0][price_data][unit_amount]')).toBe('65000');
  expect(params.get('invoice_creation[enabled]')).toBe('true');expect(params.get('invoice_creation[invoice_data][metadata][rm_due_id]')).toBe(c.dueId);expect(params.get('payment_intent_data[metadata][rm_schedule_digest]')).toBe(c.scheduleDigest);expect(params.get('metadata[rm_learner_id]')).toBe(c.schedule.learnerId);
  for(const key of['subscription_data','setup_intent_data','payment_intent_data[setup_future_usage]','payment_intent_data[receipt_email]','customer_email','line_items[0][price_data][recurring][interval]'])expect(params.has(key)).toBe(false);
 });
 it('uses the existing prepay amount without inventing installments',async()=>{
  const c=context('prepay'),fetch=transport(session(c));expect((await provider().perform(c,{phase:'create',claim:claim(c)},signal())).amountCents).toBe(175000);expect(new URLSearchParams(String(fetch.mock.calls[0]![1]?.body)).get('line_items[0][price_data][unit_amount]')).toBe('175000');
 });
 it('reads only the native-known session with one fixed line_items expansion',async()=>{
  const c=context(),fetch=transport(session(c,'complete',true)),o=await provider().perform(c,{phase:'read',known:known(c)},signal());
  expect(o).toMatchObject({status:'complete',paymentStatus:'paid',invoiceId:'in_SYNTHETIC',paymentIntentId:'pi_SYNTHETIC',url:null});expect(fetch).toHaveBeenCalledTimes(1);
  const url=new URL(String(fetch.mock.calls[0]![0]));expect(url.pathname).toBe('/v1/checkout/sessions/cs_test_SYNTHETIC');expect([...url.searchParams]).toEqual([['expand[0]','line_items']]);expect(fetch.mock.calls[0]![1]?.body).toBeUndefined();
 });
 it('completion without a paid invoice remains pending data, never an allocation result',async()=>{
  const c=context(),fetch=transport(session(c,'complete'));expect(await provider().perform(c,{phase:'read',known:known(c)},signal())).toMatchObject({status:'complete',paymentStatus:'unpaid',invoiceId:null,paymentIntentId:null,url:null});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([{livemode:true},{customer:'cus_FOREIGN'},{currency:'eur'},{mode:'subscription'},{ui_mode:'embedded_page'},{amount_total:100},{subscription:'sub_FOREIGN'},{invoice_creation:{enabled:false}},{url:'https://invoice.stripe.com/i/WRONG'}])('rejects a mismatched provider session: %j',async patch=>{
  const c=context(),fetch=transport({...session(c),...patch});await denied(provider().perform(c,{phase:'create',claim:claim(c)},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('rejects extra child lines, adjustable quantity, discounts and changed schedule/offer correlation',async()=>{
  const c=context(),wire=session(c),item=wire.line_items.data[0]!;
  const bad=[{...wire,line_items:{...wire.line_items,data:[item,item]}},{...wire,line_items:{...wire.line_items,data:[{...item,adjustable_quantity:{enabled:true}}]}},{...wire,total_details:{...wire.total_details,amount_discount:100}},{...wire,metadata:{...wire.metadata,rm_schedule_digest:'b'.repeat(64)}},{...wire,metadata:{...wire.metadata,rm_offer_revision:'999'}}];
  for(const value of bad){transport(value);await denied(provider().perform(c,{phase:'create',claim:claim(c)},signal()));}
 });
 it('rejects collisions and foreign known bindings before any request',async()=>{
  const c=context(),fetch=transport();await denied(provider().perform(c,{phase:'create',claim:{...claim(c),requestDigest:'b'.repeat(64)}},signal()));await denied(provider().perform(c,{phase:'read',known:{...known(c),purchaseId:randomUUID()}},signal()));await denied(provider().perform(c,{phase:'read',known:{...known(c),sessionId:'cs_test_../../foreign'}},signal()));expect(fetch).not.toHaveBeenCalled();
 });
 it('a lost create reply is UNKNOWN/fixed failure, with no search, retry or new create',async()=>{
  const c=context(),fetch=vi.fn<typeof globalThis.fetch>(async()=>{throw Error(PRIVATE+SECRET);});vi.stubGlobal('fetch',fetch);
  await denied(provider().perform(c,{phase:'create',claim:claim(c)},signal()));expect(fetch).toHaveBeenCalledTimes(1);
  await denied(provider().perform(c,{phase:'read',known:null} as never,signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('requires explicit consume-bound expiry claim and confirms terminal expiry by GET',async()=>{
  const c=context(),fetch=transport(session(c),session(c,'expired'),session(c,'expired'));
  expect((await provider().perform(c,{phase:'expire',known:known(c),claim:claim(c,'expire')},signal())).status).toBe('expired');expect(fetch.mock.calls.map(([,init])=>init?.method)).toEqual(['GET','POST','GET']);expect(String(fetch.mock.calls[1]![0])).toBe('https://api.stripe.com/v1/checkout/sessions/cs_test_SYNTHETIC/expire');
 });
 it('does not expire a completed payment or recreate an expired session',async()=>{
  const c=context(),fetch=transport(session(c,'complete',true));expect((await provider().perform(c,{phase:'expire',known:known(c),claim:claim(c,'expire')},signal())).status).toBe('complete');expect(fetch).toHaveBeenCalledTimes(1);
  const expired=transport(session(c,'expired'));expect((await provider().perform(c,{phase:'read',known:known(c)},signal())).url).toBeNull();expect(expired).toHaveBeenCalledTimes(1);
 });
 it('missing expiry decision fails before GET; uncertain expiry cannot claim closure',async()=>{
  const c=context(),empty=transport();await denied(provider().perform(c,{phase:'expire',known:known(c),claim:{...claim(c,'expire'),effectDecisionId:''}},signal()));expect(empty).not.toHaveBeenCalled();
  const fetch=transport(session(c),session(c,'expired'),session(c));await denied(provider().perform(c,{phase:'expire',known:known(c),claim:claim(c,'expire')},signal()));expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('never extends an offer shorter than30minutes to satisfy provider TTL',async()=>{
  const original=context(),expiresAt=new Date(NOW+1799000).toISOString(),c={...original,expiresAt},fetch=transport();await denied(provider().perform(c,{phase:'create',claim:claim(c)},signal()));expect(fetch).not.toHaveBeenCalled();
 });
 it('readback never returns an already-expired Checkout URL',async()=>{
  const c=context(),fetch=transport(session(c));expect((await provider(()=>new Date(Date.parse(c.expiresAt))).perform(c,{phase:'read',known:known(c)},signal())).url).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([302,403,429,500])('sanitizes HTTP%i without retry or private error exposure',async status=>{
  const c=context(),fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify({error:{message:PRIVATE,key:SECRET}}),{status,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);await denied(provider().perform(c,{phase:'create',claim:claim(c)},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('enforces body and request bounds even when fetch ignores abort',async()=>{
  const c=context();vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(checkoutTransportBounds.objectBytes+1),{headers:{'content-type':'application/json'}})));await denied(provider().perform(c,{phase:'create',claim:claim(c)},signal()));
  vi.useFakeTimers();const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetch);const pending=denied(provider().perform(c,{phase:'create',claim:claim(c)},signal()));await vi.advanceTimersByTimeAsync(checkoutTransportBounds.requestMilliseconds+1);await pending;expect(fetch).toHaveBeenCalledTimes(1);
 });
});
