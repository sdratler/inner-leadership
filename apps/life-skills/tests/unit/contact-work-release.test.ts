import {describe,expect,it} from 'vitest';
import {CONTACT_WORK_BASELINE,CONTACT_WORK_MIGRATIONS,classifyContactWork,contactWorkPlan,type ContactWorkSnapshot} from '../../src/db/contact-work-release.ts';
import {validateContactWorkEvidence,validateContactWorkProof} from '../../src/db/contact-work-evidence.ts';
import type {Migration} from '../../src/db/migration-plan.ts';

const source=[['crm_followup'],['calendar_notice','crm_followup','form_review','report_review','session_observations','update_review'],['booking_followup','calendar_notice','creative_approval','crm_followup','form_review','intake_followup','publishing_failure','report_review','session_observations','update_review']] as const;
const snapshot=(stage:number):ContactWorkSnapshot=>({taskColumns:stage>=2?26:23,taskConstraints:stage>=2?16:14,sourceKinds:[...(stage>=3?source[2]:stage>=1?source[1]:source[0])],stateKinds:stage>=2?['open','in_progress','done']:['open','done'],historyActions:stage>=2?['created','completed','source_updated','source_resolved','managed']:['created','completed','source_updated','source_resolved'],sourceConstraintStrict:true,stateConstraintStrict:true,historyConstraintStrict:true,workflowColumns:stage>=2,workflowConstraints:stage>=2,effectiveDueIndex:stage>=2,taskHistoryImmutable:true,taskPermissions:true,callLinksAbsent:stage<4,callLinksSchema:stage>=4,callLinksForeignKeys:stage>=4,callLinksImmutable:stage>=4,callLinksPermissions:true,callLinksReferencesSound:true,leadCommandsAbsent:stage<5,leadCommandsSchema:stage>=5,leadCommandsForeignKeys:stage>=5,leadCommandsImmutable:stage>=5,leadCommandsPermissions:true,leadCommandsReferencesSound:true});
const files:Migration[]=[{name:'0001_ls_foundation.sql',checksum:'a'.repeat(64),sql:'select 1'},{...CONTACT_WORK_BASELINE,checksum:CONTACT_WORK_BASELINE.sha256,sql:'select 2'},...CONTACT_WORK_MIGRATIONS.map((item,index)=>({...item,checksum:item.sha256,sql:`select ${index+3}`}))];

describe('migration-before-code contact work gate',()=>{
 it('recognizes every resumable exact stage and only the remaining reviewed suffix',()=>{
  for(let stage=0;stage<=5;stage++){const history=files.slice(0,2+stage).map(({name,checksum})=>({name,checksum}));const plan=contactWorkPlan(files,history,snapshot(stage));expect(plan.stage).toBe(stage);expect(plan.pending.map(item=>item.name)).toEqual(CONTACT_WORK_MIGRATIONS.slice(stage).map(item=>item.name));}
 });
 it('refuses ledger/schema disagreement, unknown migration bytes and partial objects',()=>{
  expect(()=>contactWorkPlan(files,files.slice(0,3).map(({name,checksum})=>({name,checksum})),snapshot(0))).toThrow('CONTACT_WORK_LEDGER_STATE_CONFLICT');
  expect(()=>contactWorkPlan(files.map(file=>file.name===CONTACT_WORK_MIGRATIONS[2]!.name?{...file,checksum:'f'.repeat(64)}:file),files.slice(0,2).map(({name,checksum})=>({name,checksum})),snapshot(0))).toThrow('CONTACT_WORK_MIGRATION_SET_MISMATCH');
  expect(()=>classifyContactWork({...snapshot(4),callLinksImmutable:false})).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
  expect(()=>classifyContactWork({...snapshot(5),sourceKinds:[...source[2],'unauthorized_source']})).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
  expect(()=>classifyContactWork({...snapshot(5),stateConstraintStrict:false})).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
  expect(()=>classifyContactWork({...snapshot(5),leadCommandsReferencesSound:false})).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
  expect(()=>contactWorkPlan(files,files.slice(0,4).map(({name,checksum})=>({name,checksum})),{...snapshot(2),sourceKinds:[...source[2]]})).toThrow('CONTACT_WORK_LEDGER_STATE_CONFLICT');
 });
 it('keeps the release proof and exact-target fences in the operator source',async()=>{
  const text=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../../scripts/release-contact-work.ts',import.meta.url),'utf8'));
  for(const token of ['LS_CONTACT_WORK_RELEASE_PROOF_SHA256','baselinePreflight','backupReadback','isolatedRestore','rollbackPlan','RAILWAY_DEPLOYMENT_ID','CONTACT_WORK_DATABASE_BINDING_MISMATCH','assertContactOpsDatabaseIdentity','pg_try_advisory_lock','CONTACT_WORK_EVIDENCE_HASH_MISMATCH','CONTACT_WORK_BASELINE_STATE_CHANGED'])expect(text).toContain(token);
  expect(text).not.toContain('createContact');expect(text).not.toContain('send_message');expect(text).not.toContain('switchAuthority');
 });
 it('binds a short-lived proof and every evidence wrapper to one deployment, source and fence',()=>{
  const now=Date.parse('2026-10-07T20:00:00.000Z'),sha='a'.repeat(64),ids={projectId:'3b756632-1f66-4f75-a016-eabc37aa0d67',environmentId:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',appServiceId:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',databaseServiceId:'354b5343-9e83-45a7-b764-09396f14ae29'},deploymentId='11111111-1111-4111-8111-111111111111',reviewedCommit='b'.repeat(40),sourceBundleSha256=sha,databaseBindingSha256='c'.repeat(64);
  const proof={changeId:'LS-CONTACT-WORK-MIGRATIONS-20261007-01',scope:'private-app-contact-work-migrations-0119-0123',...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,manifestSha256:'d'.repeat(64),databaseBindingSha256,baselineStateSha256:'e'.repeat(64),expectedStateSha256:'e'.repeat(64),independentReview:'PASS',isolatedRestore:'PASS',backupId:'backup-private-1',controlFence:'f'.repeat(32),nonce:'22222222-2222-4222-8222-222222222222',issuedAt:'2026-10-07T19:55:00.000Z',expiresAt:'2026-10-07T20:55:00.000Z',evidence:{independentReview:{path:'C:\\private\\review.json',sha256:sha},baselinePreflight:{path:'C:\\private\\preflight.json',sha256:sha},backupReadback:{path:'C:\\private\\backup.json',sha256:sha},isolatedRestore:{path:'C:\\private\\restore.json',sha256:sha},rollbackPlan:{path:'C:\\private\\rollback.json',sha256:sha}}} as const;
  const parsed=validateContactWorkProof(proof,{...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,databaseBindingSha256},now);
  const evidence={changeId:proof.changeId,scope:proof.scope,kind:'independent_review',status:'PASS',...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,databaseBindingSha256,baselineStateSha256:proof.baselineStateSha256,backupId:proof.backupId,controlFence:proof.controlFence,nonce:proof.nonce,createdAt:'2026-10-07T19:54:00.000Z'} as const;
  expect(validateContactWorkEvidence(evidence,parsed,'independent_review',now).kind).toBe('independent_review');
  expect(()=>validateContactWorkProof({...proof,deploymentId:'33333333-3333-4333-8333-333333333333'},{...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,databaseBindingSha256},now)).toThrow('CONTACT_WORK_PROOF_BINDING_MISMATCH');
  expect(()=>validateContactWorkProof({...proof,expiresAt:'2026-10-08T20:55:00.000Z'},{...ids,deploymentId,mode:'apply',reviewedCommit,sourceBundleSha256,databaseBindingSha256},now)).toThrow('CONTACT_WORK_PROOF_EXPIRED');
  expect(()=>validateContactWorkEvidence({...evidence,controlFence:'z'.repeat(32)},parsed,'independent_review',now)).toThrow('CONTACT_WORK_EVIDENCE_BINDING_MISMATCH');
 });
});
