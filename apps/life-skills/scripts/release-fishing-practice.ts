/** Exact-target migration-before-code operator for 0132 only. It changes schema only.
 * It never creates enrollment, attendance, trip authorization, payment or provider effects. */
import {createHash} from 'node:crypto';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import {Pool} from 'pg';
import {z} from 'zod';
import {migrate} from '../src/db/migration-runner.ts';
import type {AppliedMigration,Migration} from '../src/db/migration-plan.ts';
import {assertContactOpsDatabaseIdentity} from '../src/db/contact-ops-production-guard.ts';
import {collectFishingPracticeSourceEntries,fishingPracticeMigrationInventory,fishingPracticePlan,fishingPracticeSourceBundle,fishingPracticeStateDigest,readFishingPracticeReleaseSnapshot} from '../src/db/fishing-practice-release.ts';
import {runFishingPracticeMutationAdmission,validateFishingPracticeEvidence,validateFishingPracticeProof,validateFishingPracticeJobSource,type FishingPracticeEvidence} from '../src/db/fishing-practice-evidence.ts';

const target=Object.freeze({projectId:'3b756632-1f66-4f75-a016-eabc37aa0d67',environmentId:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',appServiceId:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',databaseServiceId:'354b5343-9e83-45a7-b764-09396f14ae29',databaseHost:'postgres.railway.internal',appOrigin:'https://life-skills.bneineviimacademy.org'});
const sha=z.string().regex(/^[a-f0-9]{64}$/),hash=(bytes:string|Buffer|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function migrationInventory():Promise<{files:Migration[];manifestBytes:Buffer}>{
 const root=new URL('../migrations/',import.meta.url),manifestBytes=await readFile(new URL('manifest.json',root)),manifest=z.array(z.strictObject({name:z.string().regex(/^\d{4}_[a-z][a-z0-9_]*\.sql$/),sha256:sha})).parse(JSON.parse(manifestBytes.toString('utf8')));
 const actual=(await readdir(fileURLToPath(root))).filter(name=>name.endsWith('.sql')).sort();if(JSON.stringify(actual)!==JSON.stringify(manifest.map(item=>item.name).sort()))throw Error('FISHING_PRACTICE_MIGRATION_INVENTORY_MISMATCH');
 const files:Migration[]=[];for(const entry of manifest){const bytes=await readFile(new URL(entry.name,root));if(hash(bytes)!==entry.sha256)throw Error('FISHING_PRACTICE_MIGRATION_CHECKSUM_MISMATCH');files.push({name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')});}return {files,manifestBytes};
}
async function main(){
 const args=process.argv.slice(2);if(args.length!==4||!['--preflight','--apply','--verify-only'].includes(args[0]!))throw Error('FISHING_PRACTICE_ARGUMENTS_INVALID');
 const deploymentId=args[1]?.match(/^--deployment=([0-9a-f-]{36})$/)?.[1];if(!deploymentId||process.env.RAILWAY_DEPLOYMENT_ID!==deploymentId)throw Error('FISHING_PRACTICE_DEPLOYMENT_MISMATCH');
 const binding=args[2]?.match(/^--database-binding=([0-9a-f-]{36}):([a-f0-9]{64})$/);if(!binding||binding[1]!==target.databaseServiceId)throw Error('FISHING_PRACTICE_DATABASE_BINDING_REQUIRED');
 const sourceDigest=args[3]?.match(/^--source-bundle=([a-f0-9]{64})$/)?.[1];if(!sourceDigest)throw Error('FISHING_PRACTICE_SOURCE_PROVENANCE_REQUIRED');
 if(process.env.LS_FISHING_PRACTICE_RELEASE_APPROVED!=='true'||process.env.RAILWAY_PROJECT_ID!==target.projectId||process.env.RAILWAY_ENVIRONMENT_ID!==target.environmentId||process.env.RAILWAY_SERVICE_ID!==target.appServiceId||process.env.LS_APP_ORIGIN!==target.appOrigin)throw Error('FISHING_PRACTICE_TARGET_MISMATCH');
 if(process.env.LS_DATABASE_TLS!=='verify-full'||!process.env.LS_DATABASE_CA?.trim())throw Error('FISHING_PRACTICE_TLS_REQUIRED');
 const url=new URL(process.env.LS_DATABASE_URL??'');if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==target.databaseHost||url.port!=='5432'||url.pathname!=='/railway'||url.search||url.hash||!url.username||!url.password)throw Error('FISHING_PRACTICE_DATABASE_TARGET_MISMATCH');
 if(hash(process.env.LS_DATABASE_URL!)!==binding[2])throw Error('FISHING_PRACTICE_DATABASE_BINDING_MISMATCH');
 const appRoot=new URL('../',import.meta.url),entries=await collectFishingPracticeSourceEntries(appRoot),actualBundle=fishingPracticeSourceBundle(entries);if(actualBundle!==sourceDigest)throw Error('FISHING_PRACTICE_SOURCE_PROVENANCE_MISMATCH');
 const proofFile=process.env.LS_FISHING_PRACTICE_RELEASE_PROOF_FILE;if(!proofFile||!isAbsolute(proofFile))throw Error('FISHING_PRACTICE_PROOF_REQUIRED');const proofBytes=await readFile(proofFile);if(hash(proofBytes)!==process.env.LS_FISHING_PRACTICE_RELEASE_PROOF_SHA256)throw Error('FISHING_PRACTICE_PROOF_HASH_MISMATCH');
 // This migration-before-code job may run exact transferred candidate bytes in
 // the existing service. Its provenance is NOT the serving deployment's Git SHA.
 const jobSourceFile=process.env.LS_FISHING_PRACTICE_JOB_SOURCE_FILE;
 if(!jobSourceFile||!isAbsolute(jobSourceFile))throw Error('FISHING_PRACTICE_JOB_SOURCE_REQUIRED');
 const jobNode=await lstat(jobSourceFile);if(jobNode.isSymbolicLink()||!jobNode.isFile())throw Error('FISHING_PRACTICE_JOB_SOURCE_FILE_INVALID');
 const jobSourceBytes=await readFile(jobSourceFile),jobSourceSha256=hash(jobSourceBytes);
 if(jobSourceSha256!==process.env.LS_FISHING_PRACTICE_JOB_SOURCE_SHA256)throw Error('FISHING_PRACTICE_JOB_SOURCE_HASH_MISMATCH');
 const now=Date.now(),jobSource=validateFishingPracticeJobSource(JSON.parse(jobSourceBytes.toString('utf8')),{...target,deploymentId,sourceBundleSha256:actualBundle},now),reviewedCommit=jobSource.reviewedCommit,mode=args[0]!.slice(2) as 'preflight'|'apply'|'verify-only',proof=validateFishingPracticeProof(JSON.parse(proofBytes.toString('utf8')),{...target,deploymentId,mode,reviewedCommit,sourceBundleSha256:actualBundle,databaseBindingSha256:binding[2]!,jobSourceSha256},now);
 const evidenceFiles=[['independent_review',proof.evidence.independentReview],['baseline_preflight',proof.evidence.baselinePreflight],['backup_readback',proof.evidence.backupReadback],['isolated_restore',proof.evidence.isolatedRestore],['rollback_plan',proof.evidence.rollbackPlan]] as const,evidenceDocuments:{kind:FishingPracticeEvidence['kind'];value:unknown}[]=[];
 for(const [kind,entry] of evidenceFiles){if(!isAbsolute(entry.path))throw Error('FISHING_PRACTICE_EVIDENCE_PATH_INVALID');const bytes=await readFile(entry.path);if(hash(bytes)!==entry.sha256)throw Error('FISHING_PRACTICE_EVIDENCE_HASH_MISMATCH');const value:unknown=JSON.parse(bytes.toString('utf8'));validateFishingPracticeEvidence(value,proof,kind as FishingPracticeEvidence['kind'],now);evidenceDocuments.push({kind:kind as FishingPracticeEvidence['kind'],value});}
 const {files:inventory,manifestBytes}=await migrationInventory();if(hash(manifestBytes)!==proof.manifestSha256)throw Error('FISHING_PRACTICE_MANIFEST_CHANGED');const files=fishingPracticeMigrationInventory(inventory);
 const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true,ca:process.env.LS_DATABASE_CA},max:1,connectionTimeoutMillis:8000,statement_timeout:30000});try{const client=await pool.connect();try{
  const locked=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(541932,5) AS locked');if(locked.rows[0]?.locked!==true)throw Error('FISHING_PRACTICE_MIGRATION_LOCKED');try{
   const identity=await client.query<{system_identifier:string;ssl:boolean}>(`SELECT (SELECT system_identifier FROM pg_control_system()) AS system_identifier,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`);assertContactOpsDatabaseIdentity(identity.rows[0]?.system_identifier,identity.rows[0]?.ssl);
   const ledger=await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name'),history:AppliedMigration[]=ledger.rows,snapshot=await readFishingPracticeReleaseSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>await client.query<R>(sql,[...values])}),beforeDigest=fishingPracticeStateDigest(history,snapshot),expectedBefore=mode==='verify-only'?proof.expectedStateSha256:proof.baselineStateSha256;
   if(beforeDigest!==expectedBefore)throw Error('FISHING_PRACTICE_BASELINE_STATE_CHANGED');const before=fishingPracticePlan(files,history,snapshot);
   if(mode==='preflight'){if(before.stage!==0||before.pending.length!==1)throw Error('FISHING_PRACTICE_PREFLIGHT_STATE_INVALID');process.stdout.write(JSON.stringify({code:'FISHING_PRACTICE_PREFLIGHT_OK',deploymentId,databaseServiceId:target.databaseServiceId,pending:before.pending.map(item=>item.name),effects:'schema-only'})+'\n');return;}
   if(mode==='verify-only'){if(before.stage!==1||before.pending.length)throw Error('FISHING_PRACTICE_MIGRATION_PENDING');process.stdout.write(JSON.stringify({code:'FISHING_PRACTICE_SCHEMA_VERIFIED',deploymentId,databaseServiceId:target.databaseServiceId,stage:1,applied:0})+'\n');return;}
   if(before.stage!==0||before.pending.length!==1)throw Error('FISHING_PRACTICE_APPLY_STATE_INVALID');
   const currentJobNode=await lstat(jobSourceFile),currentJobBytes=await readFile(jobSourceFile);
   if(currentJobNode.isSymbolicLink()||!currentJobNode.isFile()||hash(currentJobBytes)!==jobSourceSha256)throw Error('FISHING_PRACTICE_JOB_SOURCE_CHANGED');
   validateFishingPracticeJobSource(JSON.parse(currentJobBytes.toString('utf8')),{...target,deploymentId,sourceBundleSha256:actualBundle},Date.now());
   if(fishingPracticeSourceBundle(await collectFishingPracticeSourceEntries(appRoot))!==actualBundle)throw Error('FISHING_PRACTICE_SOURCE_PROVENANCE_CHANGED');
   const expected={...target,deploymentId,mode,reviewedCommit,sourceBundleSha256:actualBundle,databaseBindingSha256:binding[2]!,jobSourceSha256},result=await runFishingPracticeMutationAdmission({proof,evidence:evidenceDocuments,expected,nowMs:Date.now(),mutate:()=>migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},files,false)}),afterLedger=await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name'),afterSnapshot=await readFishingPracticeReleaseSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>await client.query<R>(sql,[...values])}),after=fishingPracticePlan(files,afterLedger.rows,afterSnapshot);
   if(after.stage!==1||after.pending.length||result.applied!==1||fishingPracticeStateDigest(afterLedger.rows,afterSnapshot)!==proof.expectedStateSha256)throw Error('FISHING_PRACTICE_APPLY_READBACK_FAILED');process.stdout.write(JSON.stringify({code:'FISHING_PRACTICE_SCHEMA_VERIFIED',deploymentId,databaseServiceId:target.databaseServiceId,stage:1,applied:1})+'\n');
  }finally{await client.query('SELECT pg_advisory_unlock(541932,5)').catch(()=>undefined);}
 }finally{client.release();}}finally{await pool.end();}
}
main().catch(error=>{const code=error instanceof Error&&/^(FISHING_PRACTICE|CONTACT_OPS|MIGRATION)_[A-Z0-9_:.-]+$/.test(error.message)?error.message:'FISHING_PRACTICE_OPERATION_FAILED';process.stderr.write(code+'\n');process.exitCode=1;});
