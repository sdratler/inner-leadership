import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {AppError} from '../../src/lib/errors.ts';
import {fishingBillingOwnerHttp,type FishingBillingOwnerHttpDeps} from '../../src/lib/fishing-billing-owner-http.ts';
import {FISHING_BILLING_OWNER_PATH,billingOwnerReadSchema} from '../../src/lib/fishing-billing-owner-contract.ts';
import {BILLING_DTO_VERSION,operationReceiptSchema,type BillingOperationReceipt} from '../../src/features/fishing-billing/contracts.ts';
import {projectBalance} from '../../src/features/fishing-billing/domain.ts';
import {syntheticAccepted,syntheticBillingFixtures,syntheticId,syntheticOwner,syntheticWorkspace,syntheticNow} from '../../src/features/fishing-billing/fixtures.ts';
import type {Actor} from '../../src/features/identity/types.ts';

const origin='https://fishing-owner.example.invalid',token='a'.repeat(43),csrf='b'.repeat(43);
const actor={id:syntheticOwner,workspaceId:syntheticWorkspace,personId:syntheticId(99),role:'practitioner',state:'active',locale:'en',sessionDigest:'c'.repeat(64),expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
const quote=syntheticAccepted(),operationId=syntheticId(601);
const original={quote,balance:projectBalance(quote,[]),receiptId:null};
const receipt=operationReceiptSchema.parse({version:BILLING_DTO_VERSION,operationId,entityId:quote.id,entityVersion:quote.revision,replayed:true,result:original});
const partial=syntheticBillingFixtures().twoChildPartial;
const currentQuote={...partial.quote,revision:quote.revision+1};
const current={quote:currentQuote,balance:{...partial.balance,revision:currentQuote.revision},receiptId:null};
function setup(){
 const store={
  readBalance:vi.fn<FishingBillingOwnerHttpDeps['store']['readBalance']>().mockResolvedValue(current),
  readOperationReceipt:vi.fn<FishingBillingOwnerHttpDeps['store']['readOperationReceipt']>().mockResolvedValue(null),
  recordCash:vi.fn<FishingBillingOwnerHttpDeps['store']['recordCash']>().mockResolvedValue(receipt),
  reverseCash:vi.fn<FishingBillingOwnerHttpDeps['store']['reverseCash']>().mockResolvedValue(receipt),
  setState:vi.fn<FishingBillingOwnerHttpDeps['store']['setState']>().mockResolvedValue(receipt),
 };
 const deps: FishingBillingOwnerHttpDeps={origin,actor:vi.fn(async()=>actor),csrf:()=>csrf,
  limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:0}))},rateLimitKey:'d'.repeat(32),store};
 return {deps,store,load:vi.fn(async()=>deps)};
}
function req(query='',body?:unknown,headers:Record<string,string>={}){
 return new Request(origin+FISHING_BILLING_OWNER_PATH+query,{
  method:body===undefined?'GET':'POST',headers:{host:'fishing-owner.example.invalid','x-forwarded-host':'fishing-owner.example.invalid','x-forwarded-proto':'https',cookie:'__Host-ls-session='+token,
   ...(body===undefined?{}:{origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':csrf}),...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 });
}
const cash={action:'cash',command:{operationId,expectedVersion:quote.revision,quoteId:quote.id,currency:'USD',amountMinor:20000,receivedAt:syntheticNow,allocations:[{lineId:quote.lines[1]!.id,amountMinor:20000}]}};

it.each(['','__Host-ls-session='+token+'; __Host-ls-session='+token])('rejects absent or ambiguous session before loading billing (%s)',async cookie=>{
 const s=setup();const r=await fishingBillingOwnerHttp(req('?kind=balance&id='+quote.id,undefined,{cookie}),s.load);
 expect(r.status).toBe(401);expect(s.load).not.toHaveBeenCalled();
});
it.each(['parent','adult_client','child','revoked'] as const)('denies %s before any financial read',async value=>{
 const s=setup();s.deps.actor=async()=>({...actor,...(value==='revoked'?{state:'revoked' as const}:{role:value})});
 expect((await fishingBillingOwnerHttp(req('?kind=balance&id='+quote.id),s.load)).status).toBe(403);
 expect(s.store.readBalance).not.toHaveBeenCalled();
});
it('does not translate an absent operation into save failure or a fresh-key retry',async()=>{
 const s=setup(),r=await fishingBillingOwnerHttp(req('?kind=operation&id='+operationId),s.load),body=await r.json();
 expect(r.status).toBe(200);expect(body.data).toEqual({version:BILLING_DTO_VERSION,state:'unresolved',operationId});
 expect(s.store.recordCash).not.toHaveBeenCalled();expect(s.store.readBalance).not.toHaveBeenCalled();
});
it('pairs recovered historical receipt with freshly authorized current balance',async()=>{
 const s=setup();s.store.readOperationReceipt.mockResolvedValue(receipt);
 const r=await fishingBillingOwnerHttp(req('?kind=operation&id='+operationId),s.load),body=await r.json();
 expect(r.status).toBe(200);expect(billingOwnerReadSchema.safeParse(body.data).success).toBe(true);
 expect(body.data.receipt.result.balance.remainingMinor).toBe(130000);
 expect(body.data.current.balance.remainingMinor).toBe(45000);expect(body.data.current.quote.revision).toBe(4);
 expect(s.store.readBalance).toHaveBeenCalledWith(actor,quote.id);expect(s.store.recordCash).not.toHaveBeenCalled();
});
it.each([{'x-csrf-token':'wrong'},{origin:'https://other.example.invalid'},{'sec-fetch-site':'cross-site'}])('rejects cross-site or forged mutation token',async headers=>{
 const s=setup();expect((await fishingBillingOwnerHttp(req('',cash,headers),s.load)).status).toBe(403);
 expect(s.store.recordCash).not.toHaveBeenCalled();
});
it('rejects caller-supplied authority and accepts only the business command',async()=>{
 const s=setup();expect((await fishingBillingOwnerHttp(req('',{...cash,actorId:syntheticOwner}),s.load)).status).toBe(400);
 expect(s.store.recordCash).not.toHaveBeenCalled();
 const r=await fishingBillingOwnerHttp(req('',cash),s.load);
 expect(r.status).toBe(200);expect(s.store.recordCash).toHaveBeenCalledExactlyOnceWith(actor,cash.command);
 expect((await r.json()).data.current.balance.remainingMinor).toBe(45000);
});
it.each(['UNAVAILABLE','FORBIDDEN','UNAUTHENTICATED','NOT_FOUND'] as const)('keeps a confirmed operation uncertain when current readback fails with %s',async code=>{
 const s=setup();s.store.readBalance.mockRejectedValue(new AppError(code));
 const r=await fishingBillingOwnerHttp(req('',cash),s.load),body=await r.json();
 expect(s.store.recordCash).toHaveBeenCalledOnce();expect(r.status).toBe(503);
 expect(body).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});expect(body).not.toHaveProperty('data');
 const recovered=setup();recovered.store.readOperationReceipt.mockResolvedValue(receipt);
 recovered.store.readBalance.mockRejectedValue(new AppError(code));
 const lookup=await fishingBillingOwnerHttp(req('?kind=operation&id='+operationId),recovered.load);
 expect(lookup.status).toBe(503);expect(await lookup.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});
 expect(recovered.store.recordCash).not.toHaveBeenCalled();
});
it('fails closed on mismatched operation or family readback',async()=>{
 const s=setup();s.store.readOperationReceipt.mockResolvedValue({...receipt,operationId:syntheticId(602)} as BillingOperationReceipt);
 expect((await fishingBillingOwnerHttp(req('?kind=operation&id='+operationId),s.load)).status).toBe(503);
 expect(s.store.readBalance).not.toHaveBeenCalled();
 s.store.readOperationReceipt.mockResolvedValue(receipt);
 s.store.readBalance.mockResolvedValue({...current,quote:{...current.quote,familyId:syntheticId(88)},balance:{...current.balance,familyId:syntheticId(88)}});
 expect((await fishingBillingOwnerHttp(req('?kind=operation&id='+operationId),s.load)).status).toBe(503);
});
it('rejects duplicate query keys and strips private details from authorization failures',async()=>{
 const s=setup();expect((await fishingBillingOwnerHttp(req('?kind=balance&id='+quote.id+'&id='+quote.id),s.load)).status).toBe(400);
 s.store.readBalance.mockRejectedValue(new AppError('FORBIDDEN'));
 const r=await fishingBillingOwnerHttp(req('?kind=balance&id='+quote.id),s.load),text=await r.text();
 expect(r.status).toBe(403);expect(text).not.toContain(quote.familyId);
 expect(r.headers.get('Cache-Control')).toContain('no-store');expect(r.headers.get('Vary')).toBe('Cookie');
});
it('denies an unavailable limiter before any money mutation',async()=>{
 const s=setup();s.deps.limits.consume=async()=>{throw new Error('synthetic limiter unavailable');};
 expect((await fishingBillingOwnerHttp(req('',cash),s.load)).status).toBe(503);expect(s.store.recordCash).not.toHaveBeenCalled();
});
