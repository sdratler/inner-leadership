import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {verifyStripeTestAccount} from '../../../src/features/fishing-payments/stripe-test-provider.ts';
const KEY='rk_test_SYNTHETIC_SETUP_NO_PROVIDER_ACCESS',ACCOUNT='acct_SYNTHETIC_SETUP';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
function transport(changes:{account?:string;live?:boolean;status?:number}={}){
 const fetch=vi.fn<typeof globalThis.fetch>(async input=>{
  const path=new URL(String(input)).pathname;
  return new Response(JSON.stringify(path==='/v1/account'?{object:'account',id:changes.account??ACCOUNT}:{object:'balance',livemode:changes.live??false,available:[],pending:[]}),{status:changes.status??200,headers:{'content-type':'application/json'}});
 });vi.stubGlobal('fetch',fetch);return fetch;
}
test('actual SDK verifies selected account and independently verifies test mode using only two bounded GETs',async()=>{
 const fetch=transport();expect(await verifyStripeTestAccount(KEY,ACCOUNT)).toEqual({accountId:ACCOUNT,livemode:false,apiVersion:'2026-09-30.endive'});
 expect(fetch.mock.calls.map(([input])=>new URL(String(input)).pathname)).toEqual(['/v1/account','/v1/balance']);
 for(const [input,init]of fetch.mock.calls){expect(new URL(String(input)).origin).toBe('https://api.stripe.com');expect(init?.method).toBe('GET');expect(init?.redirect).toBe('error');expect(init?.credentials).toBe('omit');expect(init?.body).toBeUndefined();}
});
test.each(['sk_live_SYNTHETIC_NOT_ALLOWED','rk_live_SYNTHETIC_NOT_ALLOWED','pk_test_SYNTHETIC_NOT_ALLOWED',''])('unusable credential %s never dispatches',async key=>{
 const fetch=transport();await expect(verifyStripeTestAccount(key,ACCOUNT)).rejects.toThrow('STRIPE_TEST_ACCOUNT_UNAVAILABLE');expect(fetch).not.toHaveBeenCalled();
});
test('different returned account denies before balance call',async()=>{
 const fetch=transport({account:'acct_OTHER_SYNTHETIC'});await expect(verifyStripeTestAccount(KEY,ACCOUNT)).rejects.toThrow('STRIPE_TEST_ACCOUNT_UNAVAILABLE');expect(fetch).toHaveBeenCalledTimes(1);
});
test('a test-looking key never overrides a live balance response',async()=>{
 const fetch=transport({live:true});await expect(verifyStripeTestAccount(KEY,ACCOUNT)).rejects.toThrow('STRIPE_TEST_ACCOUNT_UNAVAILABLE');expect(fetch).toHaveBeenCalledTimes(2);
});
test.each([301,401,403,429,500])('provider status %s fails closed without retries',async status=>{
 const fetch=transport({status});await expect(verifyStripeTestAccount(KEY,ACCOUNT)).rejects.toThrow('STRIPE_TEST_ACCOUNT_UNAVAILABLE');expect(fetch).toHaveBeenCalledTimes(1);
});
test('upstream cause and body are never exposed',async()=>{
 const fetch=vi.fn(async()=>{throw new Error('PRIVATE_PROVIDER_CANARY');});vi.stubGlobal('fetch',fetch);
 await expect(verifyStripeTestAccount(KEY,ACCOUNT)).rejects.toThrow(/^STRIPE_TEST_ACCOUNT_UNAVAILABLE$/);expect(fetch).toHaveBeenCalledTimes(1);
});
test('stalled fetch has a finite deadline even when it ignores its signal',async()=>{
 vi.useFakeTimers();const fetch=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetch);
 const pending=verifyStripeTestAccount(KEY,ACCOUNT);const assertion=expect(pending).rejects.toThrow(/^STRIPE_TEST_ACCOUNT_UNAVAILABLE$/);
 await vi.advanceTimersByTimeAsync(10001);await assertion;expect(fetch).toHaveBeenCalledTimes(1);
});
