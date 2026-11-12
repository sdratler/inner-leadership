import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createFishingBillingTestCheckout,type BillingCheckoutDependencies} from '../../src/lib/fishing-billing-stripe-checkout.ts';
import {prepareBillingTestCheckout} from '../../src/features/fishing-billing/stripe-test.ts';
import {syntheticAccepted,syntheticId} from '../../src/features/fishing-billing/fixtures.ts';
import {projectBalance} from '../../src/features/fishing-billing/domain.ts';

const binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-ONLY'};
function request():Parameters<ReturnType<typeof createFishingBillingTestCheckout>['createCheckout']>[0]{
 const quote=syntheticAccepted(),prepared=prepareBillingTestCheckout({quote,balance:projectBalance(quote,[]),operationId:syntheticId(801),selection:[{lineId:quote.lines[0]!.id,amountMinor:20000}],binding,cardOnlyConfigurationId:'pmc_SYNTHETIC',approvedProductLabel:'SYNTHETIC approved offer'});
 return {...prepared,params:{...prepared.params,line_items:prepared.params.line_items.map(line=>({...line,quantity:1 as const,price_data:{...line.price_data,currency:'usd' as const}})),integration_identifier:'jlfa_monthly_abcdefgh'}};
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function setup(){
 const input=request(),calls:{path:string;method:string;headers:Headers;body:string}[]=[];
 let accountId=binding.accountId,live=false,wrongAmount=false,unsafeUrl='';
 const authorize=vi.fn(async()=>{});
 const transport=vi.fn<typeof fetch>(async(url,init)=>{
  const path=new URL(String(url)).pathname;calls.push({path,method:init?.method??'GET',headers:new Headers(init?.headers),body:String(init?.body??'')});
  if(path==='/v1/account')return json({object:'account',id:accountId});
  if(path==='/v1/balance')return json({object:'balance',livemode:live,available:[],pending:[]});
  return json({object:'checkout.session',id:'cs_test_SYNTHETIC',livemode:false,mode:'payment',amount_total:wrongAmount?1:20000,currency:'usd',client_reference_id:syntheticId(7),integration_identifier:'jlfa_monthly_abcdefgh',metadata:{billing_quote_id:syntheticId(7),billing_attempt_id:syntheticId(801)},payment_method_configuration_details:{id:'pmc_SYNTHETIC'},url:unsafeUrl||'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC#opaque',payment_status:'unpaid'});
 });
 const dependencies:BillingCheckoutDependencies={binding,key:'rk_test_'+'SYNTHETIC_ONLY'.repeat(3),origin:'https://fishing-test.invalid',successUrl:'https://fishing-test.invalid/payment/result?session_id={CHECKOUT_SESSION_ID}',cancelUrl:'https://fishing-test.invalid/payment/cancel',admission:{authorize},transport};
 return {input,calls,authorize,transport,dependencies,create:()=>createFishingBillingTestCheckout(dependencies),account:(id:string)=>{accountId=id;},live:()=>{live=true;},amount:()=>{wrongAmount=true;},url:(value='https://other.invalid/pay')=>{unsafeUrl=value;}};
}

describe('official SDK test Checkout creator, synthetic transport only',()=>{
 it('serializes the frozen request with stable idempotency and checks current admission before POST',async()=>{
  const f=setup(),result=await f.create().createCheckout(f.input);
  expect(f.calls.map(c=>c.path)).toEqual(['/v1/account','/v1/balance','/v1/checkout/sessions']);
  expect(f.authorize).toHaveBeenCalledTimes(2);expect(f.authorize.mock.calls[0]).toEqual(f.authorize.mock.calls[1]);
  const post=f.calls[2]!,body=new URLSearchParams(post.body);
  expect(post.headers.get('idempotency-key')).toBe(f.input.operationId);expect(post.headers.get('stripe-version')).toBe(binding.apiVersion);
  expect(body.get('integration_identifier')).toBe('jlfa_monthly_abcdefgh');expect(body.get('line_items[0][price_data][unit_amount]')).toBe('20000');
  expect(body.get('payment_method_configuration')).toBe('pmc_SYNTHETIC');expect([...body.keys()].some(k=>k.startsWith('payment_method_types'))).toBe(false);
  expect(body.get('success_url')).toBe(f.dependencies.successUrl);
  expect(result).toMatchObject({attemptId:f.input.operationId,amountMinor:20000,paymentStatus:'unpaid',livemode:false});
 });
 it('reuses exact creation parameters and identifier on an explicit caller replay',async()=>{
  const f=setup(),creator=f.create();await creator.createCheckout(f.input);await creator.createCheckout(f.input);
  expect(f.calls).toHaveLength(6);expect(f.calls[2]!.body).toBe(f.calls[5]!.body);expect(f.calls[2]!.headers.get('idempotency-key')).toBe(f.calls[5]!.headers.get('idempotency-key'));
 });
 it.each(['admission','transport'] as const)('missing %s denies before any SDK request',async key=>{
  const f=setup();f.dependencies[key]=null;await expect(f.create().createCheckout(f.input)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.transport).not.toHaveBeenCalled();
 });
 it('copies frozen request values before awaiting admission',async()=>{
  const f=setup();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});f.authorize.mockImplementationOnce(async()=>gate);
  const pending=f.create().createCheckout(f.input);f.input.params.line_items[0]!.price_data.unit_amount=999;f.input.params.metadata.billing_attempt_id=syntheticId(999);release();
  await expect(pending).resolves.toMatchObject({amountMinor:20000});expect(new URLSearchParams(f.calls[2]!.body).get('metadata[billing_attempt_id]')).toBe(syntheticId(801));
 });
 it.each(['account','live'] as const)('wrong %s binding denies before Checkout creation',async key=>{
  const f=setup();if(key==='account')f.account('acct_OTHER');else f.live();await expect(f.create().createCheckout(f.input)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls.some(c=>c.path==='/v1/checkout/sessions')).toBe(false);
 });
 it('revoked second admission prevents POST after successful account reads',async()=>{
  const f=setup();f.authorize.mockImplementationOnce(async()=>{}).mockImplementationOnce(async()=>{throw Error('REVOKED');});
  await expect(f.create().createCheckout(f.input)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(2);
 });
 it.each(['amount','url'] as const)('mismatched provider %s stays unavailable after the single POST',async key=>{
  const f=setup();f[key]();await expect(f.create().createCheckout(f.input)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(3);
 });
 it('an uncertain transport failure is not retried or exposed',async()=>{
  const f=setup();f.transport.mockRejectedValueOnce(Error('PRIVATE_PROVIDER_DETAIL'));
  const error=await f.create().createCheckout(f.input).catch((e:Error)=>e);expect(error).toMatchObject({code:'UNAVAILABLE'});expect(String(error)).not.toContain('PRIVATE_PROVIDER_DETAIL');expect(f.transport).toHaveBeenCalledTimes(1);
 });
 it('a stalled transport terminates without a replacement request',async()=>{
  vi.useFakeTimers();
  try{
   const f=setup();f.transport.mockImplementation(async()=>new Promise<Response>(()=>{}));
   const pending=f.create().createCheckout(f.input).catch((e:Error)=>e);
   await vi.advanceTimersByTimeAsync(15001);expect(await pending).toMatchObject({code:'UNAVAILABLE'});expect(f.transport).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
 it('unsafe return origin and changed immutable amount deny before network',async()=>{
  const f=setup();f.dependencies.cancelUrl='https://other.invalid/cancel';await expect(f.create().createCheckout(f.input)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.transport).not.toHaveBeenCalled();
  const g=setup();g.input.params.line_items[0]!.price_data.unit_amount=3;await expect(g.create().createCheckout(g.input)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(g.transport).not.toHaveBeenCalled();
 });
 it('a provider URL on a nonstandard Stripe-host port is unavailable',async()=>{
  const f=setup();f.url('https://checkout.stripe.com:8443/pay');await expect(f.create().createCheckout(f.input)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(3);
 });
 it('a live key is rejected before any transport call',async()=>{
  const f=setup();f.dependencies.key='rk_live_'+'SYNTHETIC_ONLY'.repeat(3);await expect(f.create().createCheckout(f.input)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.transport).not.toHaveBeenCalled();
 });
});
