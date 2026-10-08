import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';
import {SERVICE_INTEREST_MIGRATION,serviceInterestMigrationInventory,serviceInterestPlan,serviceInterestSourceBundle,type ServiceInterestReleaseSnapshot} from '../../src/db/service-interest-release.ts';
import {validateServiceInterestEvidence,validateServiceInterestProof} from '../../src/db/service-interest-evidence.ts';
import type {Migration} from '../../src/db/migration-plan.ts';

const inventory=async()=>{const manifest=JSON.parse(await readFile(new URL('../../migrations/manifest.json',import.meta.url),'utf8')) as {name:string;sha256:string}[];return Promise.all(manifest.map(async entry=>({name:entry.name,checksum:entry.sha256,sql:await readFile(new URL('../../migrations/'+entry.name,import.meta.url),'utf8')})));};
const snapshot=(stage:0|1):ServiceInterestReleaseSnapshot=>({stage,catalogDigest:(stage?'b':'a').repeat(64),serviceRows:0,operationRows:0});
describe('service-interest migration 0127 release boundary',()=>{
 it('selects exactly through 0127 and allows later registered migrations without widening this operator',async()=>{
  const files=await inventory(),scoped=serviceInterestMigrationInventory(files);expect(scoped.at(-1)).toMatchObject({name:SERVICE_INTEREST_MIGRATION.name,checksum:SERVICE_INTEREST_MIGRATION.sha256});
  const future:Migration={name:'0128_future_scope.sql',checksum:'c'.repeat(64),sql:'select 1'};expect(serviceInterestMigrationInventory([...files,future])).toEqual(scoped);
  expect(()=>serviceInterestMigrationInventory(files.filter(file=>file.name!=='0126_ls_audience_interest.sql'))).toThrow('SERVICE_INTEREST_MIGRATION_SET_MISMATCH');
 });
 it('requires ledger and schema to advance together by exactly one migration',async()=>{
  const files=await inventory(),scoped=serviceInterestMigrationInventory(files),baseline=scoped.slice(0,-1).map(({name,checksum})=>({name,checksum})),current=scoped.map(({name,checksum})=>({name,checksum}));
  expect(serviceInterestPlan(files,baseline,snapshot(0)).pending.map(item=>item.name)).toEqual([SERVICE_INTEREST_MIGRATION.name]);
  expect(serviceInterestPlan(files,current,snapshot(1))).toMatchObject({stage:1,pending:[]});
  expect(()=>serviceInterestPlan(files,baseline,snapshot(1))).toThrow('SERVICE_INTEREST_LEDGER_STATE_CONFLICT');
 });
 it('binds short-lived proof and evidence to exact target, source, backup and deployment',()=>{
  const now=Date.parse('2026-10-08T08:00:00.000Z'),sha='a'.repeat(64),ids={projectId:'3b756632-1f66-4f75-a016-eabc37aa0d67',environmentId:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',appServiceId:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',databaseServiceId:'354b5343-9e83-45a7-b764-09396f14ae29'},deploymentId=randomUUID(),reviewedCommit='b'.repeat(40),sourceBundleSha256=sha,databaseBindingSha256='c'.repeat(64),nonce=randomUUID();
  const proof={changeId:'LS-SERVICE-INTEREST-MIGRATION-20261008-01',scope:'private-app-service-interest-migration-0127',...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,manifestSha256:'d'.repeat(64),databaseBindingSha256,baselineStateSha256:'e'.repeat(64),expectedStateSha256:'f'.repeat(64),independentReview:'PASS',isolatedRestore:'PASS',backupId:'private-backup',controlFence:'g'.repeat(32),nonce,issuedAt:'2026-10-08T07:55:00.000Z',expiresAt:'2026-10-08T09:00:00.000Z',evidence:{independentReview:{path:'C:\\private\\review.json',sha256:sha},baselinePreflight:{path:'C:\\private\\preflight.json',sha256:sha},backupReadback:{path:'C:\\private\\backup.json',sha256:sha},isolatedRestore:{path:'C:\\private\\restore.json',sha256:sha},rollbackPlan:{path:'C:\\private\\rollback.json',sha256:sha}}} as const;
  const parsed=validateServiceInterestProof(proof,{...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,databaseBindingSha256},now),evidence={changeId:proof.changeId,scope:proof.scope,kind:'rollback_plan',status:'READY',...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,databaseBindingSha256,baselineStateSha256:proof.baselineStateSha256,expectedStateSha256:proof.expectedStateSha256,backupId:proof.backupId,controlFence:proof.controlFence,nonce,createdAt:'2026-10-08T07:54:00.000Z'} as const;
  expect(validateServiceInterestEvidence(evidence,parsed,'rollback_plan',now).kind).toBe('rollback_plan');
  expect(()=>validateServiceInterestProof({...proof,deploymentId:randomUUID()},{...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,databaseBindingSha256},now)).toThrow('SERVICE_INTEREST_PROOF_BINDING_MISMATCH');
  expect(()=>validateServiceInterestEvidence({...evidence,backupId:'other'},parsed,'rollback_plan',now)).toThrow('SERVICE_INTEREST_EVIDENCE_BINDING_MISMATCH');
  const changedExpected=validateServiceInterestProof({...proof,expectedStateSha256:'1'.repeat(64)},{...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,databaseBindingSha256},now);
  expect(()=>validateServiceInterestEvidence(evidence,changedExpected,'rollback_plan',now)).toThrow('SERVICE_INTEREST_EVIDENCE_BINDING_MISMATCH');
 });
 it('keeps the runnable operator schema-only and source-bound',async()=>{
  const text=await readFile(new URL('../../scripts/release-service-interest.ts',import.meta.url),'utf8');for(const token of ['LS_SERVICE_INTEREST_RELEASE_PROOF_SHA256','backupReadback','isolatedRestore','rollbackPlan','assertContactOpsDatabaseIdentity','pg_try_advisory_lock','SERVICE_INTEREST_APPLY_READBACK_FAILED'])expect(text).toContain(token);
  const release=await readFile(new URL('../../src/db/service-interest-release.ts',import.meta.url),'utf8');expect(release).toContain("k.contype<>'n'");expect(release).toContain('readContactWorkSnapshot');expect(release).toContain('successorAbsent:true');
  expect(text).not.toContain('createServiceInterest(');expect(text).not.toContain('send_message');expect(text).not.toContain('switchAuthority');
  const migration=await readFile(new URL('../../migrations/0127_ls_service_interests.sql',import.meta.url));expect(createHash('sha256').update(migration).digest('hex')).toBe(SERVICE_INTEREST_MIGRATION.sha256);
  expect(serviceInterestSourceBundle([{path:'b',bytes:'2'},{path:'a',bytes:'1'}])).toBe(serviceInterestSourceBundle([{path:'a',bytes:'1'},{path:'b',bytes:'2'}]));
 });
});
