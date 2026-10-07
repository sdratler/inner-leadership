/** Exact-target migration-before-code operator for reviewed migrations 0119-0123.
 * It changes schema only. It never imports/reconciles contacts, switches CRM
 * authority, sends messages, activates providers, books, pays or publishes. */
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {z} from 'zod';
import {migrate} from '../src/db/migration-runner.ts';
import type {AppliedMigration,Migration} from '../src/db/migration-plan.ts';
import {assertContactOpsDatabaseIdentity} from '../src/db/contact-ops-production-guard.ts';
import {CONTACT_WORK_BASELINE,CONTACT_WORK_MIGRATIONS,contactWorkPlan,contactWorkSourceBundle,readContactWorkSnapshot} from '../src/db/contact-work-release.ts';

const target=Object.freeze({projectId:'3b756632-1f66-4f75-a016-eabc37aa0d67',environmentId:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',appServiceId:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',databaseServiceId:'354b5343-9e83-45a7-b764-09396f14ae29',databaseHost:'postgres.railway.internal',appOrigin:'https://life-skills.bneineviimacademy.org'});
const sha=z.string().regex(/^[a-f0-9]{64}$/),hash=(bytes:string|Buffer|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const proofSchema=z.strictObject({changeId:z.literal('LS-CONTACT-WORK-MIGRATIONS-20261007-01'),scope:z.literal('private-app-contact-work-migrations-0119-0123'),projectId:z.literal(target.projectId),environmentId:z.literal(target.environmentId),appServiceId:z.literal(target.appServiceId),databaseServiceId:z.literal(target.databaseServiceId),reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceBundleSha256:sha,manifestSha256:sha,independentReview:z.literal('PASS'),reviewReceiptSha256:sha,baselinePreflightReceiptSha256:sha,backupId:z.string().min(1),backupReadbackSha256:sha,isolatedRestore:z.literal('PASS'),restoreReceiptSha256:sha,rollbackPlanSha256:sha,controlFence:z.string().min(20),expiresAt:z.iso.datetime()});
const sourcePaths=['migrations/manifest.json',...CONTACT_WORK_MIGRATIONS.map(item=>'migrations/'+item.name),'scripts/release-contact-work.ts','src/db/contact-work-release.ts','src/db/contact-ops-production-guard.ts','src/db/migration-plan.ts','src/db/migration-runner.ts'] as const;

async function migrationInventory():Promise<{files:Migration[];manifestBytes:Buffer}>{
 const root=new URL('../migrations/',import.meta.url),manifestBytes=await readFile(new URL('manifest.json',root)),manifest=z.array(z.strictObject({name:z.string().regex(/^\d{4}_[a-z][a-z0-9_]*\.sql$/),sha256:sha})).parse(JSON.parse(manifestBytes.toString('utf8')));
 const actual=(await readdir(fileURLToPath(root))).filter(name=>name.endsWith('.sql')).sort();if(JSON.stringify(actual)!==JSON.stringify(manifest.map(item=>item.name).sort()))throw Error('CONTACT_WORK_MIGRATION_INVENTORY_MISMATCH');
 const files:Migration[]=[];for(const entry of manifest){const bytes=await readFile(new URL(entry.name,root));if(hash(bytes)!==entry.sha256)throw Error('CONTACT_WORK_MIGRATION_CHECKSUM_MISMATCH');files.push({name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')});}return {files,manifestBytes};
}

async function main(){
 const args=process.argv.slice(2);if(args.length!==4||!['--preflight','--apply','--verify-only'].includes(args[0]!))throw Error('CONTACT_WORK_ARGUMENTS_INVALID');
 const deploymentId=args[1]?.match(/^--deployment=([0-9a-f-]{36})$/)?.[1];if(!deploymentId||process.env.RAILWAY_DEPLOYMENT_ID!==deploymentId)throw Error('CONTACT_WORK_DEPLOYMENT_MISMATCH');
 const binding=args[2]?.match(/^--database-binding=([0-9a-f-]{36}):([a-f0-9]{64})$/);if(!binding||binding[1]!==target.databaseServiceId)throw Error('CONTACT_WORK_DATABASE_BINDING_REQUIRED');
 const sourceDigest=args[3]?.match(/^--source-bundle=([a-f0-9]{64})$/)?.[1];if(!sourceDigest)throw Error('CONTACT_WORK_SOURCE_PROVENANCE_REQUIRED');
 if(process.env.LS_CONTACT_WORK_RELEASE_APPROVED!=='true'||process.env.RAILWAY_PROJECT_ID!==target.projectId||process.env.RAILWAY_ENVIRONMENT_ID!==target.environmentId||process.env.RAILWAY_SERVICE_ID!==target.appServiceId||process.env.LS_APP_ORIGIN!==target.appOrigin)throw Error('CONTACT_WORK_TARGET_MISMATCH');
 if(process.env.LS_DATABASE_TLS!=='verify-full'||!process.env.LS_DATABASE_CA?.trim())throw Error('CONTACT_WORK_TLS_REQUIRED');
 const url=new URL(process.env.LS_DATABASE_URL??'');if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==target.databaseHost||url.port!=='5432'||url.pathname!=='/railway'||url.search||url.hash||!url.username||!url.password)throw Error('CONTACT_WORK_DATABASE_TARGET_MISMATCH');
 if(hash(process.env.LS_DATABASE_URL!)!==binding[2])throw Error('CONTACT_WORK_DATABASE_BINDING_MISMATCH');
 const proofFile=process.env.LS_CONTACT_WORK_RELEASE_PROOF_FILE;if(!proofFile)throw Error('CONTACT_WORK_PROOF_REQUIRED');const proofBytes=await readFile(proofFile);if(hash(proofBytes)!==process.env.LS_CONTACT_WORK_RELEASE_PROOF_SHA256)throw Error('CONTACT_WORK_PROOF_HASH_MISMATCH');const proof=proofSchema.parse(JSON.parse(proofBytes.toString('utf8')));if(Date.parse(proof.expiresAt)<=Date.now())throw Error('CONTACT_WORK_PROOF_EXPIRED');if(proof.reviewedCommit!==process.env.RAILWAY_GIT_COMMIT_SHA)throw Error('CONTACT_WORK_REVIEWED_COMMIT_MISMATCH');
 const appRoot=new URL('../',import.meta.url),entries=await Promise.all(sourcePaths.map(async path=>({path,bytes:await readFile(new URL(path,appRoot))})));const actualBundle=contactWorkSourceBundle(entries);if(actualBundle!==sourceDigest||actualBundle!==proof.sourceBundleSha256)throw Error('CONTACT_WORK_SOURCE_PROVENANCE_MISMATCH');
 const {files,manifestBytes}=await migrationInventory();if(hash(manifestBytes)!==proof.manifestSha256)throw Error('CONTACT_WORK_MANIFEST_CHANGED');const baseline=files.findIndex(file=>file.name===CONTACT_WORK_BASELINE.name&&file.checksum===CONTACT_WORK_BASELINE.sha256);if(baseline<0||files.length!==baseline+1+CONTACT_WORK_MIGRATIONS.length)throw Error('CONTACT_WORK_MIGRATION_SCOPE_MISMATCH');
 const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true,ca:process.env.LS_DATABASE_CA},max:1,connectionTimeoutMillis:8000,statement_timeout:30000});try{const client=await pool.connect();try{
  const locked=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(541931,0) AS locked');if(locked.rows[0]?.locked!==true)throw Error('CONTACT_WORK_MIGRATION_LOCKED');try{
   const identity=await client.query<{system_identifier:string;ssl:boolean}>(`SELECT (SELECT system_identifier FROM pg_control_system()) AS system_identifier,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`);assertContactOpsDatabaseIdentity(identity.rows[0]?.system_identifier,identity.rows[0]?.ssl);
   const ledger=await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name'),history:AppliedMigration[]=ledger.rows;const before=contactWorkPlan(files,history,await readContactWorkSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>(await client.query<R>(sql,[...values]))}));
   if(args[0]==='--preflight'){process.stdout.write(JSON.stringify({code:'CONTACT_WORK_PREFLIGHT_OK',deploymentId,databaseServiceId:target.databaseServiceId,stage:before.stage,pending:before.pending.map(item=>item.name),effects:'none'})+'\n');return;}
   if(args[0]==='--verify-only'){if(before.stage!==5||before.pending.length)throw Error('CONTACT_WORK_MIGRATIONS_PENDING');process.stdout.write(JSON.stringify({code:'CONTACT_WORK_SCHEMA_VERIFIED',deploymentId,databaseServiceId:target.databaseServiceId,stage:before.stage,applied:0})+'\n');return;}
   const result=await migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},files,false),afterLedger=await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name'),after=contactWorkPlan(files,afterLedger.rows,await readContactWorkSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>(await client.query<R>(sql,[...values]))}));if(after.stage!==5||after.pending.length||result.applied!==before.pending.length)throw Error('CONTACT_WORK_APPLY_READBACK_FAILED');process.stdout.write(JSON.stringify({code:'CONTACT_WORK_SCHEMA_VERIFIED',deploymentId,databaseServiceId:target.databaseServiceId,stage:after.stage,applied:result.applied})+'\n');
  }finally{await client.query('SELECT pg_advisory_unlock(541931,0)').catch(()=>undefined);}
 }finally{client.release();}}finally{await pool.end();}
}
main().catch(error=>{const code=error instanceof Error&&/^(CONTACT_WORK|CONTACT_OPS|MIGRATION)_[A-Z0-9_]+$/.test(error.message)?error.message:'CONTACT_WORK_OPERATION_FAILED';process.stderr.write(code+'\n');process.exitCode=1;});
