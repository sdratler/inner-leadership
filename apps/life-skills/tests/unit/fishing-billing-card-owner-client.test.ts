import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createFishingBillingCardOwnerClient} from '../../src/lib/fishing-billing-card-owner-client.ts';
import {fishingBillingCardOwnerHttp,type FishingBillingCardOwnerDeps} from '../../src/lib/fishing-billing-card-owner-http.ts';
import {AppError} from '../../src/lib/errors.ts';
import {SESSION_COOKIE} from '../../src/lib/security/session.ts';
import {CARD_VERSION,cardAttemptSchema} from '../../src/features/fishing-billing/card-contracts.ts';
import {projectBalanceV2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {syntheticAccepted,syntheticId,syntheticOwner,syntheticWorkspace} from '../../src/features/fishing-billing/fixtures.ts';
import type {Actor} from '../../src/features/identity/types.ts';

const origin='https://fishing-card-client.invalid',token='a'.repeat(43),csrf='b'.repeat(43),requestId=syntheticId(999);
const actor={id:syntheticOwner,workspaceId:syntheticWorkspace,personId:syntheticId(99),role:'practitioner',state:'active',locale:'en',sessionDigest:'c'.repeat(64),expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function setup(){
 const quote={...syntheticAccepted(),revision:4},command={operationId:syntheticId(801),quoteId:quote.id,expectedVersion:3,selection:[{lineId:quote.lines[0]!.id,amountMinor:20000}]};
 const preparation={version:CARD_VERSION,operationId:command.operationId,quoteId:quote.id,entityVersion:4,replayed:false,result:{attemptId:command.operationId,amountMinor:20000,allocations:command.selection}};
 const attempt=cardAttemptSchema.parse({version:CARD_VERSION,id:command.operationId,workspaceId:quote.workspaceId,quoteId:quote.id,familyId:quote.familyId,actorId:actor.id,revision:1,balanceVersion:4,binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC-ONLY'},command,requestDigest:'d'.repeat(64),preparation,createdAt:'2035-01-02T15:00:00Z',state:'prepared',dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
 const current={quote,balance:projectBalanceV2(quote,[]),receiptId:null};
 const cards={prepare:vi.fn<FishingBillingCardOwnerDeps['cards']['prepare']>().mockResolvedValue(preparation),readAttempt:vi.fn<FishingBillingCardOwnerDeps['cards']['readAttempt']>().mockImplementation(async()=>attempt),readPreparationReceipt:vi.fn<FishingBillingCardOwnerDeps['cards']['readPreparationReceipt']>().mockResolvedValue(preparation),createCheckout:vi.fn<FishingBillingCardOwnerDeps['cards']['createCheckout']>().mockImplementation(async()=>attempt)};
 const store={readBalanceV2:vi.fn<FishingBillingCardOwnerDeps['store']['readBalanceV2']>().mockImplementation(async()=>current)};
 const d:FishingBillingCardOwnerDeps={origin,actor:async()=>actor,csrf:()=>csrf,limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:'e'.repeat(32),cards,store};
 const requests:Request[]=[];
 const transport=vi.fn(async(input:Request)=>{
  requests.push(input.clone());const headers=new Headers(input.headers);headers.set('host','fishing-card-client.invalid');headers.set('x-forwarded-host','fishing-card-client.invalid');headers.set('x-forwarded-proto','https');headers.set('cookie',SESSION_COOKIE+'='+token);
  if(input.method==='POST'){headers.set('origin',origin);headers.set('sec-fetch-site','same-origin');}
  return fishingBillingCardOwnerHttp(new Request(input,{headers}),async()=>d);
 });
 const readCurrent=vi.fn(async()=>current),csrfPort=vi.fn(async()=>csrf);
 const options={origin,scope:{quoteId:quote.id,familyId:quote.familyId,workspaceId:quote.workspaceId},csrf:csrfPort,transport,readCurrent,timeoutMs:100};
 return {quote,command,preparation,attempt,current,d,cards,store,requests,transport,readCurrent,csrfPort,options,client:()=>createFishingBillingCardOwnerClient(options)};
}

describe('injected card client with actual unmounted HTTP boundary',()=>{
 it('prepares the supplied operation once through same-origin CSRF transport',async()=>{
  const f=setup(),result=await f.client().prepare(f.command);expect(result.kind).toBe('prepared');expect(f.requests).toHaveLength(1);const r=f.requests[0]!;expect(r.credentials).toBe('same-origin');expect(r.redirect).toBe('error');expect(r.headers.get('x-csrf-token')).toBe(csrf);expect((await r.json()).command.operationId).toBe(f.command.operationId);
 });
 it('keeps a returned unknown native attempt explicit without confirming payment',async()=>{
  const f=setup();f.attempt.state='unknown';f.attempt.dispatchId=syntheticId(802);const result=await f.client().createCheckout(f.attempt.id);expect(result).toMatchObject({kind:'attempt',data:{attempt:{state:'unknown'},checkoutUrl:null}});expect(f.requests).toHaveLength(1);expect(f.current.balance.paidMinor).toBe(0);
 });
 it('late preparation read failure recovers only the original operation, with no second POST',async()=>{
  const f=setup(),client=f.client();f.store.readBalanceV2.mockRejectedValueOnce(new AppError('FORBIDDEN'));
  expect(await client.prepare(f.command)).toEqual({kind:'unknown'});const recovered=await client.readOperation(f.command.operationId);expect(recovered?.receipt.operationId).toBe(f.command.operationId);expect(f.requests.map(r=>r.method)).toEqual(['POST','GET']);expect(f.cards.prepare).toHaveBeenCalledTimes(1);
 });
 it('post-dispatch exception stays unknown; lookup does not recreate Checkout',async()=>{
  const f=setup(),client=f.client();f.attempt.state='unknown';f.attempt.dispatchId=syntheticId(802);f.cards.createCheckout.mockRejectedValueOnce(new AppError('FORBIDDEN'));
  expect(await client.createCheckout(f.attempt.id)).toEqual({kind:'unknown'});expect((await client.readAttempt(f.attempt.id)).attempt.state).toBe('unknown');expect(f.cards.createCheckout).toHaveBeenCalledTimes(1);expect(f.requests.map(r=>r.method)).toEqual(['POST','GET']);
 });
 it('absent operation is null, without generating or submitting a replacement',async()=>{
  const f=setup();f.cards.readPreparationReceipt.mockResolvedValueOnce(null);expect(await f.client().readOperation(f.command.operationId)).toBeNull();expect(f.requests.map(r=>r.method)).toEqual(['GET']);expect(f.cards.prepare).not.toHaveBeenCalled();
 });
 it('local bad scope or command is rejected before any request',async()=>{
  const f=setup(),client=f.client();expect(await client.prepare({...f.command,quoteId:syntheticId(900)})).toEqual({kind:'rejected',code:'FORBIDDEN'});expect(await client.prepare({...f.command,workspaceId:syntheticId(901)})).toEqual({kind:'rejected',code:'INVALID_REQUEST'});expect(f.transport).not.toHaveBeenCalled();
 });
 it('a genuine pre-effect parent denial is distinct from uncertainty',async()=>{
  const f=setup();f.d.actor=async()=>({...actor,role:'parent'});expect(await f.client().prepare(f.command)).toEqual({kind:'rejected',code:'FORBIDDEN'});expect(f.cards.prepare).not.toHaveBeenCalled();
 });
 it('an untyped 403 response is unknown rather than definitive failure',async()=>{
  const f=setup();f.transport.mockResolvedValueOnce(json({error:'FORBIDDEN'},403));expect(await f.client().prepare(f.command)).toEqual({kind:'unknown'});
 });
 it('conflict reads fresh current state without resending',async()=>{
  const f=setup();f.cards.prepare.mockRejectedValueOnce(new AppError('CONFLICT'));expect(await f.client().prepare(f.command)).toMatchObject({kind:'conflict',current:{quote:{revision:4}}});expect(f.readCurrent).toHaveBeenCalledTimes(1);expect(f.requests).toHaveLength(1);
 });
 it('a stale conflict reader cannot regress current facts',async()=>{
  const f=setup();f.command.expectedVersion=5;f.cards.prepare.mockRejectedValueOnce(new AppError('CONFLICT'));expect(await f.client().prepare(f.command)).toEqual({kind:'unknown'});
 });
 it('prepared result with a different command is not attributed to this submission',async()=>{
  const f=setup();const original=f.transport.getMockImplementation()!;f.transport.mockImplementationOnce(async r=>{const response=await original(r),body=await response.json();body.data.attempt.command.selection[0].amountMinor=1;return json(body);});expect(await f.client().prepare(f.command)).toEqual({kind:'unknown'});
 });
 it('mismatched preparation amount is not accepted merely because its operation ID matches',async()=>{
  const f=setup(),original=f.transport.getMockImplementation()!;f.transport.mockImplementationOnce(async r=>{const response=await original(r),body=await response.json();body.data.receipt.result.amountMinor=1;return json(body);});expect(await f.client().prepare(f.command)).toEqual({kind:'unknown'});
 });
 it('a read attempt cannot introduce a line absent from the current scoped quote',async()=>{
  const f=setup(),original=f.transport.getMockImplementation()!;f.transport.mockImplementationOnce(async r=>{const response=await original(r),body=await response.json();body.data.attempt.command.selection[0].lineId=syntheticId(902);body.data.attempt.preparation.result.allocations[0].lineId=syntheticId(902);return json(body);});await expect(f.client().readAttempt(f.attempt.id)).rejects.toThrow();
 });
 it('a foreign unresolved reference is not treated as absence of this operation',async()=>{
  const f=setup();f.transport.mockResolvedValueOnce(json({ok:true,requestId,data:{version:'JLFA-FISHING-OWNER-CARD-v1',state:'unresolved',quoteId:syntheticId(900),operationId:f.command.operationId}}));await expect(f.client().readOperation(f.command.operationId)).rejects.toThrow('BILLING_CARD_READBACK_UNAVAILABLE');
 });
 it('wrong-family or unsafe link replies are withheld by the client projection',async()=>{
  const f=setup(),original=f.transport.getMockImplementation()!;f.transport.mockImplementationOnce(async r=>{const response=await original(r),body=await response.json();body.data.current.quote.familyId=syntheticId(900);body.data.current.balance.familyId=syntheticId(900);body.data.attempt.familyId=syntheticId(900);return json(body);});expect(await f.client().prepare(f.command)).toEqual({kind:'unknown'});
  const g=setup(),base=g.transport.getMockImplementation()!;g.transport.mockImplementationOnce(async r=>{const response=await base(r),body=await response.json();body.data.checkoutUrl='https://other.invalid/pay';return json(body);});await expect(g.client().readAttempt(g.attempt.id)).rejects.toThrow();
 });
 it('invalid UTF-8 or oversized JSON is unknown',async()=>{
  const f=setup();f.transport.mockResolvedValueOnce(new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}}));expect(await f.client().prepare(f.command)).toEqual({kind:'unknown'});
  const g=setup();g.transport.mockResolvedValueOnce(new Response('x'.repeat(2000001),{headers:{'content-type':'application/json'}}));expect(await g.client().prepare(g.command)).toEqual({kind:'unknown'});
 });
 it('CSRF and conflict-reader deadlines do not cause another command',async()=>{
  vi.useFakeTimers();try{
   const f=setup();f.options.timeoutMs=5;f.csrfPort.mockImplementation(async()=>new Promise<string>(()=>{}));const pending=f.client().prepare(f.command);await vi.advanceTimersByTimeAsync(6);expect(await pending).toEqual({kind:'unknown'});expect(f.transport).not.toHaveBeenCalled();
   const g=setup();g.options.timeoutMs=5;g.cards.prepare.mockRejectedValueOnce(new AppError('CONFLICT'));g.readCurrent.mockImplementation(async()=>new Promise<typeof g.current>(()=>{}));const conflict=g.client().prepare(g.command);await vi.advanceTimersByTimeAsync(20);expect(await conflict).toEqual({kind:'unknown'});expect(g.cards.prepare).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
 it('a stalled response body is cancelled and remains unknown without another POST',async()=>{
  vi.useFakeTimers();try{
   const f=setup();f.options.timeoutMs=5;let cancelled=0;const stream=new ReadableStream<Uint8Array>({cancel(){cancelled++;}});f.transport.mockResolvedValueOnce(new Response(stream,{headers:{'content-type':'application/json'}}));
   const pending=f.client().prepare(f.command);await vi.advanceTimersByTimeAsync(6);expect(await pending).toEqual({kind:'unknown'});expect(cancelled).toBe(1);expect(f.transport).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
});
