import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programRing,programKey} from '../fixtures/fishing-native-program-v3.ts';
import {serviceGuestFixtureV4} from '../fixtures/fishing-service-guest-v4.ts';
import {FishingServiceGuestNativeV4} from '../../src/features/fishing-billing/guest-service-native-v4.ts';
import {FishingServiceBillingOwnerV4} from '../../src/features/fishing-billing/guest-service-owner-financial-v4.ts';
import {FishingProgramSourceNativeV3} from '../../src/features/fishing-billing/program-source-native-v3.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_STATE_ACTION_V4} from '../../src/features/fishing-billing/guest-service-owner-state-contract-v4.ts';
import {fishingBillingOwnerHttpV4,type FishingBillingOwnerHttpV4Deps} from '../../src/lib/fishing-billing-owner-http-v4.ts';
import {FISHING_BILLING_OWNER_V4_PATH,ownerServiceReadV4Schema,type OwnerServiceOperationV4} from '../../src/lib/fishing-billing-owner-contract-v4.ts';
import {AppError} from '../../src/lib/errors.ts';
vi.mock('server-only',()=>({}));

// Actual native owner/source/family/issuer/consumer/SQL/crypto. Raw seeded
// synthetic grant and unapproved guardian/legal/resource ports are fixture
// prerequisites only, never evidence of live financial or guardian admission.
let engine:PGlite,f:Awaited<ReturnType<typeof serviceGuestFixtureV4>>,native:FishingServiceBillingOwnerV4;
let cash:Extract<OwnerServiceOperationV4,{action:'cash_date'}>,outcome:Awaited<ReturnType<FishingServiceBillingOwnerV4['recordCashDate']>>;
const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
const origin='https://synthetic-owner-http.invalid',token='a'.repeat(43),csrf='b'.repeat(43);
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql','UNNUMBERED_ls_fishing_service_money_v4.sql','UNNUMBERED_ls_fishing_service_state_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));
 f=await serviceGuestFixtureV4(engine);
 await new FishingServiceGuestNativeV4(f.db,f.workspace,programRing,programKey,f.commandKey,f.clock,f.resolver()).acceptFinancialOffer(f.token,f.command);
 native=new FishingServiceBillingOwnerV4(f.workspace,new FishingProgramSourceNativeV3(f.db,f.workspace,programRing,programKey,f.owner.id,f.clock),
  new FishingBillingInquiryFamilyProposals(f.db,f.workspace,programRing,programKey,f.clock),programRing,programKey,f.commandKey,Buffer.from(programKey),f.clock,{target:async()=>{},authorize:async()=>{}});
 const initial=await native.readSnapshot(f.owner,f.quote.id);
 cash={action:'cash_date',command:{version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:initial.quote.revision,currency:'USD',amountMinor:20000,receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York',allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:20000}]}};
 outcome=await native.recordCashDate(f.owner,cash.command);if(outcome.state!=='committed')throw Error('EXPECTED_SYNTHETIC_COMMIT');
},20000);
afterEach(()=>expect(network).not.toHaveBeenCalled());
afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
function setup(){
 const store={readSnapshot:vi.fn(native.readSnapshot.bind(native)),readMoneyOperation:vi.fn(native.readMoneyOperation.bind(native)),readStateOperation:vi.fn(native.readStateOperation.bind(native)),
  recordCashDate:vi.fn(native.recordCashDate.bind(native)),reverseCash:vi.fn(native.reverseCash.bind(native)),setState:vi.fn(native.setState.bind(native))};
 const deps:FishingBillingOwnerHttpV4Deps={origin,actor:vi.fn(async()=>f.owner),csrf:()=>csrf,limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:0}))},rateLimitKey:'k'.repeat(32),store};
 return {store,deps,load:vi.fn(async()=>deps)};
}
function request(operation?:OwnerServiceOperationV4,intent:'execute'|'recover'='execute',headers:Record<string,string>={},query=''){
 return new Request(origin+FISHING_BILLING_OWNER_V4_PATH+(operation?query:query||'?kind=balance&id='+f.quote.id),{method:operation?'POST':'GET',
  headers:{host:'synthetic-owner-http.invalid','x-forwarded-host':'synthetic-owner-http.invalid','x-forwarded-proto':'https',cookie:'__Host-ls-session='+token,
   ...(operation?{origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':csrf}:{}),...headers},
  ...(operation?{body:JSON.stringify({version:BILLING_SERVICE_V4,intent,operation})}:{}),
 });
}
it.each(['','__Host-ls-session='+token+'; __Host-ls-session='+token])('rejects missing/ambiguous session before dependency loading (%s)',async cookie=>{
 const s=setup();expect((await fishingBillingOwnerHttpV4(request(undefined,'execute',{cookie}),s.load)).status).toBe(401);expect(s.load).not.toHaveBeenCalled();
});
it.each(['parent','child','revoked'] as const)('denies %s before native financial lookup',async kind=>{
 const s=setup();s.deps.actor=async()=>({...f.owner,...(kind==='revoked'?{state:'revoked' as const}:{role:kind})});
 expect((await fishingBillingOwnerHttpV4(request(),s.load)).status).toBe(403);expect(s.store.readSnapshot).not.toHaveBeenCalled();
});
it.each([{'x-csrf-token':'wrong'},{origin:'https://other.invalid'},{'sec-fetch-site':'cross-site'}])('rejects cross-site or CSRF before either execute or recovery',async headers=>{
 for(const intent of ['execute','recover'] as const){const s=setup();expect((await fishingBillingOwnerHttpV4(request(cash,intent,headers),s.load)).status).toBe(403);expect(s.store.recordCashDate).not.toHaveBeenCalled();expect(s.store.readMoneyOperation).not.toHaveBeenCalled();}
});
it('uses the existing forwarding-mismatch UNAVAILABLE boundary before actor resolution or native work',async()=>{
 for(const intent of ['execute','recover'] as const){const s=setup(),response=await fishingBillingOwnerHttpV4(request(cash,intent,{'x-forwarded-host':'other.invalid'}),s.load);
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});expect(s.deps.actor).not.toHaveBeenCalled();expect(s.store.recordCashDate).not.toHaveBeenCalled();expect(s.store.readMoneyOperation).not.toHaveBeenCalled();}
});
it('reads current siblings and recovers the exact original money operation without another mutation',async()=>{
 const s=setup(),read=await fishingBillingOwnerHttpV4(request(),s.load),data=(await read.json()).data;
 expect(read.status).toBe(200);expect(data.current.balance.lines).toHaveLength(2);expect(data.current.balance.paidMinor).toBe(20000);
 const response=await fishingBillingOwnerHttpV4(request(cash,'recover'),s.load),body=(await response.json()).data;
 expect(response.status).toBe(200);expect(ownerServiceReadV4Schema.safeParse(body).success).toBe(true);expect(body.state).toBe('confirmed');expect(body.receipt.operationId).toBe(cash.command.operationId);expect(body.receipt.replayed).toBe(true);
 expect(s.store.readMoneyOperation).toHaveBeenCalledExactlyOnceWith(f.owner,cash);expect(s.store.recordCashDate).not.toHaveBeenCalled();
});
it('returns an absent original command as unresolved, and never retries it',async()=>{
 const s=setup(),operation={...cash,command:{...cash.command,operationId:randomUUID()}};
 const response=await fishingBillingOwnerHttpV4(request(operation,'recover'),s.load);
 expect(response.status).toBe(200);expect((await response.json()).data).toEqual({version:BILLING_SERVICE_V4,state:'unresolved',operation});expect(s.store.recordCashDate).not.toHaveBeenCalled();
});
it.each(['CONFLICT','FORBIDDEN','UNAUTHENTICATED','NOT_FOUND'] as const)('normalizes a typed %s after durable native commit to UNKNOWN and then recovers without duplicate money',async code=>{
 const s=setup(),before=await native.readSnapshot(f.owner,f.quote.id),operation={...cash,command:{...cash.command,operationId:randomUUID(),expectedVersion:before.quote.revision,amountMinor:5000,allocations:[{lineId:cash.command.allocations[0]!.lineId,amountMinor:5000}]}};
 s.store.recordCashDate.mockImplementationOnce(async(actor,command)=>{await native.recordCashDate(actor,command);throw new AppError(code);});
 const response=await fishingBillingOwnerHttpV4(request(operation),s.load);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});
 const read=await fishingBillingOwnerHttpV4(request(operation,'recover'),s.load),body=(await read.json()).data;
 expect(read.status).toBe(200);expect(body.state).toBe('confirmed');expect(body.receipt.operationId).toBe(operation.command.operationId);expect(s.store.recordCashDate).toHaveBeenCalledTimes(1);
 expect((await native.readSnapshot(f.owner,f.quote.id)).balance.receipts.filter(r=>r.operationId===operation.command.operationId)).toHaveLength(1);
});
it('preserves the native structured current-attempt rejection instead of claiming all earlier attempts failed',async()=>{
 const s=setup();s.store.recordCashDate.mockResolvedValueOnce({version:BILLING_SERVICE_V4,state:'rejected_current_attempt',workspaceId:f.workspace,actorId:f.owner.id,input:cash,code:'CONFLICT'});
 const response=await fishingBillingOwnerHttpV4(request(cash),s.load);
 expect(response.status).toBe(200);expect((await response.json()).data).toEqual({version:BILLING_SERVICE_V4,state:'rejected_current_attempt',operation:cash,code:'CONFLICT'});expect(s.store.readSnapshot).not.toHaveBeenCalled();
});
it('rejects a mismatched original amount or returned owner without leaking a confirmed receipt',async()=>{
 for(const bad of ['amount','owner']){const s=setup();if(outcome.state!=='committed')throw Error('EXPECTED_COMMIT');
  s.store.readMoneyOperation.mockResolvedValueOnce({...outcome.result,...(bad==='owner'?{actorId:randomUUID()}:{})});
  const operation=bad==='amount'?{...cash,command:{...cash.command,amountMinor:10000,allocations:[{lineId:cash.command.allocations[0]!.lineId,amountMinor:10000}]}}:cash;
  const response=await fishingBillingOwnerHttpV4(request(operation,'recover'),s.load);expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty('data');
 }
});
it('keeps a confirmed save uncertain when fresh current authority fails',async()=>{
 const s=setup();s.store.readSnapshot.mockRejectedValueOnce(new AppError('FORBIDDEN'));
 const response=await fishingBillingOwnerHttpV4(request(cash,'recover'),s.load);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});
});
it('executes and recovers a distinct state command while keeping the original acceptance unchanged',async()=>{
 const s=setup(),before=await native.readSnapshot(f.owner,f.quote.id),operation:OwnerServiceOperationV4={action:'state',command:{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:before.quote.revision,paused:true}};
 const response=await fishingBillingOwnerHttpV4(request(operation),s.load),body=(await response.json()).data;
 expect(response.status).toBe(200);expect(body.state).toBe('confirmed');expect(body.current.quote.paused).toBe(true);expect(body.current.quote.acceptance).toEqual(before.quote.acceptance);
 const recovered=await fishingBillingOwnerHttpV4(request(operation,'recover'),s.load);expect(recovered.status).toBe(200);expect((await recovered.json()).data.receipt.replayed).toBe(true);expect(s.store.setState).toHaveBeenCalledTimes(1);
});
it('rejects query ambiguity and makes all responses private and non-cacheable',async()=>{
 const s=setup(),response=await fishingBillingOwnerHttpV4(request(undefined,'execute',{},'?kind=balance&id='+f.quote.id+'&id='+f.quote.id),s.load);
 expect(response.status).toBe(400);expect(s.store.readSnapshot).not.toHaveBeenCalled();expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('Vary')).toBe('Cookie');expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
});
it('rejects caller authority fields and ID-only recovery instead of interpreting them as native authority',async()=>{
 for(const raw of [{version:BILLING_SERVICE_V4,intent:'execute',operation:cash,actorId:f.owner.id},{version:BILLING_SERVICE_V4,intent:'recover',operationId:cash.command.operationId}]){
  const s=setup(),response=await fishingBillingOwnerHttpV4(new Request(request(cash),{body:JSON.stringify(raw)}),s.load);
  expect(response.status).toBe(400);expect(s.store.recordCashDate).not.toHaveBeenCalled();expect(s.store.readMoneyOperation).not.toHaveBeenCalled();
 }
});
