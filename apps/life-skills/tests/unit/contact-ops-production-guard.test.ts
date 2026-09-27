import {describe,expect,it} from 'vitest';
import {contactOpsMigrationState,contactOpsProductionTarget,CONTACT_OPS_MIGRATION} from '../../src/db/contact-ops-production-guard.ts';

const deployment='a2d9d868-53c4-4fdd-973c-21c4b6b8987d';
const good={
 RAILWAY_PROJECT_ID:'3b756632-1f66-4f75-a016-eabc37aa0d67',
 RAILWAY_ENVIRONMENT_ID:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',
 RAILWAY_SERVICE_ID:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',
 RAILWAY_DEPLOYMENT_ID:deployment,
 LS_APP_ORIGIN:'https://life-skills.bneineviimacademy.org',
 LS_DATABASE_URL:'postgresql://test:synthetic@postgres.railway.internal:5432/railway',
 LS_DATABASE_TLS:'verify-full',LS_DATABASE_CA:'synthetic-ca',
};
const args=['--apply',`--deployment=${deployment}`];
const prior={name:'0100_ls_demo_prospect_marker_gate.sql',checksum:'0'.repeat(64),sql:'SELECT 1;'};
const next={name:CONTACT_OPS_MIGRATION.name,checksum:CONTACT_OPS_MIGRATION.sha256,sql:'CREATE SCHEMA ls_contact_ops;'};

describe('registered native CRM production migration gate',()=>{
 it('admits only the exact existing deployment and database for a named mode',()=>{
  expect(contactOpsProductionTarget(good,args)).toMatchObject({mode:'apply',deploymentId:deployment});
  expect(contactOpsProductionTarget(good,['--preflight',args[1]!]).mode).toBe('preflight');
 });
 it.each(['RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','RAILWAY_DEPLOYMENT_ID'] as const)('rejects a changed %s',key=>{
  expect(()=>contactOpsProductionTarget({...good,[key]:'different'},args)).toThrow();
 });
 it('rejects a different app origin',()=>expect(()=>contactOpsProductionTarget({...good,LS_APP_ORIGIN:'https://other.example'},args)).toThrow());
 it.each(['postgresql://test:synthetic@other.railway.internal:5432/railway','postgresql://test:synthetic@postgres.railway.internal:5432/other','postgresql://test:synthetic@postgres.railway.internal:5432/railway?sslmode=disable'])('rejects a different database target',url=>{
  expect(()=>contactOpsProductionTarget({...good,LS_DATABASE_URL:url},args)).toThrow();
 });
 it('rejects disabled/unverifiable TLS and implicit invocation',()=>{
  expect(()=>contactOpsProductionTarget({...good,LS_DATABASE_TLS:'disable'},args)).toThrow();
  expect(()=>contactOpsProductionTarget({...good,LS_DATABASE_CA:''},args)).toThrow();
  expect(()=>contactOpsProductionTarget(good,[])).toThrow();
  expect(()=>contactOpsProductionTarget(good,['--apply','--deployment=00000000-0000-0000-0000-000000000000'])).toThrow();
 });
 it('requires exactly one pending migration and absent objects before apply',()=>{
  expect(contactOpsMigrationState([prior,next],[prior],{profiles:false,legacyLinks:false})).toBe('pending');
  expect(()=>contactOpsMigrationState([prior,next],[prior],{profiles:true,legacyLinks:false})).toThrow();
  expect(()=>contactOpsMigrationState([prior,next],[],{profiles:false,legacyLinks:false})).toThrow();
 });
 it('accepts an exact idempotent readback but rejects drift or missing objects',()=>{
  expect(contactOpsMigrationState([prior,next],[prior,{name:next.name,checksum:next.checksum}],{profiles:true,legacyLinks:true})).toBe('applied');
  expect(()=>contactOpsMigrationState([prior,next],[prior,{name:next.name,checksum:next.checksum}],{profiles:false,legacyLinks:true})).toThrow();
  expect(()=>contactOpsMigrationState([prior,{...next,checksum:'1'.repeat(64)}],[prior],{profiles:false,legacyLinks:false})).toThrow();
 });
});
