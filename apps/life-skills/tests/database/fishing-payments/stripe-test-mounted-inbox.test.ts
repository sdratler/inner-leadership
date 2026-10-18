/** PAY1180 AUTHORING ONLY until Root admits exact native execution inputs.
 * In-process route-runtime handler + actual SDK signature + real PG inbox.
 * The server-injected admission, merchant and key are synthetic fixtures.
 * No public server/URL, provider connectivity, allocation or owner readback is
 * proved here. Verifier and acceptStripeTest are never mocked or replaced by
 * acceptSynthetic. Existing PROGRAM guards/schema/bootstrap remain unchanged.
 */
import {createHash,randomUUID} from 'node:crypto';
import Stripe from 'stripe';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {handleStripeTestWebhook,type StripeTestWebhookRuntime} from '../../../src/features/fishing-payments/stripe-test-runtime.ts';
import {FishingPaymentStore} from '../../../src/features/fishing-payments/store.ts';
import {FishingReceiptInbox} from '../../../src/features/fishing-payments/receipts.ts';
import {NativeStripeReceiptBindings} from '../../../src/features/fishing/native-stripe-bindings.ts';
import {StripeSdkTestReadClient} from '../../../src/features/fishing/stripe-sdk-test-read-client.ts';
import type {IdentityStore,SqlSession} from '../../../src/features/identity/store.ts';
import {programFixture,type ProgramFixture} from '../fishing/native-program-fixture.ts';

const ORIGIN='https://stripe-test.example.invalid',PATH='/api/webhooks/stripe/test',API='2026-09-30.endive' as const;
const SECRET='whsec_SYNTHETIC_MOUNT1180_SIGNATURE_ONLY',CANARY='PRIVATE_SYNTHETIC_MOUNT1180_é_😀';
const ENV=Object.freeze({LS_APP_MODE:'isolated_preview',LS_APP_ORIGIN:ORIGIN,LS_STRIPE_TEST_WEBHOOK_ENABLED:'true',LS_STRIPE_TEST_RUNTIME_ADMITTED:'true',LS_STRIPE_TEST_WEBHOOK_ORIGIN:ORIGIN});
const fixtures:ProgramFixture[]=[],noProvider=vi.fn(()=>{throw Error('NO_MOUNT1180_PROVIDER_ACCESS');});
beforeEach(()=>{vi.stubGlobal('fetch',noProvider);});
afterEach(async()=>{
 vi.useRealTimers();try{expect(noProvider).not.toHaveBeenCalled();}finally{vi.restoreAllMocks();vi.unstubAllGlobals();noProvider.mockClear();await Promise.all(fixtures.splice(0).map(f=>f.close()));}
});
function deferred(){let resolve!:()=>void,reject!:(error:unknown)=>void;const promise=new Promise<void>((yes,no)=>{resolve=()=>yes();reject=no;});return {promise,resolve,reject};}
async function fixture(options:{database?:(base:IdentityStore)=>IdentityStore;endpoint?:'direct'|'connected'}={}){
 const f=await programFixture();fixtures.push(f);const now=new Date(),clock={now:()=>new Date(now.getTime())},merchant={...f.merchant,apiVersion:API},endpoint={endpoint:options.endpoint??'direct',accountId:merchant.accountId,livemode:false as const,apiVersion:API};
 const schema=(await f.pool.query("SELECT to_regclass('ls_fishing_payments.inbox') AS inbox,to_regclass('ls_fishing_payments.customer_bindings') AS customers,to_regclass('ls_fishing_payments.object_bindings') AS objects")).rows[0];
 if(!schema?.inbox||!schema.customers||!schema.objects)throw Error('ROOT_MUST_ADMIT_PINNED_RECEIPT_SCHEMA');
 const store=new FishingPaymentStore({database:options.database?.(f.db)??f.db,clock,merchant,authority:f.paymentStore.deps.authority});
 const client=new StripeSdkTestReadClient('rk_test_SYNTHETIC_MOUNT1180_NO_PROVIDER_ACCESS',{...merchant,livemode:false});
 const native=new NativeStripeReceiptBindings(f.db,merchant,clock),inbox=new FishingReceiptInbox(store,{endpoint,endpointSecret:SECRET,client,native});
 const runtime:StripeTestWebhookRuntime={inbox,endpoint,merchant,admission:{id:'SYNTHETIC_MOUNT1180_NOT_REAL_ADMISSION',origin:ORIGIN,accountId:merchant.accountId,endpoint:endpoint.endpoint,livemode:false,apiVersion:API}};
 const reads=vi.spyOn(client,'retrieve'),lists=vi.spyOn(client,'listInvoicePayments'),accept=vi.spyOn(inbox,'acceptStripeTest'),process=vi.spyOn(inbox,'processStripeTest'),synthetic=vi.spyOn(inbox,'acceptSynthetic');
 return {f,now,merchant,endpoint,store,client,inbox,runtime,reads,lists,accept,process,synthetic};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function wire(c:Fixture,eventId='evt_'+randomUUID().replaceAll('-',''),overrides:Record<string,unknown>={}){
 const created=Math.floor(c.now.getTime()/1000),objectId='in_'+randomUUID().replaceAll('-','');
 const event={id:eventId,object:'event',type:'invoice.paid',livemode:false,api_version:API,created:created-60,
  ...(c.endpoint.endpoint==='connected'?{account:c.merchant.accountId}:{}),data:{object:{id:objectId,object:'invoice',private:CANARY}},...overrides};
 const raw=Buffer.from(' \n'+JSON.stringify(event,null,2)+' \n'),signature=Stripe.webhooks.generateTestHeaderString({payload:raw.toString('utf8'),secret:SECRET,timestamp:created});
 return {eventId,objectId,raw,signature};
}
function request(w:ReturnType<typeof wire>,body:BodyInit=w.raw.toString('utf8'),signature=w.signature){
 const init:RequestInit&{duplex:'half'}={method:'POST',headers:{host:new URL(ORIGIN).host,'x-forwarded-proto':'https','content-type':'application/json','stripe-signature':signature},body,duplex:'half'};
 return new Request(ORIGIN+PATH,init);
}
function send(c:Fixture,w:ReturnType<typeof wire>,runtime:StripeTestWebhookRuntime=c.runtime,body?:BodyInit,signature?:string){
 return handleStripeTestWebhook(request(w,body??w.raw.toString('utf8'),signature??w.signature),async()=>runtime,ENV);
}
function rows(c:Fixture,eventId:string){return c.f.pool.query('SELECT digest,receipt_json,processed_at FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=false AND event_id=$2',[c.merchant.accountId,eventId]);}
async function protectedEffects(c:Fixture){
 const tables=['ls_fishing_payments.offers','ls_fishing_payments.purchases','ls_fishing_payments.operations','ls_fishing_payments.commands','ls_fishing_payments.settlements','ls_fishing_payments.outbox','ls_fishing_payments.reminders','ls_fishing_payments.founder_households','ls_fishing_stage.enrollments','ls_fishing_stage.seat_reservations','ls_education.account_grants','ls_calendar.appointments','ls_cases.cases','ls_payments.charges','ls_payments.credit_events','ls_identity.auth_mail_outbox'];
 return Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await c.f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[c.f.workspaceId])).rows])));
}
function noOtherCapability(c:Fixture){expect(c.reads).not.toHaveBeenCalled();expect(c.lists).not.toHaveBeenCalled();expect(c.process).not.toHaveBeenCalled();expect(c.synthetic).not.toHaveBeenCalled();expect(c.f.provider.calls).toBe(0);}

test('mounted handler preserves original UTF-8 bytes through real SDK verification and commits only a minimal receipt',async()=>{
 const c=await fixture(),w=wire(c),before=await protectedEffects(c),sdk=vi.spyOn(Stripe.webhooks,'constructEvent'),cut=w.raw.indexOf(Buffer.from('é'))+1;
 const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(w.raw.subarray(0,cut));controller.enqueue(w.raw.subarray(cut));controller.close();}});
 const response=await send(c,w,c.runtime,body);expect(response.status).toBe(200);expect(await response.json()).toEqual({received:true});expect(sdk).toHaveBeenCalledTimes(1);
 expect(sdk.mock.calls[0]![0]).toEqual(w.raw);expect(sdk.mock.calls[0]![1]).toBe(w.signature);expect(c.accept).toHaveBeenCalledTimes(1);
 const saved=(await rows(c,w.eventId)).rows;expect(saved).toHaveLength(1);expect(saved[0].digest).toBe(createHash('sha256').update(w.raw).digest('hex'));
 expect(Object.keys(saved[0].receipt_json).sort()).toEqual(['eventId','eventType','objectId','providerAccountId','livemode','apiVersion','digest','createdAt'].sort());
 expect(saved[0].receipt_json).toMatchObject({eventId:w.eventId,eventType:'invoice.paid',objectId:w.objectId,providerAccountId:c.merchant.accountId,livemode:false,apiVersion:API});
 expect(saved[0].processed_at).toBeNull();expect(JSON.stringify(saved)).not.toContain(CANARY);expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
});

test('mounted 200 waits for the actual native receipt transaction to commit',async()=>{
 const entered=deferred(),release=deferred();let staged=false;
 const c=await fixture({database:base=>({async transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{return base.transaction(async tx=>{const result=await work(tx);if(!staged){staged=true;entered.resolve();await release.promise;}return result;});}})});
 const w=wire(c),before=await protectedEffects(c);let acknowledged=false;const pending=send(c,w).then(response=>{acknowledged=true;return response;});
 try{
  await Promise.race([entered.promise,pending.then(()=>{throw Error('RESPONSE_BEFORE_NATIVE_STAGE');})]);expect(acknowledged).toBe(false);expect((await rows(c,w.eventId)).rows).toHaveLength(0);
  release.resolve();expect((await pending).status).toBe(200);expect((await rows(c,w.eventId)).rows).toHaveLength(1);expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
 }finally{release.resolve();await pending;}
});

test('same-event sequential and concurrent replay leaves exactly one unprocessed native inbox receipt',async()=>{
 const c=await fixture(),w=wire(c),before=await protectedEffects(c);expect((await send(c,w)).status).toBe(200);const first=(await rows(c,w.eventId)).rows;
 const replies=await Promise.all([send(c,w),send(c,w),send(c,w),send(c,w)]);expect(replies.map(r=>r.status)).toEqual([200,200,200,200]);
 expect((await rows(c,w.eventId)).rows).toEqual(first);expect(first).toHaveLength(1);expect(first[0].processed_at).toBeNull();expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
});

test('a validly signed conflicting event digest returns 503 and preserves the first minimal receipt',async()=>{
 const c=await fixture(),firstWire=wire(c),before=await protectedEffects(c);expect((await send(c,firstWire)).status).toBe(200);const first=(await rows(c,firstWire.eventId)).rows;
 const conflict=wire(c,firstWire.eventId);expect(conflict.raw.equals(firstWire.raw)).toBe(false);const response=await send(c,conflict);
 expect(response.status).toBe(503);expect(await response.json()).toEqual({received:false,error:'UNAVAILABLE'});expect((await rows(c,firstWire.eventId)).rows).toEqual(first);expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
});

test('tampered original bytes or bad SDK signature cannot commit an inbox row',async()=>{
 const c=await fixture(),w=wire(c),before=await protectedEffects(c),tampered=w.raw.toString('utf8').replace('invoice.paid','invoice.payment_failed');
 const badSignature=`t=${Math.floor(c.now.getTime()/1000)},v1=${'0'.repeat(64)}`;
 for(const [body,signature]of [[tampered,w.signature],[w.raw.toString('utf8'),badSignature]]){
  const response=await send(c,w,c.runtime,body!,signature!);expect(response.status).toBe(400);expect(await response.json()).toEqual({received:false,error:'INVALID_REQUEST'});
 }
 expect((await rows(c,w.eventId)).rows).toHaveLength(0);expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
});

test('runtime admission mismatch rejects before SDK/inbox work and leaves native state unchanged',async()=>{
 const c=await fixture(),w=wire(c),before=await protectedEffects(c),sdk=vi.spyOn(Stripe.webhooks,'constructEvent');
 const mismatched:StripeTestWebhookRuntime={...c.runtime,admission:{...c.runtime.admission,accountId:'acct_OTHER_SYNTHETIC'}};
 const response=await send(c,w,mismatched);expect(response.status).toBe(503);expect(await response.json()).toEqual({received:false,error:'UNAVAILABLE'});
 expect(c.accept).not.toHaveBeenCalled();expect(sdk).not.toHaveBeenCalled();expect((await rows(c,w.eventId)).rows).toHaveLength(0);expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
});

test('actual native rollback after receipt work returns fixed 503 without a durable row',async()=>{
 const c=await fixture({database:base=>({async transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{return base.transaction(async tx=>{await work(tx);throw Error('PRIVATE_SYNTHETIC_ROLLBACK1180');});}})});
 const w=wire(c),before=await protectedEffects(c),response=await send(c,w);expect(response.status).toBe(503);expect(await response.json()).toEqual({received:false,error:'UNAVAILABLE'});
 expect(c.accept).toHaveBeenCalledTimes(1);expect((await rows(c,w.eventId)).rows).toHaveLength(0);expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
});

test('simulated acceptance deadline stays UNKNOWN when the real inbox commits later; retry remains idempotent',async()=>{
 const c=await fixture(),w=wire(c),before=await protectedEffects(c),entered=deferred(),release=deferred(),committed=deferred();let invoked=false;
 const delayed:StripeTestWebhookRuntime={...c.runtime,inbox:{async acceptStripeTest(raw,signature){invoked=true;entered.resolve();await release.promise;try{const result=await c.inbox.acceptStripeTest(raw,signature);committed.resolve();return result;}catch(error){committed.reject(error);throw error;}}}};
 // Only the HTTP acceptance deadline is simulated. Native SQL runs after real
 // timers are restored; this is not wall-clock latency or PG commit-delay proof.
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const pending=send(c,w,delayed);
 try{
  await Promise.race([entered.promise,pending.then(()=>{throw Error('RESPONSE_BEFORE_DELAYED_ACCEPT');})]);await vi.advanceTimersByTimeAsync(10001);
  const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toEqual({received:false,error:'UNAVAILABLE'});vi.useRealTimers();
  expect((await rows(c,w.eventId)).rows).toHaveLength(0);release.resolve();await committed.promise;const saved=(await rows(c,w.eventId)).rows;expect(saved).toHaveLength(1);
  expect((await send(c,w)).status).toBe(200);expect((await rows(c,w.eventId)).rows).toEqual(saved);expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
 }finally{vi.useRealTimers();release.resolve();if(invoked)await committed.promise;}
});

test('connected fixture accepts only its matched account, test mode and pinned snapshot API',async()=>{
 const c=await fixture({endpoint:'connected'}),good=wire(c),before=await protectedEffects(c);expect((await send(c,good)).status).toBe(200);
 for(const change of [{account:'acct_OTHER_SYNTHETIC'},{livemode:true},{api_version:'2020-01-01'}]){
  const bad=wire(c,undefined,change),response=await send(c,bad);expect(response.status).toBe(400);expect((await rows(c,bad.eventId)).rows).toHaveLength(0);
 }
 expect((await rows(c,good.eventId)).rows).toHaveLength(1);expect(await protectedEffects(c)).toEqual(before);noOtherCapability(c);
});
