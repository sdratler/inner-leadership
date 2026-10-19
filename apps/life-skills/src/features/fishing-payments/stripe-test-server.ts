import "server-only";
import {createHash} from "node:crypto";
import {Pool} from "pg";
import {StripeTestInbox,type StripeTestDatabase,type StripeTestSql} from "./stripe-test-inbox.ts";
import {stripeTestApiVersion,verifyStripeTestAccount} from "./stripe-test-provider.ts";
import type {StripeTestWebhookRuntime} from "./stripe-test-runtime.ts";

const roleName="ls_stripe_test_receiver",schemaVersion="ls-stripe-test-inbox-v1";
const target={RAILWAY_PROJECT_ID:"3b756632-1f66-4f75-a016-eabc37aa0d67",RAILWAY_ENVIRONMENT_ID:"dd91bd71-57cc-45e6-a75b-8c858491d7c7",RAILWAY_SERVICE_ID:"0267d061-f3ce-4a0a-82d4-ce133e4501e9"};
const fail=()=>new Error("STRIPE_TEST_RUNTIME_UNAVAILABLE");
let cached:Promise<StripeTestWebhookRuntime>|undefined;
export function loadStripeTestRuntime():Promise<StripeTestWebhookRuntime>{
 if(!cached)cached=assemble(process.env).catch(()=>{cached=undefined;throw fail();});return cached;
}
async function assemble(env:Readonly<Record<string,string|undefined>>):Promise<StripeTestWebhookRuntime>{
 let pool:Pool|undefined;
 try{
  for(const [key,value]of Object.entries(target))if(env[key]!==value)throw fail();
  const raw=env.LS_STRIPE_TEST_DATABASE_URL,key=env.LS_STRIPE_TEST_API_KEY,secret=env.LS_STRIPE_TEST_WEBHOOK_SECRET,accountId=env.LS_STRIPE_TEST_ACCOUNT_ID,origin=env.LS_STRIPE_TEST_WEBHOOK_ORIGIN,id=env.LS_STRIPE_TEST_ADMISSION_ID;
  if(!raw||!key||!secret||!accountId||!origin||!id||!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)||!/^whsec_[A-Za-z0-9_]{16,256}$/.test(secret)||env.LS_DATABASE_TLS!=="verify-full"||!env.LS_DATABASE_CA)throw fail();
  const url=new URL(raw);if(!["postgres:","postgresql:"].includes(url.protocol)||url.hostname!=="postgres.railway.internal"||url.port!=="5432"||url.pathname!=="/railway"||decodeURIComponent(url.username)!==roleName||!url.password||url.search||url.hash)throw fail();
  const proof=await verifyStripeTestAccount(key,accountId);
  pool=new Pool({connectionString:raw,ssl:{rejectUnauthorized:true,ca:env.LS_DATABASE_CA},max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:5000,application_name:'stripe-test-receiver-v1'});pool.on("error",()=>{});
  const client=await pool.connect();
  try{
   await client.query("BEGIN READ ONLY");
   const state=(await client.query(`SELECT current_database() AS database,current_user AS role,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
    has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
    has_schema_privilege(current_user,'ls_fishing_payments','USAGE') AS schema_usage,
    has_schema_privilege(current_user,'ls_fishing_payments','CREATE') AS schema_create,
    has_table_privilege(current_user,'ls_fishing_payments.inbox','SELECT') AS can_read,
    has_table_privilege(current_user,'ls_fishing_payments.inbox','INSERT') AS can_insert,
    has_table_privilege(current_user,'ls_fishing_payments.inbox','UPDATE') AS can_update,
    has_table_privilege(current_user,'ls_fishing_payments.inbox','DELETE') AS can_delete,
    c.relrowsecurity,c.relforcerowsecurity,obj_description(c.oid,'pg_class') AS version
    FROM pg_roles r,pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname=current_user AND n.nspname='ls_fishing_payments' AND c.relname='inbox'`)).rows[0];
   if(!state||state.database!=="railway"||state.role!==roleName||state.rolsuper||state.rolcreatedb||state.rolcreaterole||state.rolbypassrls||state.database_create||!state.schema_usage||state.schema_create||!state.can_read||!state.can_insert||state.can_update||state.can_delete||!state.relrowsecurity||!state.relforcerowsecurity||state.version!==schemaVersion)throw fail();
   const columns=(await client.query("SELECT attname AS name,format_type(atttypid,atttypmod) AS type,attnotnull AS required FROM pg_attribute WHERE attrelid='ls_fishing_payments.inbox'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows;
   const expectedColumns=[['provider_account_id','text',true],['livemode','boolean',true],['event_id','text',true],['digest','text',true],['receipt_json','jsonb',true],['received_at','timestamp with time zone',true],['processed_at','timestamp with time zone',false]];
   if(JSON.stringify(columns.map(row=>[row.name,row.type,row.required]))!==JSON.stringify(expectedColumns))throw fail();
   const primary=(await client.query("SELECT ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(num,position) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.num ORDER BY u.position) AS columns FROM pg_constraint k WHERE k.conrelid='ls_fishing_payments.inbox'::regclass AND k.contype='p'")).rows;
   if(primary.length!==1||JSON.stringify(primary[0].columns)!==JSON.stringify(['provider_account_id','livemode','event_id']))throw fail();
   const policy=(await client.query(`SELECT p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid) AS "using",pg_get_expr(p.polwithcheck,p.polrelid) AS "check",
    (SELECT array_agg(rolname ORDER BY rolname) FROM pg_roles WHERE oid=ANY(p.polroles)) AS roles
    FROM pg_policy p WHERE p.polrelid='ls_fishing_payments.inbox'::regclass`)).rows;
   const expected=`provider_account_id = '${accountId}'::text`,matches=(value:unknown)=>typeof value==="string"&&value.includes(expected)&&value.includes("livemode = false");
   if(policy.length!==1||policy[0].polcmd!=="*"||!policy[0].polpermissive||JSON.stringify(policy[0].roles)!==JSON.stringify([roleName])||!matches(policy[0].using)||!matches(policy[0].check))throw fail();
   const elevated=(await client.query("SELECT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS member,EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('ls_identity','ls_payments','ls_calendar','ls_control') AND has_schema_privilege(current_user,oid,'USAGE')) AS core_usage")).rows[0];
   if(elevated?.member||elevated?.core_usage)throw fail();
   await client.query("ROLLBACK");
  }catch{try{await client.query("ROLLBACK");}catch{}throw fail();}finally{client.release();}
  const database=stripeTestPoolDatabase(pool);
  const endpoint={endpoint:"direct" as const,...proof},bindingId="verified-test:"+createHash("sha256").update(JSON.stringify({target,proof,origin,schemaVersion})).digest("hex");
  return Object.freeze({endpoint,merchant:{...proof,verifiedBindingId:bindingId},admission:{id,origin,accountId:proof.accountId,endpoint:"direct",livemode:false,apiVersion:stripeTestApiVersion},inbox:new StripeTestInbox(database,endpoint,secret)});
 }catch{try{await pool?.end();}catch{}throw fail();}
}

/** Uses only the pool capability supplied by the admitted server composition.
 * Exported for exact local native transaction tests; not an HTTP capability. */
export function stripeTestPoolDatabase(pool:Pick<Pool,'connect'>):StripeTestDatabase{
 return {async transaction<T>(work:(tx:StripeTestSql)=>Promise<T>):Promise<T>{
  const tx=await pool.connect();try{await tx.query("BEGIN");await tx.query("SET LOCAL statement_timeout='5s'");
   const result=await work({async query<Q extends Record<string,unknown>>(text:string,values?:readonly unknown[]){return (await tx.query<Q>(text,values?[...values]:undefined)).rows;}});
   await tx.query("COMMIT");return result;
  }catch{try{await tx.query("ROLLBACK");}catch{}throw fail();}finally{tx.release();}
 }};
}
