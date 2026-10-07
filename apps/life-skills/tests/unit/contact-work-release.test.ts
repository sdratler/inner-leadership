import {describe,expect,it} from 'vitest';
import {CONTACT_WORK_BASELINE,CONTACT_WORK_MIGRATIONS,classifyContactWork,contactWorkPlan,type ContactWorkSnapshot} from '../../src/db/contact-work-release.ts';
import type {Migration} from '../../src/db/migration-plan.ts';

const source=[['crm_followup'],['calendar_notice','crm_followup','form_review','report_review','session_observations','update_review'],['booking_followup','calendar_notice','creative_approval','crm_followup','form_review','intake_followup','publishing_failure','report_review','session_observations','update_review']] as const;
const snapshot=(stage:number):ContactWorkSnapshot=>({taskColumns:stage>=2?26:23,taskConstraints:stage>=2?16:14,sourceKinds:[...(stage>=3?source[2]:stage>=1?source[1]:source[0])],stateKinds:stage>=2?['open','in_progress','done']:['open','done'],historyActions:stage>=2?['created','completed','source_updated','source_resolved','managed']:['created','completed','source_updated','source_resolved'],workflowColumns:stage>=2,workflowConstraints:stage>=2,effectiveDueIndex:stage>=2,taskHistoryImmutable:true,taskPermissions:true,callLinksAbsent:stage<4,callLinksSchema:stage>=4,callLinksForeignKeys:stage>=4,callLinksImmutable:stage>=4,callLinksPermissions:true,callLinksReferencesSound:true,leadCommandsAbsent:stage<5,leadCommandsSchema:stage>=5,leadCommandsForeignKeys:stage>=5,leadCommandsImmutable:stage>=5,leadCommandsPermissions:true,leadCommandsReferencesSound:true});
const files:Migration[]=[{name:'0001_ls_foundation.sql',checksum:'a'.repeat(64),sql:'select 1'},{...CONTACT_WORK_BASELINE,checksum:CONTACT_WORK_BASELINE.sha256,sql:'select 2'},...CONTACT_WORK_MIGRATIONS.map((item,index)=>({...item,checksum:item.sha256,sql:`select ${index+3}`}))];

describe('migration-before-code contact work gate',()=>{
 it('recognizes every resumable exact stage and only the remaining reviewed suffix',()=>{
  for(let stage=0;stage<=5;stage++){const history=files.slice(0,2+stage).map(({name,checksum})=>({name,checksum}));const plan=contactWorkPlan(files,history,snapshot(stage));expect(plan.stage).toBe(stage);expect(plan.pending.map(item=>item.name)).toEqual(CONTACT_WORK_MIGRATIONS.slice(stage).map(item=>item.name));}
 });
 it('refuses ledger/schema disagreement, unknown migration bytes and partial objects',()=>{
  expect(()=>contactWorkPlan(files,files.slice(0,3).map(({name,checksum})=>({name,checksum})),snapshot(0))).toThrow('CONTACT_WORK_LEDGER_STATE_CONFLICT');
  expect(()=>contactWorkPlan(files.map(file=>file.name===CONTACT_WORK_MIGRATIONS[2]!.name?{...file,checksum:'f'.repeat(64)}:file),files.slice(0,2).map(({name,checksum})=>({name,checksum})),snapshot(0))).toThrow('CONTACT_WORK_MIGRATION_SET_MISMATCH');
  expect(()=>classifyContactWork({...snapshot(4),callLinksImmutable:false})).toThrow('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
  expect(()=>contactWorkPlan(files,files.slice(0,4).map(({name,checksum})=>({name,checksum})),{...snapshot(2),sourceKinds:[...source[2]]})).toThrow('CONTACT_WORK_LEDGER_STATE_CONFLICT');
 });
 it('keeps the release proof and exact-target fences in the operator source',async()=>{
  const text=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../../scripts/release-contact-work.ts',import.meta.url),'utf8'));
  for(const token of ['LS_CONTACT_WORK_RELEASE_PROOF_SHA256','baselinePreflightReceiptSha256','backupReadbackSha256','isolatedRestore','restoreReceiptSha256','rollbackPlanSha256','RAILWAY_DEPLOYMENT_ID','CONTACT_WORK_DATABASE_BINDING_MISMATCH','assertContactOpsDatabaseIdentity','pg_try_advisory_lock'])expect(text).toContain(token);
  expect(text).not.toContain('createContact');expect(text).not.toContain('send_message');expect(text).not.toContain('switchAuthority');
 });
});
