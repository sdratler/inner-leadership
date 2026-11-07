import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createFishingBillingTestReadback,type BillingPaymentReadDependencies} from '../../src/lib/fishing-billing-stripe-readback.ts';
import {syntheticId} from '../../src/features/fishing-billing/fixtures.ts';
import type {BillingStripeSignedReceipt} from '../../src/features/fishing-billing/stripe-test.ts';

const binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-ONLY'},clock=new Date('2035-01-06T15:00:00Z');
const at=(seconds:number)=>new Date(seconds*1000).toISOString(),captured=2051701200;
const signed=(eventType:BillingStripeSignedReceipt['eventType']='checkout.session.completed',objectId='cs_test_SYNTHETIC'):BillingStripeSignedReceipt=>({eventId:'evt_SYNTHETIC',eventType,objectId,providerAccountId:binding.accountId,livemode:false,apiVersion:binding.apiVersion,digest:'a'.repeat(64),createdAt:clock.toISOString()});
const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
function setup(){
 const metadata={billing_quote_id:syntheticId(7),billing_attempt_id:syntheticId(801)};
 const charge={object:'charge',id:'ch_SYNTHETIC',livemode:false,currency:'usd',payment_intent:'pi_SYNTHETIC',disputed:false,paid:true,captured:true,status:'succeeded',amount_captured:20000,payment_method_details:{type:'card'},balance_transaction:{object:'balance_transaction',type:'charge',amount:20000,fee:610,net:19390,currency:'usd',source:'ch_SYNTHETIC',created:captured}};
 const pi={object:'payment_intent',id:'pi_SYNTHETIC',livemode:false,currency:'usd',metadata:{...metadata},amount:20000,amount_received:20000,payment_method_types:['card'],status:'succeeded',created:captured-1000,latest_charge:charge as typeof charge|null};
 const session={object:'checkout.session',id:'cs_test_SYNTHETIC',livemode:false,mode:'payment',currency:'usd',payment_method_types:['card'],metadata:{...metadata},client_reference_id:syntheticId(7),amount_total:20000,payment_status:'paid',payment_intent:pi};
 const refund={object:'refund',id:'re_SYNTHETIC',currency:'usd',amount:5000,payment_intent:'pi_SYNTHETIC',charge:'ch_SYNTHETIC',status:'succeeded',created:captured+10,balance_transaction:{object:'balance_transaction',type:'refund',amount:-5000,fee:-100,net:-4900,currency:'usd',source:'re_SYNTHETIC',created:captured+20} as object|null};
 const refunds={object:'list',has_more:false,data:[] as typeof refund[]};let sessionCount=1,returnedSessionId:string|null=null,refundIntentId:string|null=null;
 const calls:{path:string;method:string;query:URLSearchParams}[]=[],authorize=vi.fn(async()=>{});
 const transport=vi.fn<typeof fetch>(async(input,init)=>{
  const url=new URL(String(input));calls.push({path:url.pathname,method:init?.method??'GET',query:url.searchParams});
  if(url.pathname==='/v1/account')return json({object:'account',id:binding.accountId});
  if(url.pathname==='/v1/balance')return json({object:'balance',livemode:false,available:[],pending:[]});
  if(url.pathname==='/v1/checkout/sessions')return json({object:'list',has_more:false,data:Array.from({length:sessionCount},()=>({id:session.id}))});
  if(url.pathname==='/v1/checkout/sessions/'+session.id)return json({...session,id:returnedSessionId??session.id});
  if(url.pathname==='/v1/refunds')return json(refunds);
  if(url.pathname==='/v1/refunds/'+refund.id)return json({...refund,payment_intent:refundIntentId??refund.payment_intent});
  throw Error('Unexpected synthetic request');
 });
 const dependencies:BillingPaymentReadDependencies={binding,key:'rk_test_'+'SYNTHETIC_ONLY'.repeat(3),clock:{now:()=>clock},admission:{authorize},transport};
 return {pi,charge,session,refund,refunds,dependencies,calls,authorize,transport,count:(n:number)=>{sessionCount=n;},returnedId:(id:string)=>{returnedSessionId=id;},refundIntent:(id:string)=>{refundIntentId=id;},read:(receipt=signed())=>createFishingBillingTestReadback(dependencies).readPayment(receipt,binding)};
}

describe('official SDK current payment readback, intercepted transport only',()=>{
 it('uses gross captured principal and actual balance-transaction time, never net fees or PI creation',async()=>{
  const f=setup(),result=await f.read();expect(result).toMatchObject({status:'paid',amountMinor:20000,receivedMinor:20000,paidAt:at(captured),observedAt:clock.toISOString(),refunds:[],dispute:'none'});
  expect(f.calls.map(c=>c.method.toUpperCase())).toEqual(['GET','GET','GET','GET']);expect(f.authorize).toHaveBeenCalledTimes(4);
  expect(f.calls[2]!.query.get('expand[0]')).toBe('payment_intent.latest_charge.balance_transaction');
 });
 it('binds a signed PaymentIntent to exactly one current Checkout Session',async()=>{
  const f=setup();await expect(f.read(signed('payment_intent.succeeded','pi_SYNTHETIC'))).resolves.toMatchObject({sessionId:'cs_test_SYNTHETIC',paymentIntentId:'pi_SYNTHETIC'});
  expect(f.calls[2]!.query.get('payment_intent')).toBe('pi_SYNTHETIC');expect(f.calls[2]!.query.get('limit')).toBe('2');
 });
 it('reads a successful refund principal and its own posted transaction time without allocating siblings',async()=>{
  const f=setup();f.refunds.data=[f.refund];const result=await f.read(signed('refund.updated','re_SYNTHETIC'));
  expect(result.refunds).toEqual([{id:'re_SYNTHETIC',amountMinor:5000,state:'succeeded',occurredAt:at(captured+20)}]);expect(result.receivedMinor).toBe(20000);expect('allocations' in result).toBe(false);
 });
 it('keeps processing truthful with no invented paid timestamp',async()=>{
  const f=setup();f.pi.status='processing';f.pi.amount_received=0;f.pi.latest_charge=null;f.session.payment_status='unpaid';
  await expect(f.read(signed('payment_intent.processing','pi_SYNTHETIC'))).resolves.toMatchObject({status:'pending',receivedMinor:0,paidAt:null});
 });
 it.each(['metadata','amount','currency','charge_link'] as const)('mismatched %s is unresolved',async key=>{
  const f=setup();if(key==='metadata')f.pi.metadata.billing_quote_id=syntheticId(99);else if(key==='amount')f.session.amount_total=1;else if(key==='currency')f.pi.currency='eur';else f.charge.payment_intent='pi_OTHER';
  await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('a disputed charge is held rather than guessed into principal or a parent debt',async()=>{
  const f=setup();f.charge.disputed=true;await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('incomplete refund pagination is not silently treated as complete',async()=>{
  const f=setup();f.refunds.has_more=true;await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('successful refund without its posted transaction is unresolved',async()=>{
  const f=setup();f.refund.balance_transaction=null;f.refunds.data=[f.refund];await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('failed and pending refund statuses do not become successful settlements',async()=>{
  const f=setup();f.refund.status='failed';f.refund.balance_transaction=null;f.refunds.data=[f.refund];await expect(f.read()).resolves.toMatchObject({refunds:[{state:'failed',occurredAt:at(captured+10)}]});
  f.refund.status='requires_action';await expect(f.read()).resolves.toMatchObject({refunds:[{state:'pending'}]});
 });
 it('ambiguous Session identity is held instead of taking the first result',async()=>{
  const f=setup();f.count(2);await expect(f.read(signed('payment_intent.succeeded','pi_SYNTHETIC'))).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(3);
 });
 it('a different returned Session cannot replace the exact selected Session',async()=>{
  const f=setup();f.returnedId('cs_test_OTHER');await expect(f.read(signed('payment_intent.succeeded','pi_SYNTHETIC'))).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(4);
 });
 it('a refund pointer cannot switch to a different PaymentIntent during lookup',async()=>{
  const f=setup();f.refunds.data=[f.refund];f.refundIntent('pi_OTHER');await expect(f.read(signed('refund.updated','re_SYNTHETIC'))).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(5);
 });
 it.each(['invoice','missing_admission','wrong_account','type_object_mismatch'] as const)('%s denies before network',async key=>{
  const f=setup(),receipt=signed();if(key==='invoice'){receipt.eventType='invoice.paid';receipt.objectId='in_SYNTHETIC';}else if(key==='missing_admission')f.dependencies.admission=null;else if(key==='wrong_account')receipt.providerAccountId='acct_OTHER';else receipt.objectId='re_SYNTHETIC';
  await expect(f.read(receipt)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.transport).not.toHaveBeenCalled();
 });
 it('revoked service authority prevents the next provider read',async()=>{
  const f=setup();f.authorize.mockImplementationOnce(async()=>{}).mockImplementationOnce(async()=>{}).mockRejectedValueOnce(Error('REVOKED'));
  await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.calls).toHaveLength(2);
 });
 it('a stalled request is bounded without retry or raw provider-error exposure',async()=>{
  vi.useFakeTimers();try{const f=setup();f.transport.mockImplementation(async()=>new Promise<Response>(()=>{}));const pending=f.read().catch((e:Error)=>e);await vi.advanceTimersByTimeAsync(25001);expect(await pending).toMatchObject({code:'UNAVAILABLE'});expect(f.transport).toHaveBeenCalledTimes(1);}finally{vi.useRealTimers();}
 });
});
