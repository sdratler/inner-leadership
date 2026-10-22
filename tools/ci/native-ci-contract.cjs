'use strict';
// Test orchestration only. This contract grants no application/runtime authority.
const {createHash}=require('node:crypto');
const {resolve,dirname,basename,isAbsolute}=require('node:path');
const VERSION='JLFA-NATIVE-CI-20261022-01';
const ADMIN_URL='postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_ci_test';
const MIGRATION_URL='postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error('NATIVE_CI_'+code);};
function sourceDigest(inputs){return sha(JSON.stringify(inputs.map(({path,sha256})=>[path,sha256])));}
function validateInventory(inventory,actualFiles){
 if(inventory.version!==VERSION||!Array.isArray(inventory.sources)||!Array.isArray(inventory.suites))fail('INVENTORY');
 const sources=inventory.sources.map(x=>x.path);
 if(new Set(sources).size!==sources.length||sources.some(p=>!p||p.split('/').some(s=>s==='..'||s==='.'||s==='')||p.includes('\\')||isAbsolute(p))||inventory.sources.some(x=>!/^[a-f0-9]{64}$/.test(x.sha256))||sourceDigest(inventory.sources)!==inventory.sourceBundleSha256)fail('SOURCE_INVENTORY');
 const expected=inventory.suites.map(x=>x.path),actual=[...actualFiles].sort();
 if(new Set(expected).size!==expected.length||JSON.stringify([...expected].sort())!==JSON.stringify(actual)||expected.length!==127||inventory.suites.filter(x=>x.profile==='ordinary').length!==80)fail('SUITE_INVENTORY');
 const profiles=new Set(['ordinary','payment','stage','stageCredit','base','program']);
 if(inventory.suites.some(x=>!profiles.has(x.profile)||!/^tests\/database\/.+\.test\.ts$/.test(x.path)||!inventory.sources.some(s=>s.path==='apps/life-skills/'+x.path)))fail('SUITE_PROFILE');
 return inventory;
}
function parseTarget(env,inventory){
 if(env.LS_NATIVE_CI_ADMISSION===undefined&&env.LS_NATIVE_CI_TARGET===undefined)return null;
 if(env.LS_NATIVE_CI_ADMISSION!==VERSION||env.CI!=='true'||env.LS_APP_MODE!=='foundation_locked'||env.LS_DATABASE_TLS!=='disable'||env.LS_DATABASE_URL!==ADMIN_URL||env.LS_MIGRATION_DATABASE_URL!==MIGRATION_URL||env.LS_TEST_DATABASE_URL!==ADMIN_URL||env.DATABASE_URL)fail('PROCESS_BOUNDARY');
 if(['BUFFER_API_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY'].some(k=>env[k]))fail('PROVIDER_CREDENTIAL');
 let t;try{t=JSON.parse(env.LS_NATIVE_CI_TARGET);}catch{fail('TARGET_RECORD');}
 const keys=['version','suite','profile','database','role','nonceSha256','sourceBundleSha256','serverAddress','serverPort','clientAddress','artifactDirectory','roleOid','databaseOid','preparedCatalogSha256'];
 if(!t||Object.keys(t).sort().join()!==keys.sort().join()||t.version!==VERSION||t.sourceBundleSha256!==inventory.sourceBundleSha256||!/^ls_native_ci_[a-f0-9]{32}_test$/.test(t.database)||t.role!==t.database.slice(0,-5)||!/^\d+$/.test(t.roleOid)||!/^\d+$/.test(t.databaseOid)||!/^\d+\.\d+\.\d+\.\d+$/.test(t.serverAddress)||!/^\d+\.\d+\.\d+\.\d+$/.test(t.clientAddress)||t.serverPort!==5432||!/^[a-f0-9]{64}$/.test(t.preparedCatalogSha256))fail('TARGET_RECORD');
 if(!/^[a-f0-9]{64}$/.test(env.LS_NATIVE_CI_NONCE||'')||sha(env.LS_NATIVE_CI_NONCE)!==t.nonceSha256)fail('OWNERSHIP_NONCE');
 ipv4(t.serverAddress);ipv4(t.clientAddress);
 const suite=inventory.suites.find(x=>x.path===t.suite);
 if(!suite||suite.profile==='ordinary'||suite.profile!==t.profile)fail('SUITE_TARGET');
 let u;try{u=new URL(env.TEST_DATABASE_URL);}catch{fail('TARGET_URL');}
 if(u.protocol!=='postgresql:'||u.hostname!=='127.0.0.1'||u.port!=='5432'||u.pathname!=='/'+t.database||decodeURIComponent(u.username)!==t.role||!u.password||u.search||u.hash)fail('TARGET_URL');
 const root=env.LS_NATIVE_CI_ARTIFACT_ROOT;
 if(!root||!isAbsolute(root)||!/^ls-native-ci-[a-f0-9]{32}$/.test(basename(root))||!isAbsolute(t.artifactDirectory)||dirname(resolve(t.artifactDirectory))!==resolve(root)||basename(t.artifactDirectory)!==t.role.slice('ls_native_ci_'.length))fail('ARTIFACT_ROOT');
 return {...t,url:u.href};
}
function marker(t){const {url,...record}=t;void url;return JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a],[b])=>a.localeCompare(b))));}
async function verifyOwnedTarget(connection,t){
 const {rows}=await connection.query("SELECT d.oid::text AS database_oid,d.datname AS database,pg_get_userbyid(d.datdba) AS database_owner,current_user::text AS role,r.oid::text AS role_oid,r.rolsuper,r.rolcreatedb,r.rolcanlogin,shobj_description(d.oid,'pg_database') AS database_marker,shobj_description(r.oid,'pg_authid') AS role_marker,host(inet_server_addr()) AS server_address,inet_server_port() AS server_port,host(inet_client_addr()) AS client_address FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()");
 const r=rows[0];
 if(rows.length!==1||!r||r.database!==t.database||r.database_owner!==t.role||r.role!==t.role||String(r.database_oid)!==t.databaseOid||String(r.role_oid)!==t.roleOid||r.rolsuper!==false||r.rolcreatedb!==false||r.rolcanlogin!==true||r.server_address!==t.serverAddress||r.client_address!==t.clientAddress||r.server_port!==t.serverPort||r.database_marker!==marker(t)||r.role_marker!==marker(t))fail('ACTUAL_OWNED_TARGET');
 const privileges=(await connection.query('SELECT rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(!privileges||privileges.rolcreaterole!==(t.suite==='tests/database/fishing/academy-schema-preflight.native.test.ts')||privileges.rolreplication!==false||privileges.rolbypassrls!==false||privileges.rolinherit!==true)fail('ACTUAL_ROLE_PRIVILEGES');
}
async function catalogDigest(connection){
 const {rows}=await connection.query(`SELECT kind,name,definition FROM (
 SELECT 'schema' AS kind,nspname AS name,pg_get_userbyid(nspowner)||':'||coalesce(nspacl::text,'') AS definition FROM pg_namespace WHERE nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')
 UNION ALL SELECT 'relation',n.nspname||'.'||c.relname,c.relkind::text||':'||pg_get_userbyid(c.relowner)||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||c.relreplident::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')
 UNION ALL SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attname,a.attnum::text||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')
 UNION ALL SELECT 'constraint',n.nspname||'.'||c.conname,pg_get_constraintdef(c.oid,false)||':'||c.convalidated::text||':'||c.condeferrable::text||':'||c.condeferred::text FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')
 UNION ALL SELECT 'index',n.nspname||'.'||c.relname,pg_get_indexdef(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='i' AND n.nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')
 UNION ALL SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,false)||':'||t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')
 UNION ALL SELECT 'policy',n.nspname||'.'||c.relname||'.'||p.polname,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')
 UNION ALL SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,'') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')
 ) s ORDER BY kind,name,definition`);
 return sha(JSON.stringify(rows));
}
function ipv4(s){const a=String(s).split('.');if(a.length!==4||a.some(x=>!/^\d+$/.test(x)||Number(x)>255))fail('HBA_ADDRESS');return a.reduce((n,x)=>(n<<8)|Number(x),0)>>>0;}
function hbaUsesScram(rules,identity){
 for(const r of rules){
  if(r.error)fail('HBA_PARSE');
  if(!['host','hostnossl'].includes(r.type))continue;
  // An IPv6-only rule cannot match the measured IPv4 client.
  if(r.address&&require('node:net').isIP(r.address)===6)continue;
  const matches=(xs,value)=>xs.includes('all')||xs.includes(value);
  if(!matches(r.database,identity.database)||!matches(r.user_name,identity.role)){
   if([...r.database,...r.user_name].some(x=>x.startsWith('+')||x.startsWith('/')))fail('HBA_UNSUPPORTED');
   continue;
  }
  const address=r.address==='all'||((ipv4(r.address)&ipv4(r.netmask))>>>0)===((ipv4(identity.clientAddress)&ipv4(r.netmask))>>>0);
  if(address)return r.auth_method==='scram-sha-256';
 }
 return false;
}
function accountReports(expected,reports){
 const seen=new Set();let passed=0,failed=0,skipped=0;
 for(const report of reports){
  if(!Array.isArray(report.testResults))fail('RESULT_REPORT');
  for(const file of report.testResults){
   const name=file.name.replaceAll('\\','/'),path=name.slice(name.indexOf('/tests/database/')+1);
   if(!expected.includes(path)||seen.has(path))fail('RESULT_SUITE');seen.add(path);
   if(!Array.isArray(file.assertionResults)||file.assertionResults.length===0)fail('ZERO_ASSERTIONS');
   for(const a of file.assertionResults){if(a.status==='passed')passed++;else if(a.status==='failed')failed++;else skipped++;}
  }
 }
 if(seen.size!==expected.length)fail('MISSING_SUITES');
 return {files:seen.size,passed,failed,skipped,accepted:failed===0&&skipped===0&&passed>0};
}
module.exports={VERSION,ADMIN_URL,MIGRATION_URL,sha,sourceDigest,validateInventory,parseTarget,marker,verifyOwnedTarget,catalogDigest,hbaUsesScram,accountReports};
