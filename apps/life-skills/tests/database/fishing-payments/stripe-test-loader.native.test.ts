import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import Stripe from 'stripe';
const redirect=vi.hoisted(()=>({url:'',ca:'',pools:[] as Array<{end():Promise<void>;ended?:boolean}>}));
vi.mock('server-only',()=>({}));
vi.mock('pg',async original=>{
 const actual=await original<typeof import('pg')>();
 class Pool extends actual.Pool {
  constructor(options:import('pg').PoolConfig){
   const url=new URL(options.connectionString!);
   if(url.hostname!=='postgres.railway.internal'||url.port!=='5432'||url.pathname!=='/railway'||url.username!=='ls_stripe_test_receiver'||typeof options.ssl!=='object'||options.ssl.rejectUnauthorized!==true||options.ssl.ca!==redirect.ca)throw Error('FIXTURE_REDIRECTION_NOT_BOUND');
   const local=new URL(redirect.url);url.hostname=local.hostname;url.port=local.port;
   super({...options,connectionString:url.toString(),ssl:{...options.ssl,servername:'postgres.railway.internal'}});redirect.pools.push(this);
  }
 }
 return {...actual,Pool,default:{...actual.default,Pool}};
});
const admitted=process.env.LS_STRIPE_LOADER_NATIVE_ALLOW==='PAY_SCOPED',native=test.skipIf(!admitted);
const ACCOUNT='acct_SYNTHETIC_LOADER_FIXTURE',SECRET='whsec_SYNTHETIC_LOADER_NO_PROVIDER_ACCESS',ORIGIN='https://stripe-loader.example.invalid';
let admin:import('pg').Client,receipt:Record<string,unknown>,operator:string,sql:string,rolePassword:string;
const req=createRequire(import.meta.url),realPg=req('pg') as typeof import('pg');
const target={RAILWAY_PROJECT_ID:'3b756632-1f66-4f75-a016-eabc37aa0d67',RAILWAY_ENVIRONMENT_ID:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',RAILWAY_SERVICE_ID:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',LIFE_SKILLS_RELEASE_COMMIT:'15804281bb6d968a3860f7b271d3cef75c0c11e1'};
const sqlSha256='07f4099abc0c5d1c89e1a4d6a134c7c8580cd2d503d57af2fb95ebacd29afdf9',migrationLedgerSha256='1d5a9a553a01cdb5f7dcb2aa407ee90881a425ab424d9b9e152800672f448865';
let env:Record<string,string>;
function rewrite(options:import('pg').ClientConfig){
 const url=new URL(options.connectionString!);if(url.hostname!=='postgres.railway.internal'||url.port!=='5432'||url.pathname!=='/railway'||url.username!=='postgres'||typeof options.ssl!=='object'||options.ssl.rejectUnauthorized!==true||options.ssl.ca!==redirect.ca)throw Error('OPERATOR_FIXTURE_REDIRECTION_NOT_BOUND');
 const local=new URL(redirect.url);url.hostname=local.hostname;url.port=local.port;
 return {...options,connectionString:url.toString(),ssl:{...options.ssl,servername:'postgres.railway.internal'}};
}
async function install(overrides:Record<string,unknown>={}){
 let result:Record<string,unknown>|undefined;let connections=0;
 class Client extends realPg.Client {constructor(options:import('pg').ClientConfig){super(rewrite(options));connections++;}}
 const context={__stripeSetupInput:{accountId:ACCOUNT,password:rolePassword,runId:randomUUID(),sql,sqlSha256,migrationLedgerSha256,...overrides},process:{env,exitCode:0},console:{log(value:string){result=JSON.parse(value);}},URL,Buffer,require:(name:string)=>name==='pg'?{Client}:req(name)};
 await vm.runInNewContext(operator,context,{timeout:1000});if(!result)throw Error('MISSING_OPERATOR_RECEIPT');
 return {result,connections};
}
const network=vi.fn(async(input:RequestInfo|URL)=>{
 const path=new URL(String(input)).pathname;
 if(path==='/v1/account')return new Response(JSON.stringify({object:'account',id:ACCOUNT}),{headers:{'content-type':'application/json'}});
 if(path==='/v1/balance')return new Response(JSON.stringify({object:'balance',livemode:false}),{headers:{'content-type':'application/json'}});
 throw Error('SYNTHETIC_LOADER_PROVIDER_ACCESS_DENIED');
});
beforeAll(async()=>{
 if(!admitted)return;
 redirect.url=process.env.LS_STRIPE_LOADER_FIXTURE_URL??'';redirect.ca=process.env.LS_STRIPE_LOADER_FIXTURE_CA??'';rolePassword=process.env.LS_STRIPE_LOADER_ROLE_PASSWORD??'';
 const local=new URL(redirect.url);if(local.hostname!=='127.0.0.1'||local.pathname!=='/railway'||local.username!=='postgres'||!local.password||!local.port||local.search||local.hash||!redirect.ca.includes('BEGIN CERTIFICATE')||!/^[a-f0-9]{64}$/.test(rolePassword))throw Error('OWNED_TLS_FIXTURE_REQUIRED');
 operator=await readFile(process.env.LS_STRIPE_LOADER_OPERATOR_SOURCE!,'utf8');sql=await readFile(new URL('../../../src/features/fishing-payments/stripe-test-inbox.sql',import.meta.url),'utf8');
 admin=new realPg.Client({connectionString:redirect.url,ssl:{rejectUnauthorized:true,ca:redirect.ca,servername:'postgres.railway.internal'}});await admin.connect();
 expect((await admin.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl).toBe(true);
 const remote=new URL(redirect.url);remote.hostname='postgres.railway.internal';remote.port='5432';
 env={...target,LS_DATABASE_URL:remote.toString(),LS_DATABASE_TLS:'verify-full',LS_DATABASE_CA:redirect.ca};
 const installed=await install();receipt=installed.result;expect(installed.connections).toBe(1);
 remote.username='ls_stripe_test_receiver';remote.password=rolePassword;
 for(const [key,value]of Object.entries({...env,LS_STRIPE_TEST_DATABASE_URL:remote.toString(),LS_STRIPE_TEST_API_KEY:'rk_test_SYNTHETIC_LOADER_NO_PROVIDER_ACCESS',LS_STRIPE_TEST_WEBHOOK_SECRET:SECRET,LS_STRIPE_TEST_ACCOUNT_ID:ACCOUNT,LS_STRIPE_TEST_ADMISSION_ID:'SYNTHETIC_LOADER_ONLY',LS_STRIPE_TEST_WEBHOOK_ORIGIN:ORIGIN,LS_APP_ORIGIN:ORIGIN,LS_APP_MODE:'isolated_preview',LS_STRIPE_TEST_WEBHOOK_ENABLED:'true',LS_STRIPE_TEST_RUNTIME_ADMITTED:'true'}))vi.stubEnv(key,value);
 vi.stubGlobal('fetch',network);
});
afterAll(async()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();for(const pool of redirect.pools)if(!pool.ended)await pool.end();await admin?.end();});
native('exact operator installs the inbox and restricted role over real verified TLS without changing general migration history',async()=>{
 expect(receipt.status).toBe('STRIPE_INBOX_INSTALL_COMMITTED');expect(receipt.migrationCount).toBe(52);expect(receipt.migrationLedgerSha256).toBe(migrationLedgerSha256);expect(receipt.existingRolesChanged).toBe(false);expect(receipt.otherSchemasChanged).toBe(false);
 expect(receipt.privilege).toEqual({rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false,database_create:false,schema_create:false,can_read:true,can_insert:true,can_update:false,can_delete:false,can_truncate:false,core_usage:false});
});
native('full default runtime loader verifies actual PostgreSQL schema, policy and restricted role before committing a signed synthetic receipt',async()=>{
 const policy=(await admin.query("SELECT pg_get_expr(polqual,polrelid) AS using FROM pg_policy WHERE polrelid='ls_fishing_payments.inbox'::regclass")).rows[0];expect(policy.using).toContain('livemode = false');
 // PostgreSQL name[] has no built-in pg decoder. The loader must explicitly
 // request text[] for both primary-key names and role names, without relaxing
 // its exact ordered key / one-role policy checks.
 const {handleStripeTestWebhook}=await import('../../../src/features/fishing-payments/stripe-test-runtime.ts');
 const now=Math.floor(Date.now()/1000),id='evt_'+randomUUID().replaceAll('-',''),raw=JSON.stringify({id,object:'event',type:'invoice.paid',livemode:false,api_version:'2026-09-30.endive',created:now-10,data:{object:{id:'in_SYNTHETIC_LOADER',object:'invoice',private:'NOT_STORED'}}});
 const signature=Stripe.webhooks.generateTestHeaderString({payload:raw,secret:SECRET,timestamp:now});
 const send=()=>handleStripeTestWebhook(new Request(ORIGIN+'/api/webhooks/stripe/test',{method:'POST',headers:{host:new URL(ORIGIN).host,'x-forwarded-proto':'https','content-type':'application/json','stripe-signature':signature},body:raw}));
 expect((await send()).status).toBe(200);expect((await send()).status).toBe(200);
 const rows=(await admin.query('SELECT receipt_json FROM ls_fishing_payments.inbox WHERE event_id=$1',[id])).rows;
 expect(rows).toHaveLength(1);expect(Object.keys(rows[0].receipt_json)).toHaveLength(8);expect(JSON.stringify(rows)).not.toContain('NOT_STORED');expect(network).toHaveBeenCalledTimes(2);
});
native('replaying an installer against existing storage refuses without repairing or replacing it',async()=>{
 const before=(await admin.query('SELECT count(*)::int AS n FROM ls_fishing_payments.inbox')).rows;
 const replay=await install();expect(replay.result.status).toBe('STRIPE_INBOX_INSTALL_FAILED');expect(replay.result.code).toBe('STRIPE_TARGET_ALREADY_EXISTS_NO_REPAIR');
 expect((await admin.query('SELECT count(*)::int AS n FROM ls_fishing_payments.inbox')).rows).toEqual(before);
});
native('an unbound SQL input is rejected before opening a database connection',async()=>{
 const rejected=await install({sqlSha256:'0'.repeat(64)});expect(rejected.result.code).toBe('INPUT_NOT_BOUND');expect(rejected.connections).toBe(0);
});
native('runtime refuses a broadened row policy even when it contains the expected merchant and test-mode clauses',async()=>{
 try{
  await admin.query(`ALTER POLICY stripe_test_receiver ON ls_fishing_payments.inbox USING ((provider_account_id='${ACCOUNT}' AND livemode=false) OR true)`);
  vi.resetModules();const {loadStripeTestRuntime}=await import('../../../src/features/fishing-payments/stripe-test-server.ts');
  await expect(loadStripeTestRuntime()).rejects.toThrow('STRIPE_TEST_RUNTIME_UNAVAILABLE');
 }finally{await admin.query(`ALTER POLICY stripe_test_receiver ON ls_fishing_payments.inbox USING (provider_account_id='${ACCOUNT}' AND livemode=false)`);}
});
