import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import Stripe from 'stripe';
import {afterAll,beforeAll,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {StripeTestInbox,type StripeTestDatabase} from '../../../src/features/fishing-payments/stripe-test-inbox.ts';
import {stripeTestPoolDatabase} from '../../../src/features/fishing-payments/stripe-test-server.ts';
import {handleStripeTestWebhook,type StripeTestWebhookRuntime} from '../../../src/features/fishing-payments/stripe-test-runtime.ts';
const admitted=process.env.LS_STRIPE_INBOX_NATIVE_ALLOW==='PAY_SCOPED',native=test.skipIf(!admitted);
const ACCOUNT='acct_SYNTHETIC_SETUP_DB',SECRET='whsec_SYNTHETIC_SETUP_DB_NO_PROVIDER_ACCESS',ORIGIN='https://stripe-test.example.invalid',PATH='/api/webhooks/stripe/test',API='2026-09-30.endive' as const;
const ENV={LS_APP_MODE:'isolated_preview',LS_APP_ORIGIN:ORIGIN,LS_STRIPE_TEST_WEBHOOK_ORIGIN:ORIGIN,LS_STRIPE_TEST_WEBHOOK_ENABLED:'true',LS_STRIPE_TEST_RUNTIME_ADMITTED:'true'};
let admin:pg.Pool,receiver:pg.Pool,database:StripeTestDatabase;
const noNetwork=vi.fn(()=>{throw Error('NATIVE_SETUP_PROVIDER_ACCESS_DENIED');});
beforeAll(async()=>{
 if(!admitted)return;const url=new URL(process.env.LS_STRIPE_INBOX_TEST_DATABASE_URL??''),password=process.env.LS_STRIPE_INBOX_TEST_ROLE_PASSWORD;
 if(url.hostname!=='127.0.0.1'||!/^\/ls_stripe_inbox_test_[a-f0-9]{32}$/.test(url.pathname)||!url.username||!url.password||!url.port||url.search||url.hash||!password||!/^[a-f0-9]{64}$/.test(password))throw Error('EXACT_LOCAL_STRIPE_TEST_TARGET_REQUIRED');
 admin=new pg.Pool({connectionString:url.toString(),ssl:false,max:4});
 const actual=(await admin.query('SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];
 if(actual.database!==url.pathname.slice(1)||actual.host!=='127.0.0.1'||actual.port!==Number(url.port))throw Error('ACTUAL_STRIPE_TEST_TARGET_MISMATCH');
 await admin.query(await readFile(new URL('../../../src/features/fishing-payments/stripe-test-inbox.sql',import.meta.url),'utf8'));
 await admin.query(`CREATE ROLE ls_stripe_test_receiver LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
 await admin.query('GRANT USAGE ON SCHEMA ls_fishing_payments TO ls_stripe_test_receiver');await admin.query('GRANT SELECT,INSERT ON ls_fishing_payments.inbox TO ls_stripe_test_receiver');
 await admin.query(`CREATE POLICY stripe_test_receiver ON ls_fishing_payments.inbox TO ls_stripe_test_receiver USING(provider_account_id='${ACCOUNT}' AND livemode=false) WITH CHECK(provider_account_id='${ACCOUNT}' AND livemode=false)`);
 await admin.query('CREATE SCHEMA ls_identity');await admin.query("CREATE TABLE ls_identity.private_canary(id integer PRIMARY KEY,secret text NOT NULL)");await admin.query("INSERT INTO ls_identity.private_canary VALUES(1,'SYNTHETIC_PRIVATE_CANARY')");
 url.username='ls_stripe_test_receiver';url.password=password;receiver=new pg.Pool({connectionString:url.toString(),ssl:false,max:6});database=stripeTestPoolDatabase(receiver);vi.stubGlobal('fetch',noNetwork);
});
afterAll(async()=>{try{expect(noNetwork).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();await receiver?.end();await admin?.end();}});
function wire(eventId='evt_'+randomUUID().replaceAll('-',''),changes:Record<string,unknown>={}){
 const now=Math.floor(Date.now()/1000),event={id:eventId,object:'event',type:'invoice.paid',livemode:false,api_version:API,created:now-30,data:{object:{id:'in_'+randomUUID().replaceAll('-',''),object:'invoice',private:'SYNTHETIC_NOT_STORED_é_😀'}},...changes};
 const raw=' \n'+JSON.stringify(event,null,2)+' \n';return {eventId,raw,signature:Stripe.webhooks.generateTestHeaderString({payload:raw,secret:SECRET,timestamp:now})};
}
function runtime(db=database):StripeTestWebhookRuntime{return {inbox:new StripeTestInbox(db,{endpoint:'direct',accountId:ACCOUNT,livemode:false,apiVersion:API},SECRET),endpoint:{endpoint:'direct',accountId:ACCOUNT,livemode:false,apiVersion:API},merchant:{accountId:ACCOUNT,livemode:false,apiVersion:API,verifiedBindingId:'SYNTHETIC_NATIVE_NOT_REAL_ADMISSION'},admission:{id:'SYNTHETIC_NATIVE_NOT_REAL_ADMISSION',origin:ORIGIN,accountId:ACCOUNT,endpoint:'direct',livemode:false,apiVersion:API}};}
function send(w:ReturnType<typeof wire>,r=runtime(),signature=w.signature){return handleStripeTestWebhook(new Request(ORIGIN+PATH,{method:'POST',headers:{host:new URL(ORIGIN).host,'x-forwarded-proto':'https','content-type':'application/json','stripe-signature':signature},body:w.raw}),async()=>r,ENV);}
async function rows(id:string){return (await admin.query('SELECT digest,receipt_json,processed_at FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=false AND event_id=$2',[ACCOUNT,id])).rows;}
native('actual SDK and restricted PostgreSQL connection persist only minimal native inbox receipt before acknowledgement',async()=>{
 const w=wire(),response=await send(w);expect(response.status).toBe(200);expect(await response.json()).toEqual({received:true});const saved=await rows(w.eventId);expect(saved).toHaveLength(1);expect(saved[0].processed_at).toBeNull();expect(Object.keys(saved[0].receipt_json)).toHaveLength(8);expect(JSON.stringify(saved)).not.toContain('SYNTHETIC_NOT_STORED');
});
native('concurrent and sequential same-event retries commit exactly one native receipt',async()=>{
 const w=wire();expect((await send(w)).status).toBe(200);const first=await rows(w.eventId);expect((await Promise.all([send(w),send(w),send(w),send(w)])).map(r=>r.status)).toEqual([200,200,200,200]);expect(await rows(w.eventId)).toEqual(first);
});
native('a signed conflicting digest cannot replace the committed receipt',async()=>{
 const first=wire();expect((await send(first)).status).toBe(200);const saved=await rows(first.eventId),conflict=wire(first.eventId);expect((await send(conflict)).status).toBe(503);expect(await rows(first.eventId)).toEqual(saved);
});
native('invalid cryptographic signature commits no row',async()=>{
 const w=wire();expect((await send(w,runtime(),`t=${Math.floor(Date.now()/1000)},v1=${'0'.repeat(64)}`)).status).toBe(400);expect(await rows(w.eventId)).toHaveLength(0);
});
native('real rollback after inbox work commits no row and returns 503',async()=>{
 const w=wire(),failing:StripeTestDatabase={transaction:work=>database.transaction(async tx=>{await work(tx);throw Error('SYNTHETIC_ROLLBACK');})};expect((await send(w,runtime(failing))).status).toBe(503);expect(await rows(w.eventId)).toHaveLength(0);
});
native('200 is held until the real transaction has committed',async()=>{
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve}),staged=new Promise<void>(resolve=>{entered=resolve});
 const controlled:StripeTestDatabase={transaction:work=>database.transaction(async tx=>{const result=await work(tx);entered();await waiting;return result;})},w=wire();let replied=false;const pending=send(w,runtime(controlled)).then(r=>{replied=true;return r;});
 try{await Promise.race([staged,pending.then(()=>{throw Error('EARLY_RESPONSE');})]);expect(replied).toBe(false);expect(await rows(w.eventId)).toHaveLength(0);release();expect((await pending).status).toBe(200);expect(await rows(w.eventId)).toHaveLength(1);}finally{release();await pending;}
});
native('dedicated role has no superuser, role creation, DB creation or core identity access',async()=>{
 const r=(await receiver.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];expect(r).toEqual({rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false});await expect(receiver.query('SELECT secret FROM ls_identity.private_canary')).rejects.toMatchObject({code:'42501'});
});
native('database row policy rejects another merchant and live-mode rows',async()=>{
 const id='evt_'+randomUUID().replaceAll('-','');for(const [account,live]of [['acct_OTHER_SYNTHETIC',false],[ACCOUNT,true]])await expect(receiver.query("INSERT INTO ls_fishing_payments.inbox VALUES($1,$2,$3,'digest','{}',now(),NULL)",[account,live,id])).rejects.toMatchObject({code:'42501'});expect(await rows(id)).toHaveLength(0);
});
native('ingress role cannot update or delete committed receipts',async()=>{
 const w=wire();expect((await send(w)).status).toBe(200);await expect(receiver.query('DELETE FROM ls_fishing_payments.inbox WHERE event_id=$1',[w.eventId])).rejects.toMatchObject({code:'42501'});await expect(receiver.query('UPDATE ls_fishing_payments.inbox SET processed_at=now() WHERE event_id=$1',[w.eventId])).rejects.toMatchObject({code:'42501'});expect(await rows(w.eventId)).toHaveLength(1);
});
