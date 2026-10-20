/** Source174 AUTHORING ONLY, UNRUN. Synthetic contract/transaction doubles; not actual
 * legal approval, native authority/atomicity, ordinary login or provider proof. */
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {digest} from '../../../src/features/fishing-payments/domain.ts';
import type {Actor} from '../../../src/features/fishing/contract.ts';
import type {NativeContext} from '../../../src/features/fishing-payments/ports.ts';
import {checkoutApiVersion,validateCheckoutContext,checkoutFinitePlan,assertCheckoutCreateWindow,validateCheckoutKnown,validateCheckoutClaim,checkoutRequestDigest,validateCheckoutObservation,publishCheckoutRedirect,type StripeTestCheckoutBinding,type StripeTestCheckoutContext,type CheckoutKnownBinding,type CheckoutDispatchClaim,type CheckoutPublicationBoundary,type CheckoutObservation,type CheckoutRedirect} from '../../../src/features/fishing-payments/stripe-test-checkout-ports.ts';
import {offerFixture} from './fixture.ts';
const NOW=Date.parse('2027-01-05T15:00:00Z');
const binding:StripeTestCheckoutBinding={accountId:'acct_SYNTHETIC',livemode:false,apiVersion:checkoutApiVersion,verifiedBindingId:'SYNTHETIC_SERVER_BINDING'};
const urls={successUrl:'https://life-skills.bneineviimacademy.org/en/account',cancelUrl:'https://life-skills.bneineviimacademy.org/en/florida/apply'};
function fixture(mode:'prepay'|'installments'='installments',dueIndex=0):StripeTestCheckoutContext{
 const offer=offerFixture(mode,NOW),line=offer.lines[0]!,schedule={id:randomUUID(),revision:1,sourceVersion:'SYNTHETIC_EXPLICIT_SCHEDULE',offerId:offer.id,offerRevision:offer.revision,purchaseLineId:line.id,learnerId:line.learnerId,currency:'USD' as const,mode,totalCents:line.totalCents,dues:line.dues.map(d=>({id:d.id,index:d.index,amountCents:d.amountCents,dueAt:d.dueAt}))};
 return {offer,offerDigest:digest(offer),purchaseId:randomUUID(),purchaseLineId:line.id,dueId:line.dues[dueIndex]!.id,operationId:randomUUID(),generation:1,entryPoint:dueIndex===0?'registration':'due_payment',schedule,scheduleDigest:digest(schedule),authorizationVersion:'a'.repeat(64),
  customer:{bindingId:randomUUID(),revision:1,payerAccountId:offer.payerAccountId,customerId:'cus_SYNTHETIC',merchantBindingId:binding.verifiedBindingId,verifiedAt:new Date(NOW-1000).toISOString()},
  agreements:{approvalId:'SYNTHETIC_NOT_LEGAL_PROOF',documentSetId:'SYNTHETIC_TWELVE_SESSION_DOCUMENTS',documentSetRevision:1,acceptanceId:randomUUID(),termsVersion:offer.terms.version,program:'sunday_fishing_academy',sessions:12,acceptedBy:offer.payerAccountId,acceptedAt:offer.terms.acceptedAt,language:'en'},
  window:{policyId:'SYNTHETIC_EXPLICIT_WINDOW',revision:1,sourceVersion:'SYNTHETIC_SOURCE',opensAt:new Date(NOW-60000).toISOString(),closesAt:offer.expiresAt},expiresAt:new Date(NOW+3600000).toISOString()};
}
function known(c:StripeTestCheckoutContext):CheckoutKnownBinding{return {id:randomUUID(),revision:1,sessionId:'cs_test_SYNTHETIC',contextDigest:digest(c),operationId:c.operationId,purchaseId:c.purchaseId,purchaseLineId:c.purchaseLineId,dueId:c.dueId,customerBindingId:c.customer.bindingId,offerDigest:c.offerDigest,scheduleDigest:c.scheduleDigest};}
function claim(c:StripeTestCheckoutContext):CheckoutDispatchClaim{return {id:randomUUID(),phase:'create',operationId:c.operationId,generation:c.generation,contextDigest:digest(c),requestDigest:checkoutRequestDigest(c,'create',urls),idempotencyKey:`rm:${c.offer.workspaceId}:${c.operationId}:checkout:1:create`,effectDecisionId:'SYNTHETIC_CONSUMED_ROOT_DECISION',sessionId:null};}
function observation(c:StripeTestCheckoutContext):CheckoutObservation{return {contextDigest:digest(c),sessionId:'cs_test_SYNTHETIC',customerId:c.customer.customerId,status:'open',paymentStatus:'unpaid',amountCents:c.schedule.dues.find(d=>d.id===c.dueId)!.amountCents,expiresAt:Math.floor(Date.parse(c.expiresAt)/1000),invoiceId:null,paymentIntentId:null,url:'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC'};}

it('the first Checkout is due1 of exactly three; only two650 payments remain after due1',()=>{
 const c=validateCheckoutContext(fixture(),binding),dues=c.schedule.dues;
 expect(checkoutFinitePlan(c,[])).toMatchObject({totalPayments:3,registrationDueId:dues[0]!.id,remainingCents:195000,automaticDebits:false});
 expect(checkoutFinitePlan(c,[dues[0]!.id])).toMatchObject({totalPayments:3,remainingDueIds:[dues[1]!.id,dues[2]!.id],remainingCents:130000,automaticDebits:false});
 expect(checkoutFinitePlan(c,dues.map(d=>d.id))).toMatchObject({remainingDueIds:[],remainingCents:0});
});
it('one prepay purchase has one exact approved due, not three extra invoices',()=>{
 const c=validateCheckoutContext(fixture('prepay'),binding);expect(checkoutFinitePlan(c,[])).toMatchObject({totalPayments:1,remainingCents:175000});expect(checkoutFinitePlan(c,[c.dueId]).remainingDueIds).toEqual([]);
});
it('duplicate delivery identities cannot be counted as additional paid dues',()=>{
 const c=fixture();expect(()=>checkoutFinitePlan(c,[c.dueId,c.dueId])).toThrow();expect(()=>checkoutFinitePlan(c,['foreign-due'])).toThrow();
});
it('rejects a fourth due,100cent replacement price and invented dates even with a recomputed schedule digest',()=>{
 const c=fixture(),changed=[{...c.schedule,dues:[...c.schedule.dues,{...c.schedule.dues[0]!,id:randomUUID(),index:4 as const}]},{...c.schedule,dues:c.schedule.dues.map(d=>({...d,amountCents:100}))},{...c.schedule,dues:c.schedule.dues.map(d=>({...d,dueAt:new Date(NOW+9000000*d.index).toISOString()}))}];
 for(const schedule of changed)expect(()=>validateCheckoutContext({...c,schedule,scheduleDigest:digest(schedule)},binding)).toThrow();
});
it('registration cannot skip due1 or substitute another child/customer/merchant/offer revision',()=>{
 const c=fixture(),cases=[{...c,dueId:c.schedule.dues[1]!.id},{...c,purchaseLineId:randomUUID()},{...c,offerDigest:'b'.repeat(64)},{...c,customer:{...c.customer,payerAccountId:randomUUID()}},{...c,customer:{...c.customer,merchantBindingId:'OTHER_MERCHANT'}}];
 for(const bad of cases)expect(()=>validateCheckoutContext(bad,binding)).toThrow();
});
it('later dues consume a complete explicitly supplied schedule/window without inventing payment dates',()=>{
 const c=fixture('installments',2);expect(validateCheckoutContext(c,binding).schedule.dues).toEqual(c.schedule.dues);expect(()=>validateCheckoutContext({...c,window:undefined},binding)).toThrow();expect(()=>validateCheckoutContext({...c,schedule:undefined},binding)).toThrow();
});
it('missing agreements, four-session legacy text, wrong language or payer cannot become12-session acceptance',()=>{
 const c=fixture(),bad=[{...c,agreements:null},{...c,agreements:{...c.agreements,sessions:4}},{...c,agreements:{...c.agreements,language:'fr'}},{...c,agreements:{...c.agreements,acceptedBy:randomUUID()}}];
 for(const input of bad)expect(()=>validateCheckoutContext(input,binding)).toThrow();
});
it('provider expiry must fit the actual authorized window and30minute–24hour bounds',()=>{
 const c=fixture();expect(()=>assertCheckoutCreateWindow(c,new Date(NOW))).not.toThrow();
 for(const expiresAt of[new Date(NOW+1799000).toISOString(),new Date(NOW+86401000).toISOString()])expect(()=>assertCheckoutCreateWindow({...c,expiresAt},new Date(NOW))).toThrow();
 expect(()=>validateCheckoutContext({...c,window:{...c.window,closesAt:new Date(NOW+60000).toISOString()}},binding)).toThrow();
 expect(()=>validateCheckoutContext({...c,window:{...c.window,closesAt:new Date(Date.parse(c.offer.expiresAt)+1).toISOString()}},binding)).toThrow();
});
it('known sessions are bound to the exact pending native context, not names or provider metadata',()=>{
 const c=fixture(),k=known(c);expect(validateCheckoutKnown(k,c)).toEqual(k);
 for(const patch of[{purchaseId:randomUUID()},{dueId:'foreign'},{customerBindingId:randomUUID()},{contextDigest:'b'.repeat(64)},{scheduleDigest:'b'.repeat(64)}])expect(()=>validateCheckoutKnown({...k,...patch},c)).toThrow();
});
it('same replay fingerprints stay stable, while collisions and different generation/return routes are rejected',()=>{
 const c=fixture(),dispatch=claim(c);expect(validateCheckoutClaim(dispatch,c,'create',urls)).toEqual(dispatch);
 for(const patch of[{generation:2},{requestDigest:'b'.repeat(64)},{idempotencyKey:dispatch.idempotencyKey+'-replacement'},{sessionId:'cs_test_OTHER'}])expect(()=>validateCheckoutClaim({...dispatch,...patch},c,'create',urls)).toThrow();
 expect(()=>validateCheckoutClaim(dispatch,c,'create',{...urls,successUrl:urls.successUrl+'?changed=1'})).toThrow();
});
it('pending null invoice/PI stays an observation; browser completion or unpaid session cannot invent cash',()=>{
 const c=fixture(),o=observation(c);expect(validateCheckoutObservation(o,c)).toMatchObject({invoiceId:null,paymentIntentId:null,paymentStatus:'unpaid'});
 expect(validateCheckoutObservation({...o,status:'complete',url:null},c)).toMatchObject({status:'complete',paymentStatus:'unpaid',invoiceId:null});
 expect(()=>validateCheckoutObservation({...o,status:'open',paymentStatus:'paid'},c)).toThrow();expect(()=>validateCheckoutObservation({...o,amountCents:100},c)).toThrow();
});

function publication(){
 const c=fixture(),k=known(c),o=observation(c),actor={id:c.offer.payerAccountId,workspaceId:c.offer.workspaceId,role:'parent'} as unknown as Actor;
 let allowed=true,now=NOW,publishes=0,inTransaction=false;const events:string[]=[],cache=new Map<string,CheckoutRedirect>();
 const tx={now:new Date(now),actor,tx:{}} as unknown as NativeContext;
 const boundary:CheckoutPublicationBoundary={
  command:async<T>(_actor:Actor,id:string,_body:unknown,authorize:(c:NativeContext)=>Promise<void>,work:(c:NativeContext)=>Promise<T>)=>{
   inTransaction=true;let value:T;try{const current={...tx,now:new Date(now)};await authorize(current);events.push('cache-read');if(cache.has(id)){value=cache.get(id) as T;}else{value=await work(current);cache.set(id,value as CheckoutRedirect);}}finally{inTransaction=false;}events.push('commit');return value;
  },
  authorizePublication:async()=>{expect(inTransaction).toBe(true);events.push('authorize');if(!allowed)throw Error('CURRENT_ROOT_POLICY_DENIED');},
  publish:async()=>{expect(inTransaction).toBe(true);publishes++;events.push('pending-binding-persisted');return {state:'ready',operationId:c.operationId,purchaseId:c.purchaseId,dueId:c.dueId,sessionId:k.sessionId,url:o.url!};},
 };
 return {c,k,o,actor,boundary,events,publishes:()=>publishes,deny:()=>{allowed=false;},expire:()=>{now=o.expiresAt*1000;}};
}
it('redirect waits for pending binding commit and reauthorizes even a cached result',async()=>{
 const f=publication(),first=await publishCheckoutRedirect(f.actor,'same',f.c,f.k,f.o,f.boundary);expect(f.events.at(-1)).toBe('commit');expect(f.events.indexOf('authorize')).toBeLessThan(f.events.indexOf('pending-binding-persisted'));
 await expect(publishCheckoutRedirect(f.actor,'same',f.c,f.k,f.o,f.boundary)).resolves.toEqual(first);expect(f.publishes()).toBe(1);
 f.events.length=0;f.deny();await expect(publishCheckoutRedirect(f.actor,'same',f.c,f.k,f.o,f.boundary)).rejects.toThrow('CURRENT_ROOT_POLICY_DENIED');expect(f.events).not.toContain('cache-read');
});
it('cached session redirect is unavailable after expiry, and invoice-only redirects are rejected',async()=>{
 const f=publication();await publishCheckoutRedirect(f.actor,'same',f.c,f.k,f.o,f.boundary);f.expire();await expect(publishCheckoutRedirect(f.actor,'same',f.c,f.k,f.o,f.boundary)).rejects.toThrow();
 const other=publication();await expect(publishCheckoutRedirect(other.actor,'bad',other.c,other.k,{...other.o,url:'https://invoice.stripe.com/i/OLD_INVOICE'},other.boundary)).rejects.toThrow();expect(other.publishes()).toBe(0);
});
