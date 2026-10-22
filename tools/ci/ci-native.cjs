'use strict';
// Unprivileged proposed-code CI. Only the exact synthetic loopback service is admitted.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomBytes}=require('node:crypto'),{spawn,execFile}=require('node:child_process');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const c=require('./native-ci-contract.cjs');
const root=path.resolve(__dirname,'../..'),app=path.join(root,'apps/life-skills');
const {Pool,Client}=createRequire(path.join(app,'package.json'))('pg');
const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'native-ci-inventory.json'),'utf8'));
const sql={payment:'src/features/fishing-payments/candidate-schema.sql',stage:'src/features/fishing-stage/candidate.sql',program:'src/features/fishing/native-program-schema.sql',stripe:'src/features/fishing/native-stripe-bindings.sql',credit:'src/features/fishing-stage/academy-session-credit-schema.sql',travel:'src/features/fishing/academy-travel-credit.sql',group:'src/features/fishing/academy-group-calendar.sql',publication:'src/features/fishing/academy-group-calendar-publication.sql',fixture:'tests/database/fishing-stage/fixture.sql'};
const profiles={payment:[sql.payment],stage:[sql.stage,sql.fixture],stageCredit:[sql.stage,sql.fixture,sql.credit],base:[sql.payment,sql.stage,sql.program,sql.stripe],program:[sql.payment,sql.stage,sql.program,sql.stripe,sql.credit,sql.travel,sql.group,sql.publication]};
const fail=code=>{throw Error('NATIVE_CI_'+code);};
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const secrets=[];
function safe(value){let text=String(value);for(const secret of secrets)text=text.replaceAll(secret,'[private-synthetic]');return text.replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[database-url]');}
function sources(){
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.test.ts')?[path.relative(app,path.join(dir,e.name)).replaceAll('\\','/')]:[]);
 c.validateInventory(inventory,walk(path.join(app,'tests/database')));
 for(const input of inventory.sources){const p=path.join(root,input.path);if(fs.realpathSync(p)!==path.resolve(p)||fs.lstatSync(p).isSymbolicLink()||c.sha(fs.readFileSync(p))!==input.sha256)fail('RAW_SOURCE_MISMATCH');}
}
function environment(){
 const e=process.env;
 if(e.CI!=='true'||e.LS_APP_MODE!=='foundation_locked'||e.LS_DATABASE_TLS!=='disable'||e.LS_DATABASE_URL!==c.ADMIN_URL||e.LS_MIGRATION_DATABASE_URL!==c.MIGRATION_URL||e.LS_TEST_DATABASE_URL!==c.ADMIN_URL||e.DATABASE_URL||e.TEST_DATABASE_URL||e.LS_NATIVE_CI_TARGET||e.LS_NATIVE_CI_ADMISSION)fail('ENTRY_PROCESS');
 if(Object.entries(e).some(([k,v])=>v&&(/^(BUFFER_|STRIPE_|OPENAI_|RAILWAY_|AWS_|GOOGLE_|DATABASE_URL$)/.test(k)||/^LS_RM_/.test(k))))fail('ENTRY_PROVIDER_OR_PRIVATE_AUTHORITY');
 const clean={};for(const k of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','ComSpec','PATHEXT','TEMP','TMP','TMPDIR','HOME','USERPROFILE'])if(e[k])clean[k]=e[k];
 return {...clean,CI:'true',NEXT_TELEMETRY_DISABLED:'1',LS_APP_MODE:'foundation_locked',LS_APP_ORIGIN:'http://127.0.0.1:3001',LS_DATABASE_TLS:'disable',LS_DATABASE_URL:c.ADMIN_URL,LS_MIGRATION_DATABASE_URL:c.MIGRATION_URL,LS_TEST_DATABASE_URL:c.ADMIN_URL};
}
async function child(args,env,output,timeout=180000){
 return new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,args,{cwd:app,env,stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});let combined='',timedOut=false,termination=Promise.resolve();
  const terminate=()=>{
   if(timedOut)return;timedOut=true;
   termination=new Promise((done,failed)=>{
    if(process.platform==='win32')execFile('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true},error=>error?failed(Error('NATIVE_CI_CHILD_TREE_TEARDOWN_FAILED')):done());
    else{try{process.kill(-p.pid,'SIGKILL');done();}catch(error){if(error.code==='ESRCH')done();else failed(Error('NATIVE_CI_CHILD_TREE_TEARDOWN_FAILED'));}}
   });
   termination.catch(()=>{});
  };
  const timer=setTimeout(terminate,timeout);
  for(const stream of [p.stdout,p.stderr])stream.on('data',b=>{combined+=b.toString();if(combined.length>8*1024*1024)terminate();});
  p.once('error',()=>{clearTimeout(timer);reject(Error('NATIVE_CI_CHILD_START'));});
  p.once('close',async code=>{clearTimeout(timer);fs.writeFileSync(output,safe(combined));try{await termination;if(timedOut)reject(Error('NATIVE_CI_CHILD_TIMEOUT_REQUIRES_RUN_TEARDOWN'));else resolve(code===0);}catch(error){reject(error);}});
 });
}
async function testFiles(files,env,directory){
 const config=path.join(directory,'vitest.config.mts'),report=path.join(directory,'results.json');
 fs.writeFileSync(config,`import original from ${JSON.stringify(pathToFileURL(path.join(app,'vitest.db.config.ts')).href)};\nexport default {...original,root:${JSON.stringify(app)},test:{...original.test,include:${JSON.stringify(files)},reporters:['json'],outputFile:${JSON.stringify(report)}}};\n`);
 const exit=await child([path.join(app,'node_modules/vitest/vitest.mjs'),'run','--config',config],env,path.join(directory,'test.log'),files.length>1?600000:180000);
 const result=JSON.parse(fs.readFileSync(report,'utf8'));
 const accounting=c.accountReports(files,[result]);
 return {exit,accounting,report:result};
}
async function prepare(pool,env,profile,directory){
 if(!await child(['--import','tsx','scripts/migrate.ts'],env,path.join(directory,'migrations.log')))fail('MIGRATIONS');
 const manifest=JSON.parse(fs.readFileSync(path.join(app,'migrations/manifest.json'),'utf8'));
 const history=(await pool.query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;
 if(manifest.length!==55||JSON.stringify(history)!==JSON.stringify(manifest.map(x=>({name:x.name,checksum:x.sha256}))))fail('MIGRATION_LEDGER');
 for(const p of profiles[profile])await pool.query(fs.readFileSync(path.join(app,p),'utf8'));
 const count=Number((await pool.query("SELECT count(*) AS n FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar')")).rows[0].n);
 if((profile==='base'&&count!==32)||(profile==='program'&&count!==54))fail('PREPARED_SCHEMA_TABLES');
}
async function scrubOwned(admin,t){
 const row=(await admin.query("SELECT d.oid::text AS database_oid,d.datname,pg_get_userbyid(d.datdba) AS owner,shobj_description(d.oid,'pg_database') AS db_marker,r.oid::text AS role_oid,shobj_description(r.oid,'pg_authid') AS role_marker FROM pg_database d JOIN pg_roles r ON r.rolname=$2 WHERE d.datname=$1",[t.database,t.role])).rows[0];
 if(!row||row.database_oid!==t.databaseOid||row.owner!==t.role||row.role_oid!==t.roleOid||row.db_marker!==c.marker(t)||row.role_marker!==c.marker(t))fail('CLEANUP_OWNERSHIP');
 await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datid=$1::oid AND pid<>pg_backend_pid()',[t.databaseOid]);
 await admin.query('DROP DATABASE '+quote(t.database));
 const role=(await admin.query("SELECT oid::text AS oid,shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",[t.role])).rows[0];
 if(!role||role.oid!==t.roleOid||role.marker!==c.marker(t))fail('CLEANUP_ROLE_OWNERSHIP');
 await admin.query('DROP ROLE '+quote(t.role));
 if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1 UNION ALL SELECT 1 FROM pg_roles WHERE rolname=$2',[t.database,t.role])).rowCount)fail('CLEANUP_REMAINS');
}
async function assertEnforcementDigest(pool,profile){
 const trigger=(await pool.query("SELECT n.nspname,c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('ls_fishing_stage','ls_fishing_payments','ls_academy_calendar') ORDER BY n.nspname,c.relname,t.tgname LIMIT 1")).rows[0];
 const triggerless=['payment','stage','stageCredit'].includes(profile);
 if(Boolean(trigger)===triggerless)fail('PREPARED_ENFORCEMENT_TRIGGER_INVENTORY');
 let mutation;
 if(trigger)mutation='ALTER TABLE '+quote(trigger.nspname)+'.'+quote(trigger.relname)+' DISABLE TRIGGER '+quote(trigger.tgname);
 else{
  const constraint=(await pool.query("SELECT n.nspname,r.relname,c.conname FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE c.contype='c' AND n.nspname IN ('ls_fishing_stage','ls_fishing_payments') ORDER BY n.nspname,r.relname,c.conname LIMIT 1")).rows[0];
  if(!constraint)fail('PREPARED_ENFORCEMENT_CONSTRAINT');
  mutation='ALTER TABLE '+quote(constraint.nspname)+'.'+quote(constraint.relname)+' DROP CONSTRAINT '+quote(constraint.conname);
 }
 const before=await c.catalogDigest(pool);await pool.query('BEGIN');
 try{await pool.query(mutation);if(await c.catalogDigest(pool)===before)fail('ENFORCEMENT_CHANGE_NOT_DETECTED');}
 finally{await pool.query('ROLLBACK');}
 if(await c.catalogDigest(pool)!==before)fail('ENFORCEMENT_PROBE_RESTORE');
}
async function nativeFile(admin,suite,baseEnv,artifactRoot){
 sources();const hex=randomBytes(16).toString('hex'),role='ls_native_ci_'+hex,database=role+'_test';
 const password=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex'),directory=path.join(artifactRoot,hex);secrets.push(password,nonce);fs.mkdirSync(directory);
 const url=new URL(c.ADMIN_URL);url.username=role;url.password=password;url.pathname='/'+database;
 let pool,t,roleCreated=false,databaseCreated=false,completed=false;
 try{
  const createRole=suite.path==='tests/database/fishing/academy-schema-preflight.native.test.ts';
  await admin.query('CREATE ROLE '+quote(role)+' LOGIN NOSUPERUSER NOCREATEDB '+(createRole?'CREATEROLE':'NOCREATEROLE')+' NOREPLICATION NOBYPASSRLS PASSWORD '+literal(password));roleCreated=true;
  await admin.query('CREATE DATABASE '+quote(database)+' OWNER '+quote(role)+' TEMPLATE template0');databaseCreated=true;
  pool=new Pool({connectionString:url.href,ssl:false,max:1,connectionTimeoutMillis:5000});
  const r=(await pool.query("SELECT d.oid::text AS database_oid,r.oid::text AS role_oid,host(inet_server_addr()) AS server_address,inet_server_port() AS server_port,host(inet_client_addr()) AS client_address FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()")).rows[0];
  t={version:c.VERSION,suite:suite.path,profile:suite.profile,database,role,nonceSha256:c.sha(nonce),sourceBundleSha256:inventory.sourceBundleSha256,serverAddress:r.server_address,serverPort:r.server_port,clientAddress:r.client_address,artifactDirectory:directory,roleOid:r.role_oid,databaseOid:r.database_oid,preparedCatalogSha256:'0'.repeat(64)};
  const mark=async()=>{await admin.query('COMMENT ON DATABASE '+quote(database)+' IS '+literal(c.marker(t)));await admin.query('COMMENT ON ROLE '+quote(role)+' IS '+literal(c.marker(t)));};
  await mark();await c.verifyOwnedTarget(pool,t);
  if(!(await admin.query("SELECT rolpassword LIKE 'SCRAM-SHA-256$%' AS scram FROM pg_authid WHERE rolname=$1",[role])).rows[0]?.scram)fail('SCRAM_VERIFIER');
  const rules=(await admin.query('SELECT * FROM pg_hba_file_rules ORDER BY rule_number')).rows;
  if(!c.hbaUsesScram(rules,t))fail('SCRAM_HBA');
  const bad=new URL(url);bad.password=randomBytes(32).toString('hex');const wrong=new Client({connectionString:bad.href,ssl:false,connectionTimeoutMillis:5000});
  let denied=false;try{await wrong.connect();}catch(error){denied=error.code==='28P01';}finally{await wrong.end().catch(()=>{});}if(!denied)fail('SCRAM_NEGATIVE_PASSWORD');
  await prepare(pool,{...baseEnv,LS_MIGRATION_DATABASE_URL:url.href},suite.profile,directory);
  await assertEnforcementDigest(pool,suite.profile);
  t.preparedCatalogSha256=await c.catalogDigest(pool);await mark();await c.verifyOwnedTarget(pool,t);
  const env={...baseEnv,LS_NATIVE_CI_ADMISSION:c.VERSION,LS_NATIVE_CI_TARGET:JSON.stringify(t),LS_NATIVE_CI_NONCE:nonce,LS_NATIVE_CI_ARTIFACT_ROOT:artifactRoot,TEST_DATABASE_URL:url.href};
  c.parseTarget(env,inventory);
  const result=await testFiles([suite.path],env,directory);sources();completed=true;return result;
 }finally{
  if(pool)await pool.end();
  if(t)await scrubOwned(admin,t);
  else if(roleCreated||databaseCreated)fail('PRE_MARKER_CREATION_FAILURE_REQUIRES_CONTAINER_TEARDOWN');
  process.stdout.write(JSON.stringify({suite:suite.path,executed:completed,ownedCleanup:!!t})+'\n');
 }
}
async function main(){
 const env=environment();sources();
 if(process.platform==='linux'&&Number(process.versions.node.split('.')[0])!==22)fail('CI_NODE_VERSION');
 const artifactRoot=path.join(os.tmpdir(),'ls-native-ci-'+randomBytes(16).toString('hex'));fs.mkdirSync(artifactRoot,{mode:0o700});
 process.stdout.write(JSON.stringify({artifactRoot,sourceBundleSha256:inventory.sourceBundleSha256})+'\n');
 const admin=new Pool({connectionString:c.ADMIN_URL,ssl:false,max:1,connectionTimeoutMillis:5000}),reports=[],failures=[];
 try{
  const identity=(await admin.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version_num')::int AS version,inet_server_port() AS port")).rows[0];
  if(identity.database!=='lifeskills_ci_test'||identity.role!=='synthetic'||identity.port!==5432||(process.platform==='linux'&&(identity.version<170000||identity.version>=180000)))fail('CI_ADMIN_IDENTITY');
  const initialRoles=(await admin.query('SELECT rolname FROM pg_roles ORDER BY rolname')).rows;
  const baseline=inventory.suites.filter(x=>x.profile==='ordinary').map(x=>x.path),ordinary=path.join(artifactRoot,'ordinary');fs.mkdirSync(ordinary);
  try{const result=await testFiles(baseline,env,ordinary);reports.push(result.report);if(!result.exit||!result.accounting.accepted)failures.push('ordinary');}catch(error){failures.push('ordinary-report');if(String(error.message).includes('TEARDOWN'))throw error;}
  for(const suite of inventory.suites.filter(x=>x.profile!=='ordinary')){
   try{const result=await nativeFile(admin,suite,env,artifactRoot);reports.push(result.report);if(!result.exit||!result.accounting.accepted)failures.push(suite.path);}
   catch(error){failures.push(suite.path);process.stderr.write(safe(error.message)+'\n');if(String(error.message).includes('CLEANUP_')||String(error.message).includes('TEARDOWN'))throw error;}
  }
  sources();
  if(JSON.stringify((await admin.query('SELECT rolname FROM pg_roles ORDER BY rolname')).rows)!==JSON.stringify(initialRoles))fail('ROLE_LEAK');
  let accounting;
  try{accounting=c.accountReports(inventory.suites.map(x=>x.path),reports);}
  catch(error){accounting={accepted:false,expectedFiles:inventory.suites.length,reportedFiles:reports.reduce((n,r)=>n+r.testResults.length,0),failure:safe(error.message)};}
  const reported=new Set(reports.flatMap(r=>r.testResults.map(f=>f.name.replaceAll('\\','/'))));
  const missingSuites=inventory.suites.map(x=>x.path).filter(p=>![...reported].some(n=>n.endsWith('/'+p)));
  const proof={version:c.VERSION,sourceBundleSha256:inventory.sourceBundleSha256,accounting,failedGroups:failures,missingSuites,accepted:accounting.accepted&&failures.length===0};
  fs.writeFileSync(path.join(artifactRoot,'summary.json'),JSON.stringify(proof,null,2)+'\n');process.stdout.write(JSON.stringify(proof)+'\n');
  if(!proof.accepted)process.exitCode=1;
 }catch(error){
  const reported=reports.flatMap(r=>r.testResults.map(f=>f.name.replaceAll('\\','/')));
  const proof={version:c.VERSION,sourceBundleSha256:inventory.sourceBundleSha256,accepted:false,fatal:safe(error.message),failedGroups:failures,missingSuites:inventory.suites.map(x=>x.path).filter(p=>!reported.some(n=>n.endsWith('/'+p)))};
  fs.writeFileSync(path.join(artifactRoot,'summary.json'),JSON.stringify(proof,null,2)+'\n');throw error;
 }finally{await admin.end();}
}
main().catch(error=>{process.stderr.write(safe(error.message)+'\n');process.exitCode=1;});
