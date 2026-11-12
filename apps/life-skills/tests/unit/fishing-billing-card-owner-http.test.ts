import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {fishingBillingCardOwnerHttp,type FishingBillingCardOwnerDeps} from '../../src/lib/fishing-billing-card-owner-http.ts';
import {FISHING_BILLING_CARD_OWNER_PATH} from '../../src/lib/fishing-billing-card-owner-contract.ts';
import {AppError} from '../../src/lib/errors.ts';
import {SESSION_COOKIE} from '../../src/lib/security/session.ts';
import {CARD_VERSION,cardAttemptSchema} from '../../src/features/fishing-billing/card-contracts.ts';
import {projectBalanceV2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {syntheticAccepted,syntheticId,syntheticOwner,syntheticWorkspace,syntheticReceipt} from '../../src/features/fishing-billing/fixtures.ts';
import type {Actor} from '../../src/features/identity/types.ts';

const origin='https://fishing-card-owner.invalid',token='a'.repeat(43),csrf='b'.repeat(43);
const actor={id:syntheticOwner,workspaceId:syntheticWorkspace,personId:syntheticId(99),role:'practitioner',state:'active',locale:'en',sessionDigest:'c'.repeat(64),expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
function setup(){
 const quote={...syntheticAccepted(),revision:4},command={operationId:syntheticId(801),quoteId:quote.id,expectedVersion:3,selection:[{lineId:quote.lines[0]!.id,amountMinor:20000}]};
 const preparation={version:CARD_VERSION,operationId:command.operationId,quoteId:quote.id,entityVersion:4,replayed:false,result:{attemptId:command.operationId,amountMinor:20000,allocations:command.selection}};
 const attempt=cardAttemptSchema.parse({version:CARD_VERSION,id:command.operationId,workspaceId:quote.workspaceId,quoteId:quote.id,familyId:quote.familyId,actorId:actor.id,revision:1,balanceVersion:4,binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC-ONLY'},command,requestDigest:'d'.repeat(64),preparation,createdAt:'2035-01-02T15:00:00Z',state:'prepared',dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
 const current={quote,balance:projectBalanceV2(quote,[]),receiptId:null};
 const store={readBalanceV2:vi.fn<FishingBillingCardOwnerDeps['store']['readBalanceV2']>().mockImplementation(async()=>current)};
 const cards={prepare:vi.fn<FishingBillingCardOwnerDeps['cards']['prepare']>().mockResolvedValue(preparation),readAttempt:vi.fn<FishingBillingCardOwnerDeps['cards']['readAttempt']>().mockImplementation(async()=>attempt),readPreparationReceipt:vi.fn<FishingBillingCardOwnerDeps['cards']['readPreparationReceipt']>().mockResolvedValue(preparation),createCheckout:vi.fn<FishingBillingCardOwnerDeps['cards']['createCheckout']>().mockImplementation(async()=>attempt)};
 const d:FishingBillingCardOwnerDeps={origin,actor:vi.fn(async()=>actor),csrf:()=>csrf,limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:0}))},rateLimitKey:'e'.repeat(32),store,cards};
 const headers={host:'fishing-card-owner.invalid','x-forwarded-host':'fishing-card-owner.invalid','x-forwarded-proto':'https',cookie:SESSION_COOKIE+'='+token};
 const get=(kind='attempt')=>new Request(origin+FISHING_BILLING_CARD_OWNER_PATH+'?kind='+kind+'&quoteId='+quote.id+'&id='+attempt.id,{headers});
 const post=(action='prepare')=>new Request(origin+FISHING_BILLING_CARD_OWNER_PATH,{method:'POST',headers:{...headers,origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(action==='prepare'?{action,command}:{action,command:{quoteId:quote.id,attemptId:attempt.id}})});
 const run=(r:Request)=>fishingBillingCardOwnerHttp(r,async()=>d);
 return {quote,command,preparation,attempt,current,store,cards,d,get,post,run};
}

describe('unmounted owner-only card transport',()=>{
 it('prepares with original operation receipt and fresh authorized current balance',async()=>{
  const f=setup(),response=await f.run(f.post()),body=await response.json();expect(response.status).toBe(200);expect(body.data).toMatchObject({state:'prepared',receipt:{operationId:f.attempt.id},current:{quote:{revision:4}},checkoutUrl:null});expect('checkoutUrl' in body.data.attempt).toBe(false);expect(f.cards.createCheckout).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 });
 it('GET never creates or dispatches Checkout',async()=>{
  const f=setup();await expect(f.run(f.get()).then(r=>r.status)).resolves.toBe(200);expect(f.cards.prepare).not.toHaveBeenCalled();expect(f.cards.createCheckout).not.toHaveBeenCalled();
 });
 it('an absent original preparation remains unresolved instead of failed',async()=>{
  const f=setup();f.cards.readPreparationReceipt.mockResolvedValueOnce(null);const body=await (await f.run(f.get('operation'))).json();expect(body.data).toMatchObject({state:'unresolved',operationId:f.attempt.id});expect(f.cards.readAttempt).not.toHaveBeenCalled();expect(f.store.readBalanceV2).not.toHaveBeenCalled();
 });
 it('returns a current open link only after fresh balance, keeping native history URL separate',async()=>{
  const f=setup();f.attempt.state='open';f.attempt.sessionId='cs_test_SYNTHETIC';f.attempt.checkoutUrl='https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC';
  const body=await (await f.run(f.get())).json();expect(body.data.checkoutUrl).toBe(f.attempt.checkoutUrl);expect('checkoutUrl' in body.data.attempt).toBe(false);
 });
 it('a newer paid balance suppresses an old Checkout link without changing its immutable attempt',async()=>{
  const f=setup();f.attempt.state='open';f.attempt.checkoutUrl='https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC';f.quote.revision=5;f.current.balance=projectBalanceV2(f.quote,[syntheticReceipt('cash',10,65000,700),syntheticReceipt('cash',11,65000,701)]);
  const body=await (await f.run(f.get())).json();expect(body.data.checkoutUrl).toBeNull();expect(body.data.current.balance.remainingMinor).toBe(0);expect(f.attempt.checkoutUrl).not.toBeNull();
 });
 it('a durable unknown attempt is explicit and never becomes a payment confirmation',async()=>{
  const f=setup();f.attempt.state='unknown';f.attempt.dispatchId=syntheticId(802);const body=await (await f.run(f.post('create_checkout'))).json();expect(body.data).toMatchObject({state:'attempt',attempt:{state:'unknown'},checkoutUrl:null});expect(body.data.current.balance.paidMinor).toBe(0);expect(f.cards.createCheckout).toHaveBeenCalledTimes(1);
 });
 it.each(['FORBIDDEN','NOT_FOUND','CONFLICT'] as const)('post-dispatch %s is uncertainty, never definitive failure',async code=>{
  const f=setup();f.cards.createCheckout.mockRejectedValueOnce(new AppError(code));const response=await f.run(f.post('create_checkout'));expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});
 });
 it.each(['FORBIDDEN','NOT_FOUND'] as const)('known preparation then %s current-read failure withholds receipt',async code=>{
  const f=setup();f.store.readBalanceV2.mockRejectedValueOnce(new AppError(code));const response=await f.run(f.post()),body=await response.json();expect(response.status).toBe(503);expect(body.data).toBeUndefined();expect(body.error.code).toBe('UNAVAILABLE');
 });
 it('operation recovery also requires fresh current authorization',async()=>{
  const f=setup();f.cards.readAttempt.mockRejectedValueOnce(new AppError('FORBIDDEN'));const response=await f.run(f.get('operation'));expect(response.status).toBe(503);expect((await response.json()).data).toBeUndefined();
 });
 it.each(['parent','revoked','duplicate_cookie','missing_cookie'] as const)('%s denies before native work',async kind=>{
  const f=setup(),request=f.post();if(kind==='parent')f.d.actor=async()=>({...actor,role:'parent'});else if(kind==='revoked')f.d.actor=async()=>{throw new AppError('UNAUTHENTICATED');};else request.headers.set('cookie',kind==='missing_cookie'?'':SESSION_COOKIE+'='+token+'; '+SESSION_COOKIE+'='+token);
  expect((await f.run(request)).status).toBe(kind==='parent'?403:401);expect(f.cards.prepare).not.toHaveBeenCalled();expect(f.cards.createCheckout).not.toHaveBeenCalled();
 });
 it.each(['origin','csrf'] as const)('bad %s denies before preparation',async kind=>{
  const f=setup(),request=f.post();request.headers.set(kind==='origin'?'origin':'x-csrf-token',kind==='origin'?'https://other.invalid':'z'.repeat(43));expect((await f.run(request)).status).toBe(403);expect(f.cards.prepare).not.toHaveBeenCalled();
 });
 it('caller workspace/actor claims are not accepted by the command',async()=>{
  const f=setup(),base=f.post();const request=new Request(base,{body:JSON.stringify({action:'prepare',command:{...f.command,workspaceId:syntheticId(900)}})});expect((await f.run(request)).status).toBe(400);expect(f.cards.prepare).not.toHaveBeenCalled();
 });
 it('wrong-family current readback is withheld',async()=>{
  const f=setup();f.current.quote={...f.quote,familyId:syntheticId(901)};const response=await f.run(f.get());expect(response.status).toBe(503);expect((await response.json()).data).toBeUndefined();
 });
 it('unsafe stored Checkout origin cannot leak into an action link',async()=>{
  const f=setup();f.attempt.state='open';f.attempt.checkoutUrl='https://other.invalid/private';const response=await f.run(f.get());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('other.invalid');
 });
 it('duplicate query parameters and absent durable limiter fail closed',async()=>{
  const f=setup(),r=f.get();const duplicate=new Request(r.url+'&id='+f.attempt.id,r);expect((await f.run(duplicate)).status).toBe(400);expect(f.cards.readAttempt).not.toHaveBeenCalled();
  const g=setup();g.d.limits.consume=async()=>{throw new AppError('UNAVAILABLE');};expect((await g.run(g.post())).status).toBe(503);expect(g.cards.prepare).not.toHaveBeenCalled();
 });
});
