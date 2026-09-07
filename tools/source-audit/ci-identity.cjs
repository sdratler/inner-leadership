/** Secret-free, ephemeral CI orchestration for the existing LS025 tests only. */
'use strict';
const {spawnSync} = require('node:child_process');
const {randomBytes,randomUUID} = require('node:crypto');
const {mkdtempSync,rmSync,existsSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {resolve,join} = require('node:path');
const {createRequire} = require('node:module');
const app=resolve(__dirname,'../../apps/life-skills');
const requireApp=createRequire(join(app,'package.json'));
const {Pool}=requireApp('pg');
function run(args,env){
 const result=spawnSync(process.execPath,args,{cwd:app,env,stdio:'inherit',timeout:600000});
 if(result.error || result.status!==0)throw new Error('SYNTHETIC_CI_COMMAND_FAILED');
}
async function main(){
 if(process.env.CI!=='true')throw new Error('CI_ONLY');
 if(!existsSync(join(app,'tests/identity-db/identity.pg.test.ts'))){
  console.log('LS025 identity suites not present on this base; no identity tests claimed.');return;
 }
 const raw=process.env.LS_DATABASE_URL;
 const url=new URL(raw||'invalid:');
 if(url.protocol!=='postgresql:' || url.hostname!=='127.0.0.1' || url.port!=='5432' || url.pathname!=='/lifeskills_ci_test' || url.search)throw new Error('DISPOSABLE_CI_DATABASE_REQUIRED');
 const admin=new Pool({connectionString:raw,ssl:false});
 try{await admin.query('CREATE DATABASE ls010_test_ci');}finally{await admin.end();}
 const identityDb=new URL(url);identityDb.pathname='/ls010_test_ci';
 run(['--import','tsx','--test','tests/identity-db/identity.pg.test.ts'],{...process.env,LS_IDENTITY_TEST_DATABASE_URL:identityDb.href,LS_IDENTITY_TEST_ALLOW_DISPOSABLE:'true'});
 const temp=mkdtempSync(join(tmpdir(),'ls-synthetic-https-'));
 try{
  const key=join(temp,'key.pem'),cert=join(temp,'cert.pem');
  const openssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:30000});
  if(openssl.error || openssl.status!==0)throw new Error('SYNTHETIC_CERTIFICATE_FAILED');
  const randomKey=()=>randomBytes(32).toString('base64url');
  const env={...process.env,NODE_ENV:'development',LS_APP_ORIGIN:'https://localhost:3003',LS_IDENTITY_ENABLED:'true',LS_IDENTITY_TEST_ALLOW_DISPOSABLE:'true',LS_TEST_HTTPS_KEY:key,LS_TEST_HTTPS_CERT:cert,LS_IDENTITY_WORKSPACE_ID:randomUUID(),LS_IDENTITY_ACTIVE_KEY_ID:'ci',LS_IDENTITY_DATA_KEYS:JSON.stringify({ci:randomKey()}),LS_IDENTITY_CSRF_KEY:randomKey(),LS_IDENTITY_LOOKUP_KEY:randomKey(),LS_IDENTITY_RATE_KEY:randomKey()};
  run(['--import','tsx','--test','tests/identity-http/identity.https.test.ts'],env);
 }finally{rmSync(temp,{recursive:true,force:true});}
}
main().catch(()=>{console.error('SYNTHETIC_IDENTITY_CI_BLOCKED');process.exitCode=1;});
