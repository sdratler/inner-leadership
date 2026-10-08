/** Exact-target migration-before-code operator for 0129 only. It changes schema only.
 * It never moves a real proposal, creates an enrollment/booking/charge, or invokes a provider. */
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import {Pool} from 'pg';
import {z} from 'zod';
import {migrate} from '../src/db/migration-runner.ts';
import type {AppliedMigration,Migration} from '../src/db/migration-plan.ts';
import {assertContactOpsDatabaseIdentity} from '../src/db/contact-ops-production-guard.ts';
import {PROPOSED_PLACEMENT_MOVES_SOURCE_PATHS,PROPOSED_PLACEMENT_MOVES_SOURCE_ROOTS,proposedPlacementMovesMigrationInventory,proposedPlacementMovesPlan,proposedPlacementMovesSourceBundle,proposedPlacementMovesStateDigest,readProposedPlacementMovesReleaseSnapshot} from '../src/db/proposed-placement-moves-release.ts';
import {validateProposedPlacementMovesEvidence,validateProposedPlacementMovesProof,type ProposedPlacementMovesEvidence} from '../src/db/proposed-placement-moves-evidence.ts';

const target=Object.freeze({projectId:'3b756632-1f66-4f75-a016-eabc37aa0d67',environmentId:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',appServiceId:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',databaseServiceId:'354b5343-9e83-45a7-b764-09396f14ae29',databaseHost:'postgres.railway.internal',appOrigin:'https://life-skills.bneineviimacademy.org'});
const sha=z.string().regex(/^[a-f0-9]{64}$/),hash=(bytes:string|Buffer|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function migrationInventory():Promise<{files:Migration[];manifestBytes:Buffer}>{
 const root=new URL('../migrations/',import.meta.url),manifestBytes=await readFile(new URL('manifest.json',root)),manifest=z.array(z.strictObject({name:z.string().regex(/^\d{4}_[a-z][a-z0-9_]*\.sql$/),sha256:sha})).parse(JSON.parse(manifestBytes.toString('utf8')));
 const actual=(await readdir(fileURLToPath(root))).filter(name=>name.endsWith('.sql')).sort();if(JSON.stringify(actual)!==JSON.stringify(manifest.map(item=>item.name).sort()))throw Error('PROPOSED_PLACEMENT_MOVES_MIGRATION_INVENTORY_MISMATCH');
 const files:Migration[]=[];for(const entry of manifest){const bytes=await readFile(new URL(entry.name,root));if(hash(bytes)!==entry.sha256)throw Error('PROPOSED_PLACEMENT_MOVES_MIGRATION_CHECKSUM_MISMATCH');files.push({name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')});}return {files,manifestBytes};
}
async function sourceEntries(appRoot:URL):Promise<{path:string;bytes:Buffer}[]>{
 const entries:{path:string;bytes:Buffer}[]=await Promise.all(PROPOSED_PLACEMENT_MOVES_SOURCE_PATHS.map(async path=>({path,bytes:await readFile(new URL(path,appRoot))})));
 const walk=async(relativeDirectory:string):Promise<void>=>{const directory=new URL(relativeDirectory+'/',appRoot),children=(await readdir(fileURLToPath(directory),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));for(const child of children){const relative=relativeDirectory+'/'+child.name;if(child.isSymbolicLink())throw Error('PROPOSED_PLACEMENT_MOVES_SOURCE_SYMLINK_REJECTED');if(child.isDirectory())await walk(relative);else if(child.isFile())entries.push({path:relative,bytes:await readFile(new URL(relative,appRoot))});}};
 for(const root of PROPOSED_PLACEMENT_MOVES_SOURCE_ROOTS)await walk(root);return entries;
}
async function main(){
 const args=process.argv.slice(2);if(args.length!==4||!['--preflight','--apply','--verify-only'].includes(args[0]!))throw Error('PROPOSED_PLACEMENT_MOVES_ARGUMENTS_INVALID');
 const deploymentId=args[1]?.match(/^--deployment=([0-9a-f-]{36})$/)?.[1];if(!deploymentId||process.env.RAILWAY_DEPLOYMENT_ID!==deploymentId)throw Error('PROPOSED_PLACEMENT_MOVES_DEPLOYMENT_MISMATCH');
 const binding=args[2]?.match(/^--database-binding=([0-9a-f-]{36}):([a-f0-9]{64})$/);if(!binding||binding[1]!==target.databaseServiceId)throw Error('PROPOSED_PLACEMENT_MOVES_DATABASE_BINDING_REQUIRED');
 const sourceDigest=args[3]?.match(/^--source-bundle=([a-f0-9]{64})$/)?.[1];if(!sourceDigest)throw Error('PROPOSED_PLACEMENT_MOVES_SOURCE_PROVENANCE_REQUIRED');
 if(process.env.LS_PROPOSED_PLACEMENT_MOVES_RELEASE_APPROVED!=='true'||process.env.RAILWAY_PROJECT_ID!==target.projectId||process.env.RAILWAY_ENVIRONMENT_ID!==target.environmentId||process.env.RAILWAY_SERVICE_ID!==target.appServiceId||process.env.LS_APP_ORIGIN!==target.appOrigin)throw Error('PROPOSED_PLACEMENT_MOVES_TARGET_MISMATCH');
 if(process.env.LS_DATABASE_TLS!=='verify-full'||!process.env.LS_DATABASE_CA?.trim())throw Error('PROPOSED_PLACEMENT_MOVES_TLS_REQUIRED');
 const url=new URL(process.env.LS_DATABASE_URL??'');if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==target.databaseHost||url.port!=='5432'||url.pathname!=='/railway'||url.search||url.hash||!url.username||!url.password)throw Error('PROPOSED_PLACEMENT_MOVES_DATABASE_TARGET_MISMATCH');
 if(hash(process.env.LS_DATABASE_URL!)!==binding[2])throw Error('PROPOSED_PLACEMENT_MOVES_DATABASE_BINDING_MISMATCH');
 const appRoot=new URL('../',import.meta.url),entries=await sourceEntries(appRoot),actualBundle=proposedPlacementMovesSourceBundle(entries);if(actualBundle!==sourceDigest)throw Error('PROPOSED_PLACEMENT_MOVES_SOURCE_PROVENANCE_MISMATCH');
 const proofFile=process.env.LS_PROPOSED_PLACEMENT_MOVES_RELEASE_PROOF_FILE;if(!proofFile||!isAbsolute(proofFile))throw Error('PROPOSED_PLACEMENT_MOVES_PROOF_REQUIRED');const proofBytes=await readFile(proofFile);if(hash(proofBytes)!==process.env.LS_PROPOSED_PLACEMENT_MOVES_RELEASE_PROOF_SHA256)throw Error('PROPOSED_PLACEMENT_MOVES_PROOF_HASH_MISMATCH');
 const reviewedCommit=process.env.RAILWAY_GIT_COMMIT_SHA;if(!reviewedCommit)throw Error('PROPOSED_PLACEMENT_MOVES_REVIEWED_COMMIT_MISMATCH');const now=Date.now(),mode=args[0]!.slice(2) as 'preflight'|'apply'|'verify-only',proof=validateProposedPlacementMovesProof(JSON.parse(proofBytes.toString('utf8')),{...target,deploymentId,mode,reviewedCommit,sourceBundleSha256:actualBundle,databaseBindingSha256:binding[2]!},now);
 const evidenceFiles=[['independent_review',proof.evidence.independentReview],['baseline_preflight',proof.evidence.baselinePreflight],['backup_readback',proof.evidence.backupReadback],['isolated_restore',proof.evidence.isolatedRestore],['rollback_plan',proof.evidence.rollbackPlan]] as const;
 for(const [kind,entry] of evidenceFiles){if(!isAbsolute(entry.path))throw Error('PROPOSED_PLACEMENT_MOVES_EVIDENCE_PATH_INVALID');const bytes=await readFile(entry.path);if(hash(bytes)!==entry.sha256)throw Error('PROPOSED_PLACEMENT_MOVES_EVIDENCE_HASH_MISMATCH');validateProposedPlacementMovesEvidence(JSON.parse(bytes.toString('utf8')),proof,kind as ProposedPlacementMovesEvidence['kind'],now);}
 const {files:inventory,manifestBytes}=await migrationInventory();if(hash(manifestBytes)!==proof.manifestSha256)throw Error('PROPOSED_PLACEMENT_MOVES_MANIFEST_CHANGED');const files=proposedPlacementMovesMigrationInventory(inventory);
 const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true,ca:process.env.LS_DATABASE_CA},max:1,connectionTimeoutMillis:8000,statement_timeout:30000});try{const client=await pool.connect();try{
  const locked=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock(541931,3) AS locked');if(locked.rows[0]?.locked!==true)throw Error('PROPOSED_PLACEMENT_MOVES_MIGRATION_LOCKED');try{
   const identity=await client.query<{system_identifier:string;ssl:boolean}>(`SELECT (SELECT system_identifier FROM pg_control_system()) AS system_identifier,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`);assertContactOpsDatabaseIdentity(identity.rows[0]?.system_identifier,identity.rows[0]?.ssl);
   const ledger=await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name'),history:AppliedMigration[]=ledger.rows,snapshot=await readProposedPlacementMovesReleaseSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>await client.query<R>(sql,[...values])}),beforeDigest=proposedPlacementMovesStateDigest(history,snapshot),expectedBefore=mode==='verify-only'?proof.expectedStateSha256:proof.baselineStateSha256;
   if(beforeDigest!==expectedBefore)throw Error('PROPOSED_PLACEMENT_MOVES_BASELINE_STATE_CHANGED');const before=proposedPlacementMovesPlan(files,history,snapshot);
   if(mode==='preflight'){if(before.stage!==0||before.pending.length!==1)throw Error('PROPOSED_PLACEMENT_MOVES_PREFLIGHT_STATE_INVALID');process.stdout.write(JSON.stringify({code:'PROPOSED_PLACEMENT_MOVES_PREFLIGHT_OK',deploymentId,databaseServiceId:target.databaseServiceId,pending:before.pending.map(item=>item.name),effects:'schema-only'})+'\n');return;}
   if(mode==='verify-only'){if(before.stage!==1||before.pending.length)throw Error('PROPOSED_PLACEMENT_MOVES_MIGRATION_PENDING');process.stdout.write(JSON.stringify({code:'PROPOSED_PLACEMENT_MOVES_SCHEMA_VERIFIED',deploymentId,databaseServiceId:target.databaseServiceId,stage:1,applied:0})+'\n');return;}
   if(before.stage!==0||before.pending.length!==1)throw Error('PROPOSED_PLACEMENT_MOVES_APPLY_STATE_INVALID');const result=await migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},files,false),afterLedger=await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name'),afterSnapshot=await readProposedPlacementMovesReleaseSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>await client.query<R>(sql,[...values])}),after=proposedPlacementMovesPlan(files,afterLedger.rows,afterSnapshot);
   if(after.stage!==1||after.pending.length||result.applied!==1||proposedPlacementMovesStateDigest(afterLedger.rows,afterSnapshot)!==proof.expectedStateSha256)throw Error('PROPOSED_PLACEMENT_MOVES_APPLY_READBACK_FAILED');process.stdout.write(JSON.stringify({code:'PROPOSED_PLACEMENT_MOVES_SCHEMA_VERIFIED',deploymentId,databaseServiceId:target.databaseServiceId,stage:1,applied:1})+'\n');
  }finally{await client.query('SELECT pg_advisory_unlock(541931,3)').catch(()=>undefined);}
 }finally{client.release();}}finally{await pool.end();}
}
main().catch(error=>{const code=error instanceof Error&&/^(PROPOSED_PLACEMENT_MOVES|CONTACT_OPS|MIGRATION)_[A-Z0-9_]+$/.test(error.message)?error.message:'PROPOSED_PLACEMENT_MOVES_OPERATION_FAILED';process.stderr.write(code+'\n');process.exitCode=1;});
