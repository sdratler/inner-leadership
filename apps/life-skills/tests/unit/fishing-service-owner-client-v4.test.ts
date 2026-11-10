import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createFishingBillingOwnerClientV4,prepareServiceOwnerOperationV4} from '../../src/lib/fishing-billing-owner-client-v4.ts';
import {ownerServiceReadV4Schema,FISHING_BILLING_OWNER_V4_PATH} from '../../src/lib/fishing-billing-owner-contract-v4.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {serviceOwnerUiFixtureV4,serviceOwnerConfirmedFixtureV4,serviceUiIdV4} from '../fixtures/fishing-service-owner-ui-v4.ts';

const network=vi.fn(()=>{throw Error('NO_REAL_NETWORK');});
beforeEach(()=>vi.stubGlobal('fetch',network));
afterEach(()=>{try{expect(network).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();vi.useRealTimers();}});
const origin='https://synthetic-v4-owner.invalid';
const ok=(data:unknown)=>Response.json({ok:true,data,requestId:serviceUiIdV4(999)});
function setup(handler?:(request:Request)=>Promise<Response>,timeoutMs=1000){
 const f=serviceOwnerUiFixtureV4(),pending=prepareServiceOwnerOperationV4(f.cash),csrf=vi.fn(async()=>'a'.repeat(43));
 const transport=vi.fn(handler??(async()=>ok(serviceOwnerConfirmedFixtureV4(f.cash,f.current))));
 const client=createFishingBillingOwnerClientV4({origin,scope:f.scope,csrf,transport,timeoutMs});return {...f,pending,csrf,transport,client};
}
it('keeps the explicit V4 original command frozen, separate from later editor mutations',()=>{
 const f=serviceOwnerUiFixtureV4(),pending=prepareServiceOwnerOperationV4(f.cash);f.cash.command.allocations[0]!.amountMinor=1;
 if(pending.operation.action!=='cash_date')throw Error('FIXTURE');
 expect(pending.operation.command.allocations?.[0]?.amountMinor).toBe(20000);
 expect(Object.isFrozen(pending.operation.command)).toBe(true);expect(Object.isFrozen(pending.operation.command.allocations)).toBe(true);
 expect(pending.serializedOperation).toBe(JSON.stringify(pending.operation));
 expect(()=>prepareServiceOwnerOperationV4({...f.cash,command:{...f.cash.command,version:'JLFA-FISHING-BILLING-GUEST-v3'}})).toThrow();
});
it('posts execute and recovery with the SAME complete command, CSRF, private same-origin transport and no ID-only lookup',async()=>{
 const s=setup();expect((await s.client.execute(s.pending)).kind).toBe('confirmed');expect((await s.client.recover(s.pending)).kind).toBe('confirmed');
 expect(s.csrf).toHaveBeenCalledTimes(2);expect(s.transport).toHaveBeenCalledTimes(2);
 for(const [i,[request]] of s.transport.mock.calls.entries()){
  expect(request.url).toBe(origin+FISHING_BILLING_OWNER_V4_PATH);expect(request.method).toBe('POST');expect(request.headers.get('x-csrf-token')).toBe('a'.repeat(43));
  expect(request.credentials).toBe('same-origin');expect(request.mode).toBe('same-origin');expect(request.cache).toBe('no-store');expect(request.redirect).toBe('error');expect(request.referrerPolicy).toBe('no-referrer');
  expect(await request.clone().json()).toEqual({version:BILLING_SERVICE_V4,intent:i===0?'execute':'recover',operation:s.pending.operation});
 }
});
it('reads only the pinned current offer without CSRF or an implicit mutation',async()=>{
 const s=setup();s.transport.mockResolvedValueOnce(ok({version:BILLING_SERVICE_V4,state:'ready',current:s.current}));
 expect(await s.client.readCurrent()).toEqual(s.current);expect(s.csrf).not.toHaveBeenCalled();
 expect(s.transport.mock.calls[0]![0].url).toBe(origin+FISHING_BILLING_OWNER_V4_PATH+'?kind=balance&id='+s.scope.quoteId);expect(s.transport.mock.calls[0]![0].method).toBe('GET');
});
it.each([[400,'INVALID_REQUEST'],[401,'UNAUTHENTICATED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[409,'CONFLICT'],[429,'RATE_LIMITED'],[503,'UNAVAILABLE']] as const)('keeps HTTP%s %s UNKNOWN after transport rather than declaring rollback',async(status,code)=>{
 const s=setup(async()=>Response.json({ok:false,error:{code},requestId:serviceUiIdV4(999)},{status}));
 expect(await s.client.execute(s.pending)).toEqual({kind:'unknown'});expect(s.transport).toHaveBeenCalledTimes(1);
});
it('distinguishes native structured current-attempt rejection and unresolved recovery without executing again',async()=>{
 const s=setup();s.transport.mockResolvedValueOnce(ok({version:BILLING_SERVICE_V4,state:'rejected_current_attempt',operation:s.pending.operation,code:'CONFLICT'}));
 expect(await s.client.execute(s.pending)).toMatchObject({kind:'rejected_current_attempt',data:{code:'CONFLICT'}});
 s.transport.mockResolvedValueOnce(ok({version:BILLING_SERVICE_V4,state:'unresolved',operation:s.pending.operation}));
 expect(await s.client.recover(s.pending)).toMatchObject({kind:'unresolved'});expect(s.transport).toHaveBeenCalledTimes(2);
});
it('rejects a different original date even with the same operation ID and internally consistent returned receipt',async()=>{
 const s=setup(),other={...s.cash,command:{...s.cash.command,receivedDate:'2035-01-04'}};
 const data=ownerServiceReadV4Schema.parse(serviceOwnerConfirmedFixtureV4(other,s.current));s.transport.mockResolvedValueOnce(ok(data));
 expect(await s.client.execute(s.pending)).toEqual({kind:'unknown'});
});
it('does not accept another actor or a different selected-offer binding',async()=>{
 const s=setup(),data=structuredClone(serviceOwnerConfirmedFixtureV4(s.cash,s.current));if(data.state!=='confirmed')throw Error('FIXTURE');
 data.receipt.actorId=serviceUiIdV4(1234);if('result' in data.receipt){data.receipt.result.receipt.actorId=data.receipt.actorId;data.current.balance.receipts[0]!.actorId=data.receipt.actorId;}
 expect(ownerServiceReadV4Schema.safeParse(data).success).toBe(true);s.transport.mockResolvedValueOnce(ok(data));expect((await s.client.execute(s.pending)).kind).toBe('unknown');
 const client=createFishingBillingOwnerClientV4({origin,scope:{...s.scope,offerSha256:'0'.repeat(64)},csrf:s.csrf,transport:s.transport});
 expect((await client.execute(s.pending)).kind).toBe('unknown');
});
it('does not send edited serialization, wrong quote or invalid CSRF',async()=>{
 const s=setup();expect(await s.client.execute({...s.pending,serializedOperation:s.pending.serializedOperation+' '})).toEqual({kind:'not_sent',code:'INVALID_REQUEST'});
 const other=prepareServiceOwnerOperationV4({...s.cash,command:{...s.cash.command,quoteId:serviceUiIdV4(222)}});
 expect(await s.client.execute(other)).toEqual({kind:'not_sent',code:'FORBIDDEN'});expect(s.transport).not.toHaveBeenCalled();expect(s.csrf).not.toHaveBeenCalled();
 s.csrf.mockResolvedValueOnce('');expect(await s.client.execute(s.pending)).toEqual({kind:'not_sent',code:'UNAVAILABLE'});expect(s.transport).not.toHaveBeenCalled();
});
it.each(['html','redirect','oversized','invalid_utf8'] as const)('keeps %s response failures UNKNOWN',async kind=>{
 const s=setup(async()=>{
  if(kind==='html')return new Response('<html/>');
  if(kind==='redirect'){const r=ok({});Object.defineProperty(r,'redirected',{value:true});return r;}
  return new Response(kind==='oversized'?new Uint8Array(4_100_500):new Uint8Array([255]),{headers:{'content-type':'application/json'}});
 });expect(await s.client.execute(s.pending)).toEqual({kind:'unknown'});
});
it('bounds a transport that ignores abort and ignores its late success without retry',async()=>{
 vi.useFakeTimers();let release!:(response:Response)=>void;
 const s=setup(()=>new Promise(resolve=>{release=resolve;}),10),pending=s.client.execute(s.pending);
 await vi.advanceTimersByTimeAsync(11);expect(await pending).toEqual({kind:'unknown'});expect(s.transport).toHaveBeenCalledOnce();expect(s.transport.mock.calls[0]![0].signal.aborted).toBe(true);
 release(ok(serviceOwnerConfirmedFixtureV4(s.cash,s.current)));await Promise.resolve();expect(s.transport).toHaveBeenCalledOnce();
});
it('never dispatches after a timed-out CSRF read completes late',async()=>{
 vi.useFakeTimers();const s=setup(undefined,10);let release!:(value:string)=>void;s.csrf.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const result=s.client.execute(s.pending);await vi.advanceTimersByTimeAsync(11);expect(await result).toEqual({kind:'not_sent',code:'UNAVAILABLE'});
 release('b'.repeat(43));await Promise.resolve();await Promise.resolve();expect(s.transport).not.toHaveBeenCalled();
});
