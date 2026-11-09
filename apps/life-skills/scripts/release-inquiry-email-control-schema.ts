/** Exact-target Fishing email-verification schema operator. With no mode it
 * reads source files only. No public route, provider, queue or data bootstrap. */
import { constants } from 'node:fs';
import { open, readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { AppliedMigration, Migration } from '../src/db/migration-plan.ts';
import { INQUIRY_EMAIL_CONTROL_MIGRATIONS } from '../src/db/inquiry-email-control-history.ts';
import { assertContactOpsDatabaseIdentity } from '../src/db/contact-ops-production-guard.ts';
import { owner305Hash } from '../src/db/owner-305-schema-release.ts';
import { readFishingMarketingSchemaStage } from '../src/db/fishing-marketing-schema-release.ts';
import { assertInquirySchemaApply,assertInquirySchemaProof,assertInquirySchemaProgress,inquiryEmailSchemaPlan,inquirySchemaProof,
 inquirySchemaTargetBinding,readInquiryEmailCatalog,schemaFailure,validateInquirySchemaSource,type InquirySchemaProof } from '../src/db/inquiry-email-control-schema-release.ts';

const root = new URL('../',import.meta.url);
const sourcePaths = ['migrations/manifest.json','src/db/contact-ops-production-guard.ts','src/db/owner-305-schema-release.ts',
 'src/db/fishing-marketing-schema-release.ts','src/db/inquiry-outbox-history.ts','src/db/migration-plan.ts','src/db/inquiry-email-control-history.ts',
 'src/db/inquiry-email-control-schema-release.ts','scripts/release-inquiry-email-control-schema.ts',...INQUIRY_EMAIL_CONTROL_MIGRATIONS.map(f=>'migrations/'+f.name)];
const manifestSchema=z.array(z.object({name:z.string().regex(/^\d{4}_[a-z][a-z0-9_]*\.sql$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict());

async function sourceBytes(relative:string) {
 const url=new URL(relative,root),stat=await lstat(fileURLToPath(url));
 if(!stat.isFile()||stat.isSymbolicLink())throw schemaFailure('SOURCE_INVALID');
 return readFile(url);
}
async function inventory() {
 const manifestBytes=await sourceBytes('migrations/manifest.json'),manifest=manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
 const actual=(await readdir(new URL('migrations/',root))).filter(name=>name.endsWith('.sql')).sort();
 if(JSON.stringify(actual)!==JSON.stringify(manifest.map(f=>f.name)))throw schemaFailure('INVENTORY_MISMATCH');
 const files:Migration[]=[];
 for(const item of manifest){
  const bytes=await sourceBytes('migrations/'+item.name);
  if(owner305Hash(bytes)!==item.sha256)throw schemaFailure('CHECKSUM_MISMATCH');
  files.push({name:item.name,checksum:item.sha256,sql:bytes.toString('utf8')});
 }
 validateInquirySchemaSource(files);
 const pins=[];
 for(const name of sourcePaths)pins.push([name,owner305Hash(await sourceBytes(name))]);
 return {files,manifestSha256:owner305Hash(manifestBytes),sourceSha256:owner305Hash(JSON.stringify(pins))};
}

async function loadProof(env:NodeJS.ProcessEnv) {
 const file=env.LS_INQUIRY_EMAIL_CONTROL_SCHEMA_PROOF_FILE,expected=env.LS_INQUIRY_EMAIL_CONTROL_SCHEMA_PROOF_SHA256;
 if(!file || !isAbsolute(file) || !expected || !/^[a-f0-9]{64}$/.test(expected) || await realpath(file)!==resolve(file))throw schemaFailure('PROOF_REQUIRED');
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {
  const stat=await handle.stat();
  if(!stat.isFile() || (stat.mode&0o077)!==0 || stat.size>65536)throw schemaFailure('PROOF_INVALID');
  const bytes=await handle.readFile();
  if(owner305Hash(bytes)!==expected)throw schemaFailure('PROOF_HASH_MISMATCH');
  return {proof:inquirySchemaProof.parse(JSON.parse(bytes.toString('utf8'))),digest:expected};
 } finally {await handle.close();}
}

async function consumeOnce(p:InquirySchemaProof,digest:string) {
 // The reviewed bytes bind the directory and nonce. Moving/copying the proof
 // file cannot create a second receipt name. Never remove a spent receipt.
 const dir=p.receiptDirectory;
 if(!isAbsolute(dir) || resolve(dir)!==await realpath(dir))throw schemaFailure('RECEIPT_DIRECTORY_INVALID');
 const stat=await lstat(dir);
 if(!stat.isDirectory() || (stat.mode&0o077)!==0)throw schemaFailure('RECEIPT_DIRECTORY_INVALID');
 const file=join(dir,'inquiry-email-control-'+p.approvalId+'.used.json');
 let handle;
 try {handle=await open(file,'wx',0o600);} catch {throw schemaFailure('APPROVAL_SPENT_OR_UNAVAILABLE');}
 try {
  await handle.writeFile(JSON.stringify({approvalId:p.approvalId,proofSha256:digest,deploymentId:p.deploymentId,
   baselineLedgerSha256:p.baselineLedgerSha256,claimedAt:new Date().toISOString()})+'\n');
  await handle.sync();
 } finally {await handle.close();}
 const parent=await open(dir,'r');
 try {await parent.sync();} finally {await parent.close();}
}

async function state(client:PoolClient,files:readonly Migration[]) {
 const identity=await client.query<{systemId:string;ssl:boolean}>('SELECT (SELECT system_identifier::text FROM pg_control_system()) AS "systemId",(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl');
 const actual=identity.rows[0];
 assertContactOpsDatabaseIdentity(actual?.systemId,actual?.ssl);
 const db={query:<T extends object>(sql:string,values?:readonly unknown[])=>client.query<T>(sql,values?[...values]:undefined)};
 if(await readFishingMarketingSchemaStage(db)!==1)throw schemaFailure('PREDECESSOR_MISSING');
 const {rows:history}=await client.query<AppliedMigration>('SELECT name,checksum FROM ls_control.migrations ORDER BY name');
 const catalog=await readInquiryEmailCatalog(db);
 return {...inquiryEmailSchemaPlan(files,history,catalog.stage),history,catalogSha256:catalog.catalogSha256,databaseSystemIdentifier:actual!.systemId};
}
async function snapshot(client:PoolClient,files:readonly Migration[]) {
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try {
  await client.query('SET LOCAL search_path TO pg_catalog');
  const result=await state(client,files);
  await client.query('COMMIT');
  return result;
 } catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
}
type State=Awaited<ReturnType<typeof state>>;
function report(code:string,current:State,source:{manifestSha256:string;sourceSha256:string},applied=0) {
 process.stdout.write(JSON.stringify({code,stage:current.stage,applied,pending:current.pending.map(f=>f.name),
  prefix:current.prefix,ledgerSha256:current.ledgerSha256,catalogSha256:current.catalogSha256,manifestSha256:source.manifestSha256,sourceSha256:source.sourceSha256})+'\n');
}
async function main() {
 const mode=process.argv[2]??'--source-digest';
 if(process.argv.length>3 || !['--source-digest','--preflight','--reconcile','--verify-only','--apply'].includes(mode))throw schemaFailure('ARGUMENTS_INVALID');
 const source=await inventory();
 if(mode==='--source-digest'){process.stdout.write(source.sourceSha256+'\n');return;}
 const env=process.env,target=inquirySchemaTargetBinding(env);
 const approval=mode==='--apply'||mode==='--verify-only'?await loadProof(env):null;
 if(approval){
  assertContactOpsDatabaseIdentity(approval.proof.backup.databaseSystemIdentifier,true);
  assertInquirySchemaProof(approval.proof,{...target,...source,databaseSystemIdentifier:approval.proof.backup.databaseSystemIdentifier});
  if(mode==='--apply')assertInquirySchemaApply(approval.proof,env,new Date());
 }
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString:env.LS_DATABASE_URL!,ssl:{rejectUnauthorized:true,ca:env.LS_DATABASE_CA!},max:1,connectionTimeoutMillis:8000,statement_timeout:30000});
 try {
  const client=await pool.connect();
  try {
   // Same session lock as migration-runner.ts across the entire selection.
   const lock=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(541931,0) AS locked');
   if(lock.rows[0]?.locked!==true)throw schemaFailure('LOCKED');
   try {
    let current=await snapshot(client,source.files);
    if(!approval){report(mode==='--preflight'?'PREFLIGHT_READ_ONLY':'RECONCILED_READ_ONLY',current,source);return;}
    const p=approval.proof;
    assertInquirySchemaProof(p,{...target,...source,databaseSystemIdentifier:current.databaseSystemIdentifier});
    assertInquirySchemaProgress(p,current,mode==='--apply');
    if(mode==='--verify-only'||current.stage===2){
     if(current.stage!==2 || current.pending.length)throw schemaFailure('VERIFY_PENDING');
     report('VERIFIED',current,source);return;
    }
    assertInquirySchemaApply(p,env,new Date());
    await consumeOnce(p,approval.digest);
    let applied=0;
    for(const file of [...current.pending]){
     const fresh=await inventory();
     if(fresh.sourceSha256!==source.sourceSha256 || fresh.manifestSha256!==source.manifestSha256)throw schemaFailure('SOURCE_CHANGED');
     assertInquirySchemaApply(p,env,new Date());
     await client.query('BEGIN');
     let commitIssued=false;
     try {
      await client.query('SET LOCAL search_path TO pg_catalog');
      await client.query('LOCK TABLE ls_control.migrations IN SHARE ROW EXCLUSIVE MODE');
      const before=await state(client,fresh.files);
      assertInquirySchemaProgress(p,before);
      if(before.stage!==current.stage || before.ledgerSha256!==current.ledgerSha256 || before.pending[0]?.name!==file.name ||
         before.pending[0].checksum!==file.checksum)throw schemaFailure('BASELINE_CHANGED');
      assertInquirySchemaApply(p,env,new Date());
      await client.query(file.sql);
      await client.query('INSERT INTO ls_control.migrations(name,checksum) VALUES($1,$2)',[file.name,file.checksum]);
      const after=await state(client,fresh.files);
      if(after.stage!==before.stage+1 || after.prefix!==before.prefix)throw schemaFailure('READBACK_FAILED');
      assertInquirySchemaProgress(p,after);
      assertInquirySchemaApply(p,env,new Date());
      commitIssued=true;await client.query('COMMIT');applied++;current=after;
     } catch(error){
      if(commitIssued)throw schemaFailure('COMMIT_UNKNOWN_USE_READ_ONLY_RECONCILE');
      await client.query('ROLLBACK').catch(()=>undefined);throw error;
     }
    }
    const final=await snapshot(client,source.files);assertInquirySchemaProgress(p,final);
    if(final.stage!==2 || final.pending.length)throw schemaFailure('READBACK_FAILED');
    report('VERIFIED',final,source,applied);
   } finally {await client.query('SELECT pg_advisory_unlock(541931,0)').catch(()=>undefined);}
  } finally {client.release(true);}
 } finally {await pool.end();}
}
main().catch(error=>{
 const code=error instanceof Error && /^INQUIRY_EMAIL_CONTROL_SCHEMA_[A-Z_]+$/.test(error.message)?error.message:'INQUIRY_EMAIL_CONTROL_SCHEMA_OPERATION_FAILED';
 process.stderr.write(code+'\n');process.exitCode=1;
});
