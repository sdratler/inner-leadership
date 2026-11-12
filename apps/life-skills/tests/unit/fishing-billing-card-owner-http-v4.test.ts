import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {fishingBillingCardOwnerHttpV4,type FishingBillingCardOwnerHttpV4Deps} from '../../src/lib/fishing-billing-card-owner-http-v4.ts';
import {BILLING_CARD_OWNER_V4,FISHING_BILLING_CARD_OWNER_V4_PATH,ownerCardReadV4Schema} from '../../src/lib/fishing-billing-card-owner-contract-v4.ts';
import {CARD_VERSION,cardAttemptSchema,cardPreparationReceiptSchema,type PrepareCardCommand} from '../../src/features/fishing-billing/card-contracts.ts';
import {serviceOwnerSnapshotV4Schema} from '../../src/features/fishing-billing/guest-service-owner-financial-contract-v4.ts';
import {calculateLedger} from '../../src/features/fishing-billing/ledger-math.ts';
import {serviceOwnerUiFixtureV4,serviceUiIdV4} from '../fixtures/fishing-service-owner-ui-v4.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';

// PURE SYNTHETIC transport fixtures and mock native ports, not actual native,
// guardian, legal, provider, durable-storage or financial-admission evidence.
const origin='https://synthetic-card-owner.invalid',token='a'.repeat(43),csrf='b'.repeat(43),network=vi.fn(()=>{throw Error('NO_NETWORK');});
beforeEach(()=>vi.stubGlobal('fetch',network));afterEach(()=>{try{expect(network).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}});
function setup(){
 const f=serviceOwnerUiFixtureV4(),actor={id:f.scope.actorId,workspaceId:f.scope.workspaceId,personId:serviceUiIdV4(99),role:'practitioner',state:'active',locale:'en',sessionDigest:'c'.repeat(64),expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
 const command:PrepareCardCommand={operationId:serviceUiIdV4(920),quoteId:f.scope.quoteId,expectedVersion:f.current.quote.revision,selection:[{lineId:f.current.quote.lines[0]!.id,amountMinor:20000}]};
 const quote={...f.current.quote,revision:command.expectedVersion+1};
 const current=serviceOwnerSnapshotV4Schema.parse({...f.current,quote,balance:{...calculateLedger(quote,[],[command.operationId]),version:f.current.version}});
 const receipt=cardPreparationReceiptSchema.parse({version:CARD_VERSION,operationId:command.operationId,quoteId:quote.id,entityVersion:quote.revision,replayed:false,result:{attemptId:command.operationId,amountMinor:20000,allocations:command.selection}});
 const attempt=cardAttemptSchema.parse({version:CARD_VERSION,id:command.operationId,workspaceId:actor.workspaceId,quoteId:quote.id,familyId:quote.familyId,actorId:actor.id,revision:1,balanceVersion:quote.revision,
  binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC-UNAPPROVED'},command,requestDigest:'a'.repeat(64),preparation:receipt,createdAt:'2035-01-06T15:00:00.000Z',state:'prepared',dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
 const cards={prepare:vi.fn<FishingBillingCardOwnerHttpV4Deps['cards']['prepare']>().mockResolvedValue(receipt),readPreparationReceipt:vi.fn<FishingBillingCardOwnerHttpV4Deps['cards']['readPreparationReceipt']>().mockResolvedValue({...receipt,replayed:true}),readAttempt:vi.fn<FishingBillingCardOwnerHttpV4Deps['cards']['readAttempt']>().mockResolvedValue(attempt)};
 const deps:FishingBillingCardOwnerHttpV4Deps={origin,actor:vi.fn(async()=>actor),csrf:()=>csrf,limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:0}))},rateLimitKey:'r'.repeat(32),cards,readCurrent:vi.fn(async()=>current)};
 return {f,actor,command,current,receipt,attempt,cards,deps,load:vi.fn(async()=>deps)};
}
function request(s:ReturnType<typeof setup>,intent:'prepare'|'recover'|null='prepare',headers:Record<string,string>={},query=''){
 return new Request(origin+FISHING_BILLING_CARD_OWNER_V4_PATH+(intent?query:query||'?kind=attempt&quoteId='+s.command.quoteId+'&attemptId='+s.command.operationId),{method:intent?'POST':'GET',
  headers:{host:'synthetic-card-owner.invalid','x-forwarded-host':'synthetic-card-owner.invalid','x-forwarded-proto':'https',cookie:'__Host-ls-session='+token,
   ...(intent?{origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':csrf}:{}),...headers},
  ...(intent?{body:JSON.stringify({version:BILLING_CARD_OWNER_V4,intent,command:s.command})}:{}),
 });
}
it.each(['','__Host-ls-session='+token+'; __Host-ls-session='+token])('rejects absent or ambiguous authentication before loading native ports (%s)',async cookie=>{
 const s=setup();expect((await fishingBillingCardOwnerHttpV4(request(s,'prepare',{cookie}),s.load)).status).toBe(401);expect(s.load).not.toHaveBeenCalled();
});
it.each(['parent','child','revoked'] as const)('denies %s before any native lookup',async kind=>{
 const s=setup();s.deps.actor=async()=>({...s.actor,...(kind==='revoked'?{state:'revoked' as const}:{role:kind})});
 expect((await fishingBillingCardOwnerHttpV4(request(s,null),s.load)).status).toBe(403);expect(s.cards.readAttempt).not.toHaveBeenCalled();
});
it.each([{'x-csrf-token':'wrong'},{origin:'https://other.invalid'},{'sec-fetch-site':'cross-site'}])('requires CSRF and same-origin for preparation AND original recovery',async headers=>{
 for(const intent of ['prepare','recover'] as const){const s=setup();expect((await fishingBillingCardOwnerHttpV4(request(s,intent,headers),s.load)).status).toBe(403);expect(s.cards.prepare).not.toHaveBeenCalled();expect(s.cards.readPreparationReceipt).not.toHaveBeenCalled();}
});
it('rejects forwarding mismatch before actor/native resolution',async()=>{
 const s=setup();expect((await fishingBillingCardOwnerHttpV4(request(s,null,{'x-forwarded-host':'other.invalid'}),s.load)).status).toBe(503);expect(s.deps.actor).not.toHaveBeenCalled();expect(s.cards.readAttempt).not.toHaveBeenCalled();
});
it('returns original preparation separately from current V4 sibling balances',async()=>{
 const s=setup(),r=await fishingBillingCardOwnerHttpV4(request(s),s.load),body=(await r.json()).data;
 expect(r.status).toBe(200);expect(ownerCardReadV4Schema.safeParse(body).success).toBe(true);expect(body.state).toBe('prepared');expect(body.current.balance.lines).toHaveLength(2);expect(body.current.balance.paidMinor).toBe(0);
 expect(body.receipt.result.amountMinor).toBe(20000);expect(s.cards.prepare).toHaveBeenCalledExactlyOnceWith(s.actor,s.command);expect(body.attempt).not.toHaveProperty('checkoutUrl');
});
it('recovers only the entire original command without preparing or reserving again',async()=>{
 const s=setup(),r=await fishingBillingCardOwnerHttpV4(request(s,'recover'),s.load),body=(await r.json()).data;
 expect(r.status).toBe(200);expect(body.receipt.replayed).toBe(true);expect(s.cards.readPreparationReceipt).toHaveBeenCalledExactlyOnceWith(s.actor,s.command);expect(s.cards.prepare).not.toHaveBeenCalled();
});
it('keeps absence unresolved instead of interpreting it as a failed save or creating another operation',async()=>{
 const s=setup();s.cards.readPreparationReceipt.mockResolvedValueOnce(null);const r=await fishingBillingCardOwnerHttpV4(request(s,'recover'),s.load);
 expect(r.status).toBe(200);expect((await r.json()).data).toEqual({version:BILLING_CARD_OWNER_V4,state:'unresolved',command:s.command});expect(s.cards.prepare).not.toHaveBeenCalled();expect(s.cards.readAttempt).not.toHaveBeenCalled();expect(s.deps.readCurrent).not.toHaveBeenCalled();
});
it.each(['CONFLICT','FORBIDDEN','UNAUTHENTICATED'] as const)('keeps a native/post-commit typed %s uncertain, with read-only recovery of the original',async code=>{
 const s=setup();s.cards.prepare.mockImplementationOnce(async()=>{throw new AppError(code);});
 const failed=await fishingBillingCardOwnerHttpV4(request(s),s.load);expect(failed.status).toBe(503);expect(await failed.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});
 const recovered=await fishingBillingCardOwnerHttpV4(request(s,'recover'),s.load);expect(recovered.status).toBe(200);expect((await recovered.json()).data.receipt.operationId).toBe(s.command.operationId);expect(s.cards.prepare).toHaveBeenCalledTimes(1);
});
it.each(['actor','workspace','original_command'] as const)('fails closed on mismatched %s preparation facts',async bad=>{
 const s=setup();s.cards.readAttempt.mockResolvedValueOnce({...s.attempt,...(bad==='actor'?{actorId:serviceUiIdV4(777)}:bad==='workspace'?{workspaceId:serviceUiIdV4(778)}:{command:{...s.command,expectedVersion:s.command.expectedVersion+1}})});
 const r=await fishingBillingCardOwnerHttpV4(request(s,'recover'),s.load);expect(r.status).toBe(503);expect(await r.json()).not.toHaveProperty('data');
});
it('never relabels a confirmed preparation as failure when current permission/readback fails',async()=>{
 const s=setup();s.deps.readCurrent=async()=>{throw new AppError('FORBIDDEN');};const r=await fishingBillingCardOwnerHttpV4(request(s),s.load);
 expect(r.status).toBe(503);expect(await r.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});expect(s.cards.prepare).toHaveBeenCalledOnce();
});
it('strips historical checkout URLs and exposes no provider request or dispatch capability',async()=>{
 const s=setup(),secretUrl='https://checkout.stripe.com/c/pay/SYNTHETIC_SECRET';s.cards.readAttempt.mockResolvedValueOnce({...s.attempt,state:'open',sessionId:'cs_SYNTHETIC',checkoutUrl:secretUrl});
 const r=await fishingBillingCardOwnerHttpV4(request(s,null),s.load),body=await r.json();expect(r.status).toBe(200);expect(JSON.stringify(body)).not.toContain(secretUrl);expect(body.data.attempt).not.toHaveProperty('checkoutUrl');expect(body.data).not.toHaveProperty('request');expect(body.data).not.toHaveProperty('dispatch');
});
it('rejects ID-only recovery, caller authority, legacy outer version and dispatch actions before native work',async()=>{
 const s=setup();for(const body of [{version:BILLING_CARD_OWNER_V4,intent:'recover',operationId:s.command.operationId},{version:BILLING_CARD_OWNER_V4,intent:'prepare',command:s.command,actorId:s.actor.id},{version:'JLFA-FISHING-OWNER-CARD-v3',intent:'prepare',command:s.command},{version:BILLING_CARD_OWNER_V4,intent:'reserve',command:s.command}]){
  const r=await fishingBillingCardOwnerHttpV4(new Request(request(s),{body:JSON.stringify(body)}),s.load);expect(r.status).toBe(400);
 }expect(s.cards.prepare).not.toHaveBeenCalled();expect(s.cards.readPreparationReceipt).not.toHaveBeenCalled();
});
it('rejects query ambiguity and GET operation recovery, retaining private response headers',async()=>{
 const s=setup();for(const query of ['?kind=attempt&quoteId='+s.command.quoteId+'&attemptId='+s.command.operationId+'&attemptId='+s.command.operationId,'?kind=operation&quoteId='+s.command.quoteId+'&attemptId='+s.command.operationId]){
  const r=await fishingBillingCardOwnerHttpV4(request(s,null,{},query),s.load);expect(r.status).toBe(400);expect(r.headers.get('Cache-Control')).toContain('no-store');expect(r.headers.get('Vary')).toBe('Cookie');expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
 }expect(s.cards.readAttempt).not.toHaveBeenCalled();
});
it('fails closed when the limiter is unavailable, before preparing',async()=>{
 const s=setup();s.deps.limits.consume=async()=>{throw Error('SYNTHETIC limiter unavailable');};expect((await fishingBillingCardOwnerHttpV4(request(s),s.load)).status).toBe(503);expect(s.cards.prepare).not.toHaveBeenCalled();
});
