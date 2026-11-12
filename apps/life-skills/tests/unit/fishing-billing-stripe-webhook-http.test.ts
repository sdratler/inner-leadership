import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import Stripe from 'stripe';
import {AppError} from '../../src/lib/errors.ts';
import {fishingBillingTestWebhookHttp,FISHING_BILLING_TEST_WEBHOOK_PATH,type FishingBillingTestWebhookDeps} from '../../src/lib/fishing-billing-stripe-webhook-http.ts';

const origin='https://fishing-webhook.invalid',secret='whsec_SYNTHETIC_ONLY_0000000000000000',now=new Date('2035-01-02T15:00:00Z');
function setup(){
 const event={id:'evt_SYNTHETIC',object:'event',type:'checkout.session.completed',api_version:'2026-09-30.endive',livemode:false,
  created:Math.floor(now.valueOf()/1000),data:{object:{id:'cs_test_SYNTHETIC',object:'checkout.session'}}};
 const ingest=vi.fn<FishingBillingTestWebhookDeps['inbox']['ingest']>().mockResolvedValue({received:true,replayed:false,processed:false,eventId:event.id});
 const admit=vi.fn(async()=>{}),consume=vi.fn(async()=>({count:1,retryAfterMs:0}));
 const deps:FishingBillingTestWebhookDeps={origin,binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC_ONLY'},endpointSecret:secret,now:()=>now,admit,limits:{consume},rateLimitKey:'x'.repeat(32),inbox:{ingest}};
 const request=(body=JSON.stringify(event),headers:Record<string,string>={},url=origin+FISHING_BILLING_TEST_WEBHOOK_PATH)=>new Request(url,{method:'POST',headers:{'content-type':'application/json','x-forwarded-proto':'https','x-forwarded-host':'fishing-webhook.invalid','stripe-signature':Stripe.webhooks.generateTestHeaderString({payload:body,secret,timestamp:Math.floor(now.valueOf()/1000)}),...headers},body});
 return {event,ingest,admit,consume,deps,request,run:(r:Request)=>fishingBillingTestWebhookHttp(r,async()=>deps)};
}
afterEach(()=>vi.useRealTimers());
describe('unmounted exact-byte TEST webhook intake',()=>{
 it('uses the official SDK and opaque capability, acknowledges only native durable intake',async()=>{
  const f=setup(),r=await f.run(f.request()),body=await r.json();
  expect(r.status).toBe(202);expect(body.data).toEqual({received:true,processed:false,replayed:false});
  expect(f.admit).toHaveBeenCalledTimes(2);expect(f.ingest).toHaveBeenCalledOnce();
  const capability=f.ingest.mock.calls[0]![0];expect(Object.isFrozen(capability)).toBe(true);expect(Object.keys(capability)).toEqual([]);
  expect(r.headers.get('cache-control')).toContain('no-store');expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  expect(JSON.stringify(body)).not.toContain(f.event.id);expect(JSON.stringify(body)).not.toContain(secret);
 });
 it('preserves whitespace and Unicode in the signed raw bytes',async()=>{
  const f=setup(),raw=JSON.stringify({...f.event,description:'סינתטי בלבד'},null,2)+'\n';
  expect((await f.run(f.request(raw))).status).toBe(202);expect(f.ingest).toHaveBeenCalledOnce();
 });
 it('returns replayed only from the native receipt, with no payment assertion',async()=>{
  const f=setup();f.ingest.mockResolvedValue({received:true,replayed:true,processed:false,eventId:f.event.id});
  const r=await f.run(f.request());expect((await r.json()).data).toEqual({received:true,replayed:true,processed:false});
 });
 it('retains unknown commit as503 without a second ingestion',async()=>{
  const f=setup();f.ingest.mockRejectedValue(new Error('synthetic commit outcome with private payload'));
  const r=await f.run(f.request());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private payload');expect(f.ingest).toHaveBeenCalledOnce();
 });
 it.each([
  ['wrong signature',(f:ReturnType<typeof setup>)=>f.request(undefined,{'stripe-signature':'t=2051362800,v1='+'a'.repeat(64)})],
  ['live event',(f:ReturnType<typeof setup>)=>f.request(JSON.stringify({...f.event,livemode:true}))],
  ['foreign connected account',(f:ReturnType<typeof setup>)=>f.request(JSON.stringify({...f.event,account:'acct_OTHER'}))],
  ['wrong API version',(f:ReturnType<typeof setup>)=>f.request(JSON.stringify({...f.event,api_version:'old'}))],
  ['unsupported object',(f:ReturnType<typeof setup>)=>f.request(JSON.stringify({...f.event,data:{object:{id:'pi_OTHER',object:'payment_intent'}}}))],
 ] as const)('rejects %s before durable ingestion',async(_,make)=>{
  const f=setup(),r=await f.run(make(f));expect(r.status).toBe(400);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('rejects tampering after the exact body was signed',async()=>{
  const f=setup(),signed=f.request(),headers=Object.fromEntries(signed.headers),raw=JSON.stringify({...f.event,id:'evt_CHANGED'});
  expect((await f.run(new Request(signed.url,{method:'POST',headers,body:raw}))).status).toBe(400);expect(f.ingest).not.toHaveBeenCalled();
 });
 it.each([
  ['wrong route',404,()=>origin+'/api/webhooks/other'],
  ['query selector',404,()=>origin+FISHING_BILLING_TEST_WEBHOOK_PATH+'?account=other'],
 ] as const)('does not load a runtime for %s',async(_,status,url)=>{
  const f=setup(),load=vi.fn(async()=>f.deps),r=await fishingBillingTestWebhookHttp(f.request(undefined,{},url()),load);
  expect(r.status).toBe(status);expect(load).not.toHaveBeenCalled();expect(f.ingest).not.toHaveBeenCalled();
 });
 it('GET cannot verify, save or settle an event',async()=>{
  const f=setup(),load=vi.fn(async()=>f.deps);expect((await fishingBillingTestWebhookHttp(new Request(origin+FISHING_BILLING_TEST_WEBHOOK_PATH),load)).status).toBe(400);expect(load).not.toHaveBeenCalled();
 });
 it('requires current service admission again immediately before ingestion',async()=>{
  const f=setup();f.admit.mockResolvedValueOnce().mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  expect((await f.run(f.request())).status).toBe(503);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('rejects forged forwarded host before signature or ingestion',async()=>{
  const f=setup();expect((await f.run(f.request(undefined,{'x-forwarded-host':'other.invalid'}))).status).toBe(503);expect(f.admit).not.toHaveBeenCalled();expect(f.ingest).not.toHaveBeenCalled();
 });
 it('requires the shared atomic service counter and fails closed when unavailable',async()=>{
  const f=setup();f.consume.mockRejectedValue(new Error('unavailable'));
  expect((await f.run(f.request())).status).toBe(503);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('rate limits before reading or saving a body',async()=>{
  const f=setup();f.consume.mockResolvedValue({count:121,retryAfterMs:5000});
  expect((await f.run(f.request())).status).toBe(429);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('bounds actual streamed bytes even with no content-length',async()=>{
  const f=setup();expect((await f.run(f.request('x'.repeat(131073)))).status).toBe(413);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('rejects a declared length mismatch rather than changing signed bytes',async()=>{
  const f=setup();expect((await f.run(f.request(undefined,{'content-length':'1'}))).status).toBe(400);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('does not ingest a compressed or non-JSON body',async()=>{
  const f=setup();expect((await f.run(f.request(undefined,{'content-encoding':'gzip'}))).status).toBe(400);
  expect((await f.run(f.request(undefined,{'content-type':'text/plain'}))).status).toBe(415);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('withholds success when the native receipt claims processing or is malformed',async()=>{
  const f=setup();f.ingest.mockResolvedValue({received:true,replayed:false,processed:true,eventId:f.event.id} as unknown as Awaited<ReturnType<typeof f.deps.inbox.ingest>>);
  expect((await f.run(f.request())).status).toBe(503);expect(f.ingest).toHaveBeenCalledOnce();
 });
 it('requires the native receipt to identify the original signed event',async()=>{
  const f=setup();f.ingest.mockResolvedValue({received:true,replayed:false,processed:false,eventId:'evt_OTHER'});
  expect((await f.run(f.request())).status).toBe(503);expect(f.ingest).toHaveBeenCalledOnce();
 });
 it('does not load a secret from environment or continue with an absent configured secret',async()=>{
  const f=setup();f.deps.endpointSecret='';expect((await f.run(f.request())).status).toBe(503);expect(f.admit).not.toHaveBeenCalled();expect(f.ingest).not.toHaveBeenCalled();
 });
 it('cannot continue a stalled runtime load after the request deadline',async()=>{
  vi.useFakeTimers();const f=setup();let release!:(d:FishingBillingTestWebhookDeps)=>void;
  const pending=fishingBillingTestWebhookHttp(f.request(),()=>new Promise(resolve=>{release=resolve;}));
  await vi.advanceTimersByTimeAsync(10001);expect((await pending).status).toBe(503);release(f.deps);await Promise.resolve();expect(f.admit).not.toHaveBeenCalled();expect(f.ingest).not.toHaveBeenCalled();
 });
 it('does not start ingestion when final admission finishes after the deadline',async()=>{
  vi.useFakeTimers();const f=setup();f.admit.mockResolvedValueOnce().mockImplementationOnce(async()=>{vi.setSystemTime(Date.now()+10001);});
  expect((await f.run(f.request())).status).toBe(503);expect(f.admit).toHaveBeenCalledTimes(2);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('does not start ingestion when final admission observes an aborted request',async()=>{
  const f=setup(),controller=new AbortController();f.admit.mockResolvedValueOnce().mockImplementationOnce(async()=>{controller.abort();});
  const request=new Request(f.request(),{signal:controller.signal});expect((await f.run(request)).status).toBe(503);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('withholds202 for an already-started native commit that finishes late',async()=>{
  vi.useFakeTimers();const f=setup();f.ingest.mockImplementation(async()=>{vi.setSystemTime(Date.now()+10001);return {received:true,replayed:false,processed:false,eventId:f.event.id};});
  expect((await f.run(f.request())).status).toBe(503);expect(f.ingest).toHaveBeenCalledOnce();
 });
 it('stops a request aborted during body intake without ingesting',async()=>{
  const f=setup(),controller=new AbortController(),cancel=vi.fn(),body=new ReadableStream<Uint8Array>({cancel});
  const headers=Object.fromEntries(f.request().headers),r=new Request(origin+FISHING_BILLING_TEST_WEBHOOK_PATH,{method:'POST',headers,body,duplex:'half',signal:controller.signal} as RequestInit);
  const pending=f.run(r);await vi.waitFor(()=>expect(f.consume).toHaveBeenCalledOnce());controller.abort();
  expect((await pending).status).toBe(503);expect(f.ingest).not.toHaveBeenCalled();
 });
 it('bounds stalled native intake, without an automatic retry',async()=>{
  vi.useFakeTimers();const f=setup();f.ingest.mockImplementation(()=>new Promise(()=>{}));
  const pending=f.run(f.request());await vi.advanceTimersByTimeAsync(10001);const r=await pending;
  expect(r.status).toBe(503);expect(f.ingest).toHaveBeenCalledOnce();
 });
 it('bounds a stalled request stream and cancels only its own reader',async()=>{
  vi.useFakeTimers();const f=setup(),cancel=vi.fn(),body=new ReadableStream<Uint8Array>({cancel});
  const headers=Object.fromEntries(f.request().headers),request=new Request(origin+FISHING_BILLING_TEST_WEBHOOK_PATH,{method:'POST',headers,body,duplex:'half'} as RequestInit);
  const pending=f.run(request);await vi.advanceTimersByTimeAsync(10001);const r=await pending;
  expect(r.status).toBe(503);expect(cancel).toHaveBeenCalledOnce();expect(f.ingest).not.toHaveBeenCalled();
 });
});
