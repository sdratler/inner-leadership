/** AUTHORED ONLY under Source131. Actual SDK serialization, mocked fetch only;
 * no provider proof, credentials, native SQL or execution admission. */
import {randomUUID} from 'node:crypto';
import Stripe from 'stripe';
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {digest} from '../../../src/features/fishing-payments/domain.ts';
import {StripeTestHostedInvoiceProvider,StripeTestHostedError,stripeHostedApiVersion,stripeHostedSdkVersion,stripeHostedBounds} from '../../../src/features/fishing-payments/stripe-test-hosted-provider.ts';
import type {StripeTestHostedBinding,StripeTestHostedContext} from '../../../src/features/fishing-payments/ports.ts';
import {offerFixture} from './fixture.ts';

const NOW=Date.parse('2027-01-05T15:00:00Z'),SECRET='rk_test_SYNTHETIC_HOSTED_ADAPTER_NO_NETWORK',PRIVATE='SYNTHETIC_PRIVATE_BODY_CANARY';
const binding:StripeTestHostedBinding={accountId:'acct_SYNTHETIC',livemode:false,apiVersion:stripeHostedApiVersion,verifiedBindingId:'SYNTHETIC_ROOT_VERIFIED_BINDING'};
function context(mode:'prepay'|'installments'='prepay',dueIndex=0):StripeTestHostedContext{
 const offer=offerFixture(mode,NOW),line=offer.lines[0]!,due=line.dues[dueIndex]!,operationId=randomUUID();
 return {offer,purchaseLineId:line.id,operation:{id:operationId,kind:'hosted_invoice',workspaceId:offer.workspaceId,purchaseId:randomUUID(),dueId:due.id,refundPaymentId:null,providerAccountId:binding.accountId,livemode:false,amountCents:due.amountCents,currency:'USD',idempotencyKey:`rm:${offer.workspaceId}:${operationId}`,state:'unknown',requestDigest:digest([offer.id,offer.revision,line.id,due]),result:null},customer:{bindingId:randomUUID(),revision:1,payerAccountId:offer.payerAccountId,customerId:'cus_SYNTHETIC',merchantBindingId:binding.verifiedBindingId,verifiedAt:new Date(NOW-1000).toISOString()},authorizationVersion:'a'.repeat(64),linkExpiresAt:offer.expiresAt,laterDuePolicy:dueIndex===0?null:{id:'SYNTHETIC_APPROVED_LATER_LINK',revision:1,sourceVersion:'SYNTHETIC_SOURCE'}};
}
function confirmed(c=context()):StripeTestHostedContext{return {...c,operation:{...c.operation,state:'confirmed',result:{kind:'hosted_invoice',providerObjectId:'in_SYNTHETIC',url:'https://invoice.stripe.com/i/SYNTHETIC',providerAccountId:binding.accountId,livemode:false,currency:'USD',amountCents:c.operation.amountCents,purchaseId:c.operation.purchaseId,dueId:c.operation.dueId!,idempotencyKey:c.operation.idempotencyKey}}};}
function invoice(c:StripeTestHostedContext,status:'draft'|'open'|'paid'|'void'='draft',filled=false){
 const amount=filled?c.operation.amountCents:0,metadata={rm_operation_id:c.operation.id,rm_purchase_id:c.operation.purchaseId,rm_due_id:c.operation.dueId!};
 const paid=status==='paid'?amount:0,remaining=status==='void'?0:amount-paid;
 return {id:'in_SYNTHETIC',object:'invoice',livemode:false,customer:c.customer.customerId,currency:'usd',status,collection_method:'send_invoice',auto_advance:false,billing_reason:'manual',due_date:Math.floor(Date.parse(c.offer.lines[0]!.dues.find(d=>d.id===c.operation.dueId)!.dueAt)/1000),total:amount,amount_due:amount,amount_paid:paid,amount_remaining:remaining,starting_balance:0,ending_balance:0,automatic_tax:{enabled:false},discounts:[],metadata,lines:{object:'list',has_more:false,data:filled?[{id:'il_SYNTHETIC',object:'line_item',amount,currency:'usd',metadata}]:[]},hosted_invoice_url:status==='draft'?null:'https://invoice.stripe.com/i/SYNTHETIC',customer_email:PRIVATE,client_secret:PRIVATE};
}
function transport(...responses:unknown[]){let index=0;const mock=vi.fn<typeof fetch>(async()=>{if(index>=responses.length)throw Error(PRIVATE);return new Response(JSON.stringify(responses[index++]),{headers:{'content-type':'application/json'}});});vi.stubGlobal('fetch',mock);return mock;}
const provider=(clock=()=>new Date(NOW))=>new StripeTestHostedInvoiceProvider(SECRET,binding,clock);
const signal=()=>new AbortController().signal;
async function denied(pending:Promise<unknown>){const error=await pending.then(()=>null,error=>error);expect(error).toBeInstanceOf(StripeTestHostedError);expect(String(error)).not.toContain(PRIVATE);expect(String(error)).not.toContain(SECRET);expect(error).not.toHaveProperty('cause');return error;}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe('unmounted pinned TEST hosted invoice phases, all fetch mocked',()=>{
 it('constructs without discovery, hides the key and has no customer/search/send/pay/refund capability',()=>{
  const fetch=transport(),p=provider();expect(Stripe.PACKAGE_VERSION).toBe(stripeHostedSdkVersion);expect(Stripe.API_VERSION).toBe(stripeHostedApiVersion);
  expect(fetch).not.toHaveBeenCalled();expect(Object.isFrozen(p.binding)).toBe(true);expect(JSON.stringify(p)).not.toContain(SECRET);
  for(const name of['createCustomer','search','send','pay','refund','reconcileReceipt'])expect(name in p).toBe(false);
  expect(()=>new StripeTestHostedInvoiceProvider('sk_live_SYNTHETIC_DO_NOT_USE',binding)).toThrow();
 });
 it('creates only an isolated manual draft, fixed account/version and stable phase idempotency',async()=>{
  const c=context(),fetch=transport(invoice(c)),o=await provider().perform(c,{phase:'create'},signal());
  expect(o).toMatchObject({status:'draft',hasLine:false,url:null,amountDueCents:0});expect(fetch).toHaveBeenCalledTimes(1);
  const [url,init]=fetch.mock.calls[0]!,params=new URLSearchParams(String(init?.body)),headers=new Headers(init?.headers);
  expect(String(url)).toBe('https://api.stripe.com/v1/invoices');expect(init).toMatchObject({method:'POST',redirect:'error',credentials:'omit',cache:'no-store'});
  expect(headers.get('stripe-version')).toBe(stripeHostedApiVersion);expect(headers.get('stripe-account')).toBe(binding.accountId);expect(headers.get('idempotency-key')).toBe(c.operation.idempotencyKey+':invoice');
  expect(params.get('customer')).toBe(c.customer.customerId);expect(params.get('auto_advance')).toBe('false');expect(params.get('collection_method')).toBe('send_invoice');expect(params.get('pending_invoice_items_behavior')).toBe('exclude');
  expect(params.get('automatic_tax[enabled]')).toBe('false');expect(params.get('payment_settings[payment_method_types][0]')).toBe('card');
  for(const key of['subscription','default_payment_method','customer_email','receipt_email'])expect(params.has(key)).toBe(false);
 });
 it('adds one exact finite due to its known empty draft, then stops for durable observation',async()=>{
  const c=context('installments',2),fetch=transport(invoice(c),invoice(c,'draft',true));
  const o=await provider().perform(c,{phase:'add_line',invoiceId:'in_SYNTHETIC'},signal());expect(o).toMatchObject({status:'draft',hasLine:true,amountDueCents:65000,url:null});
  expect(fetch.mock.calls.map(([url])=>String(url))).toEqual(['https://api.stripe.com/v1/invoices/in_SYNTHETIC','https://api.stripe.com/v1/invoices/in_SYNTHETIC/add_lines']);
  const params=new URLSearchParams(String(fetch.mock.calls[1]![1]?.body));expect(params.get('lines[0][amount]')).toBe('65000');expect(params.get('lines[0][metadata][rm_due_id]')).toBe(c.operation.dueId);
  expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('idempotency-key')).toBe(c.operation.idempotencyKey+':line');
 });
 it('finalizes only a fully validated draft and returns a private whitelisted observation',async()=>{
  const c=context(),fetch=transport(invoice(c,'draft',true),invoice(c,'open',true)),o=await provider().perform(c,{phase:'finalize',invoiceId:'in_SYNTHETIC'},signal());
  expect(fetch).toHaveBeenCalledTimes(2);expect(o).toMatchObject({status:'open',url:'https://invoice.stripe.com/i/SYNTHETIC',contextDigest:digest(c)});expect(JSON.stringify(o)).not.toContain(PRIVATE);
  expect(new URLSearchParams(String(fetch.mock.calls[1]![1]?.body)).get('auto_advance')).toBe('false');
 });
 it.each([
  {currency:'eur'},{customer:'cus_OTHER'},{amount_due:100},{auto_advance:true},{starting_balance:-100},{metadata:{rm_operation_id:randomUUID(),rm_purchase_id:randomUUID(),rm_due_id:'wrong'}},
 ])('rejects invoice mismatch before any finalization POST: %j',async patch=>{
  const c=context(),fetch=transport({...invoice(c,'draft',true),...patch});await denied(provider().perform(c,{phase:'finalize',invoiceId:'in_SYNTHETIC'},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('rejects a changed approved amount and a fourth installment before dispatch',async()=>{
  const c=context('installments'),fetch=transport();const line=c.offer.lines[0]!;
  const bad={...c,offer:{...c.offer,lines:[{...line,dues:[...line.dues,{...line.dues[0],id:randomUUID(),index:4}]}]}} as unknown as StripeTestHostedContext;
  await denied(provider().perform(bad,{phase:'create'},signal()));await denied(provider().perform({...c,operation:{...c.operation,amountCents:100}},{phase:'create'},signal()));expect(fetch).not.toHaveBeenCalled();
 });
 it('never repeats add_lines when readback already contains a line',async()=>{
  const c=context(),fetch=transport(invoice(c,'draft',true));await denied(provider().perform(c,{phase:'add_line',invoiceId:'in_SYNTHETIC'},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('missing later-due link policy, wrong customer binding or merchant fails before dispatch',async()=>{
  const c=context('installments',1),fetch=transport();
  await denied(provider().perform({...c,laterDuePolicy:null},{phase:'create'},signal()));
  await denied(provider().perform({...c,customer:{...c.customer,payerAccountId:randomUUID()}},{phase:'create'},signal()));
  await denied(provider().perform({...c,customer:{...c.customer,merchantBindingId:'WRONG_PROOF'}},{phase:'create'},signal()));expect(fetch).not.toHaveBeenCalled();
 });
 it('missing explicit closure decision and substituted invoice IDs cannot dispatch',async()=>{
  const c=confirmed(),fetch=transport();
  await denied(provider().perform(c,{phase:'close',invoiceId:'in_SYNTHETIC'} as never,signal()));
  await denied(provider().perform(c,{phase:'close',invoiceId:'in_OTHER',closureDecisionId:'SYNTHETIC_OWNER_CLOSURE'},signal()));expect(fetch).not.toHaveBeenCalled();
 });
 it('suppresses expired links on read and denies expired issue phases before any fetch',async()=>{
  const original=context(),expired=new Date(NOW-1).toISOString(),c={...original,offer:{...original.offer,expiresAt:expired},linkExpiresAt:expired},fetch=transport(invoice(original,'open',true));
  expect((await provider().perform(c,{phase:'read',invoiceId:'in_SYNTHETIC'},signal())).url).toBeNull();
  await denied(provider().perform(c,{phase:'create'},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('rechecks expiry after the draft read before finalizing',async()=>{
  const c=context();let now=NOW;const fetch=vi.fn<typeof globalThis.fetch>(async()=>{now=Date.parse(c.linkExpiresAt);return new Response(JSON.stringify(invoice(c,'draft',true)),{headers:{'content-type':'application/json'}});});vi.stubGlobal('fetch',fetch);
  await denied(provider(()=>new Date(now)).perform(c,{phase:'finalize',invoiceId:'in_SYNTHETIC'},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('separate closure requires an owner decision and a terminal GET after void',async()=>{
  const c=confirmed(),fetch=transport(invoice(c,'open',true),invoice(c,'void',true),invoice(c,'void',true));
  const o=await provider().perform(c,{phase:'close',invoiceId:'in_SYNTHETIC',closureDecisionId:'SYNTHETIC_EXPLICIT_ROOT_CLOSURE'},signal());
  expect(o).toMatchObject({status:'void',paidCents:0,remainingCents:0,url:null});expect(fetch.mock.calls.map(([,init])=>init?.method)).toEqual(['GET','POST','GET']);
  expect(String(fetch.mock.calls[1]![0])).toMatch(/\/void$/);
 });
 it('never voids an already paid invoice, and never reports it closed',async()=>{
  const c=confirmed(),fetch=transport(invoice(c,'paid',true)),o=await provider().perform(c,{phase:'close',invoiceId:'in_SYNTHETIC',closureDecisionId:'SYNTHETIC_EXPLICIT_ROOT_CLOSURE'},signal());expect(o.status).toBe('paid');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('can close a journal-known open invoice when finalization succeeded but native publication is unknown',async()=>{
  const c=context(),fetch=transport(invoice(c,'open',true),invoice(c,'void',true),invoice(c,'void',true));
  expect((await provider().perform(c,{phase:'close',invoiceId:'in_SYNTHETIC',closureDecisionId:'SYNTHETIC_OWNER_CLOSURE'},signal())).status).toBe('void');expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('does not DELETE or void a draft during closure',async()=>{
  const c=context(),fetch=transport(invoice(c,'draft',true));await denied(provider().perform(c,{phase:'close',invoiceId:'in_SYNTHETIC',closureDecisionId:'SYNTHETIC_OWNER_CLOSURE'},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('a non-terminal closure GET is unknown, with no automatic retry',async()=>{
  const c=confirmed(),fetch=transport(invoice(c,'open',true),invoice(c,'void',true),invoice(c,'open',true));await denied(provider().perform(c,{phase:'close',invoiceId:'in_SYNTHETIC',closureDecisionId:'SYNTHETIC_EXPLICIT_ROOT_CLOSURE'},signal()));expect(fetch).toHaveBeenCalledTimes(3);
 });
 it.each([302,403,429,500])('sanitizes HTTP %i and does not retry',async status=>{
  const c=context(),fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify({error:{message:PRIVATE,key:SECRET}}),{status,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);await denied(provider().perform(c,{phase:'create'},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('a lost create response yields a fixed failure; no search or replacement create',async()=>{
  const c=context(),fetch=vi.fn<typeof globalThis.fetch>(async()=>{throw Error(PRIVATE+SECRET);});vi.stubGlobal('fetch',fetch);await denied(provider().perform(c,{phase:'create'},signal()));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('bounds the response body and aborts a stalled request',async()=>{
  const c=context();vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(stripeHostedBounds.objectBytes+1),{headers:{'content-type':'application/json'}})));await denied(provider().perform(c,{phase:'create'},signal()));
  vi.useFakeTimers();const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetch);
  const pending=denied(provider().perform(c,{phase:'create'},signal()));await vi.advanceTimersByTimeAsync(stripeHostedBounds.requestMilliseconds+1);await pending;expect(fetch).toHaveBeenCalledTimes(1);
 });
});
