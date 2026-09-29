import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {PRACTICE_SUBJECT_GUARDS_MIGRATION,practiceFunctionBody,type PracticeSubjectIntegrity} from '../../src/db/practice-subject-integrity.ts';
import {PROGRESS_REVIEW_REVISIONS_MIGRATION,type ProgressReviewIntegrity} from '../../src/db/progress-review-integrity.ts';
import {CONTACT_INBOUND_MIGRATION,contactInboundSchemaCatalogMatches,type ContactInboundIntegrityObjects} from '../../src/db/contact-ops-production-guard.ts';
import {assertContactOpsDatabaseIdentity,calendarAppendOnlyFunctionBody,contactAuthoritySchemaCatalogMatches,contactOpsBaselineRecordsMatches,contactOpsCanonicalConstraint,contactOpsComparableConstraints,contactOpsFunctionBody,contactOpsMigrationState,contactOpsProductionTarget,contactOpsSchemaCatalogMatches,contactOpsSourceBundle,internalTaskSchemaCatalogMatches,sourceTaskSchemaCatalogMatches,voiceRuleSchemaCatalogMatches,CONTACT_AUTHORITY_MIGRATION,CONTACT_OPS_MIGRATION,CONTACT_OPS_SOURCE_FILES,INTERNAL_TASKS_MIGRATION,SOURCE_TASKS_MIGRATION,VOICE_RULE_MIGRATION,type ContactAuthorityIntegrityObjects,type ContactOpsIntegrityObjects,type InternalTaskIntegrityObjects,type SourceTaskIntegrityObjects,type VoiceRuleIntegrityObjects} from '../../src/db/contact-ops-production-guard.ts';

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
const bindingHash=createHash('sha256').update(good.LS_DATABASE_URL).digest('hex');
const args=['--apply',`--deployment=${deployment}`,`--database-binding=354b5343-9e83-45a7-b764-09396f14ae29:${bindingHash}`,`--source-bundle=${'a'.repeat(64)}`];
const prior={name:'0100_ls_demo_prospect_marker_gate.sql',checksum:'0'.repeat(64),sql:'SELECT 1;'};
const next={name:CONTACT_OPS_MIGRATION.name,checksum:CONTACT_OPS_MIGRATION.sha256,sql:'CREATE SCHEMA ls_contact_ops;'};
const taskSuffix={name:INTERNAL_TASKS_MIGRATION.name,checksum:INTERNAL_TASKS_MIGRATION.sha256,sql:'CREATE TABLE ls_calendar.tasks(id uuid);'};
const sourceSuffix={name:SOURCE_TASKS_MIGRATION.name,checksum:SOURCE_TASKS_MIGRATION.sha256,sql:'ALTER TABLE ls_calendar.tasks ADD COLUMN source_digest text;'};
const voiceSuffix={name:VOICE_RULE_MIGRATION.name,checksum:VOICE_RULE_MIGRATION.sha256,sql:'CREATE SCHEMA ls_content_voice;'};
const authoritySuffix={name:CONTACT_AUTHORITY_MIGRATION.name,checksum:CONTACT_AUTHORITY_MIGRATION.sha256,sql:'CREATE TABLE ls_contact_ops.cutover(workspace_id uuid);'};
const absent:ContactOpsIntegrityObjects={profiles:false,legacyLinks:false,commandReceipts:false,legacyIndex:false,profileProvenanceTrigger:false,markerCompatibilityTrigger:false,immutableDemoRecordTrigger:true,profileFunction:false,markerFunction:false,immutableFunction:true,canonicalPersonConstraint:false,canonicalConstraintDefinition:false,schemaCatalog:false,baselineRecordsCatalog:true,permanentTables:false,foreignKeysEnforced:false,foreignKeyReferencesSound:false,publicRevoked:false};
const present:ContactOpsIntegrityObjects={profiles:true,legacyLinks:true,commandReceipts:true,legacyIndex:true,profileProvenanceTrigger:true,markerFunction:true,markerCompatibilityTrigger:true,immutableDemoRecordTrigger:true,profileFunction:true,immutableFunction:true,canonicalPersonConstraint:true,canonicalConstraintDefinition:true,schemaCatalog:true,baselineRecordsCatalog:true,permanentTables:true,foreignKeysEnforced:true,foreignKeyReferencesSound:true,publicRevoked:true};
const taskAbsent:InternalTaskIntegrityObjects={tables:false,columns:false,constraints:false,schemaCatalog:false,foreignKeys:false,dueIndex:false,historyImmutable:false,appendOnlyFunction:true,publicRevoked:false};
const taskPresent:InternalTaskIntegrityObjects={tables:true,columns:true,constraints:true,schemaCatalog:true,foreignKeys:true,dueIndex:true,historyImmutable:true,appendOnlyFunction:true,publicRevoked:true};
const sourcePending:SourceTaskIntegrityObjects={sourceIndex:false,baseCatalog:true,sourceCatalog:false};
const sourceApplied:SourceTaskIntegrityObjects={sourceIndex:true,baseCatalog:false,sourceCatalog:true};
const voiceAbsent:VoiceRuleIntegrityObjects={namespaceAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,ownerIndex:false,historyImmutable:false,publicRevoked:false};
const voicePresent:VoiceRuleIntegrityObjects={namespaceAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,ownerIndex:true,historyImmutable:true,publicRevoked:true};
const authorityAbsent:ContactAuthorityIntegrityObjects={objectsAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,historyImmutable:false,appendOnlyFunction:false,publicRevoked:false,referencesSound:false};
const authorityPresent:ContactAuthorityIntegrityObjects={objectsAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,historyImmutable:true,appendOnlyFunction:true,publicRevoked:true,referencesSound:true};
const inboundSuffix={name:CONTACT_INBOUND_MIGRATION.name,checksum:CONTACT_INBOUND_MIGRATION.sha256,sql:'CREATE TABLE ls_contact_ops.message_receipts(workspace_id uuid);'};
const inboundAbsent:ContactInboundIntegrityObjects={objectsAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,historyImmutable:false,appendOnlyFunction:false,publicRevoked:false,referencesSound:false};
const inboundPresent:ContactInboundIntegrityObjects={objectsAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,historyImmutable:true,appendOnlyFunction:true,publicRevoked:true,referencesSound:true};

describe('registered native CRM production migration gate',()=>{
 it('binds a complete ordered reviewed source-file bundle',()=>{
  const entries=CONTACT_OPS_SOURCE_FILES.map(path=>({path,bytes:Buffer.from('synthetic\r\n')}));
  expect(contactOpsSourceBundle(entries)).toMatch(/^[a-f0-9]{64}$/);
  expect(contactOpsSourceBundle(entries)).toBe(contactOpsSourceBundle(entries.map(entry=>({...entry,bytes:Buffer.from('synthetic\n')}))));
  expect(contactOpsSourceBundle(entries.map((entry,index)=>index===0?{...entry,bytes:Buffer.from('changed')}:entry))).not.toBe(contactOpsSourceBundle(entries));
  expect(()=>contactOpsSourceBundle(entries.slice(1))).toThrow('CONTACT_OPS_SOURCE_INVENTORY_MISMATCH');
 });
 it('compares canonical marker expression and exact migration function bodies',()=>{
  expect(contactOpsCanonicalConstraint("CHECK (((entity_kind <> 'person'::text) OR (entity_key = ((entity_key)::uuid)::text)))")).toBe(true);
  expect(contactOpsCanonicalConstraint('CHECK (true)')).toBe(false);
  const body='\nBEGIN\n RETURN NEW;\nEND;\n';
  const files=[{name:'0097_ls_demo_provenance.sql',checksum:'0'.repeat(64),sql:`CREATE FUNCTION ls_demo.prevent_marker_change() RETURNS trigger LANGUAGE plpgsql AS $fn$${body}$fn$;`}];
  expect(contactOpsFunctionBody(files,files[0]!.name,'ls_demo.prevent_marker_change')).toBe(body);
  expect(()=>contactOpsFunctionBody(files,files[0]!.name,'ls_demo.other')).toThrow('CONTACT_OPS_FUNCTION_SOURCE_MISSING');
  const calendar=[{name:'0030_ls_calendar_attendance_20260907.sql',checksum:'0'.repeat(64),sql:"CREATE FUNCTION ls_calendar.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$\nBEGIN RAISE EXCEPTION 'append_only'; END $$;"}];
  expect(calendarAppendOnlyFunctionBody(calendar)).toContain("RAISE EXCEPTION 'append_only'");
  expect(()=>calendarAppendOnlyFunctionBody([])).toThrow('CONTACT_OPS_TASK_FUNCTION_SOURCE_MISSING');
 });
 it('rejects incomplete or changed three-table schema catalogs',()=>{
  expect(contactOpsSchemaCatalogMatches([],[])).toBe(false);
  expect(contactOpsSchemaCatalogMatches(new Array(25).fill({}),new Array(21).fill({}))).toBe(false);
  expect(internalTaskSchemaCatalogMatches(new Array(20).fill({}),new Array(13).fill({}))).toBe(false);
  expect(sourceTaskSchemaCatalogMatches(new Array(23).fill({}),new Array(14).fill({}))).toBe(false);
  expect(voiceRuleSchemaCatalogMatches(new Array(31).fill({}),new Array(23).fill({}))).toBe(false);
  expect(contactAuthoritySchemaCatalogMatches(new Array(14).fill({}),new Array(15).fill({}))).toBe(false);
  expect(contactInboundSchemaCatalogMatches([],[])).toBe(false);
  expect(contactInboundSchemaCatalogMatches(new Array(10).fill({}),new Array(9).fill({}))).toBe(false);
  expect(contactOpsBaselineRecordsMatches([],[])).toBe(false);
  expect(contactOpsComparableConstraints([{type:'c'},{type:'n'},{type:'f'}])).toEqual([{type:'c'},{type:'f'}]);
 });
 it('binds the observed TLS PostgreSQL cluster to the independently read canonical database service',()=>{
  expect(()=>assertContactOpsDatabaseIdentity('7682781321794240577',true)).not.toThrow();
  expect(()=>assertContactOpsDatabaseIdentity('7682781321794240578',true)).toThrow('CONTACT_OPS_DATABASE_IDENTITY_MISMATCH');
  expect(()=>assertContactOpsDatabaseIdentity('7682781321794240577',false)).toThrow('CONTACT_OPS_DATABASE_TLS_INACTIVE');
 });
 it('admits only the exact existing deployment and database for a named mode',()=>{
  expect(contactOpsProductionTarget(good,args)).toMatchObject({mode:'apply',deploymentId:deployment});
  expect(contactOpsProductionTarget(good,['--preflight',args[1]!,args[2]!,args[3]!]).mode).toBe('preflight');
 });
 it.each(['RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','RAILWAY_DEPLOYMENT_ID'] as const)('rejects a changed %s',key=>{
  expect(()=>contactOpsProductionTarget({...good,[key]:'different'},args)).toThrow();
 });
 it('rejects a different app origin',()=>expect(()=>contactOpsProductionTarget({...good,LS_APP_ORIGIN:'https://other.example'},args)).toThrow());
 it('requires the authenticated canonical database service binding digest',()=>{
  expect(()=>contactOpsProductionTarget(good,args.slice(0,2))).toThrow();
  expect(()=>contactOpsProductionTarget(good,args.slice(0,3))).toThrow('CONTACT_OPS_ARGUMENTS_INVALID');
  expect(()=>contactOpsProductionTarget(good,[args[0]!,args[1]!,`--database-binding=00000000-0000-0000-0000-000000000000:${bindingHash}`,args[3]!])).toThrow();
  expect(()=>contactOpsProductionTarget(good,[args[0]!,args[1]!,`--database-binding=354b5343-9e83-45a7-b764-09396f14ae29:${'0'.repeat(64)}`,args[3]!])).toThrow();
  expect(()=>contactOpsProductionTarget({...good,LS_DATABASE_URL:'postgresql://test:replacement@postgres.railway.internal:5432/railway'},args)).toThrow('CONTACT_OPS_DATABASE_BINDING_MISMATCH');
 });
 it.each(['postgresql://test:synthetic@other.railway.internal:5432/railway','postgresql://test:synthetic@postgres.railway.internal:5432/other','postgresql://test:synthetic@postgres.railway.internal:5432/railway?sslmode=disable'])('rejects a different database target',url=>{
  expect(()=>contactOpsProductionTarget({...good,LS_DATABASE_URL:url},args)).toThrow();
 });
 it('rejects disabled/unverifiable TLS and implicit invocation',()=>{
  expect(()=>contactOpsProductionTarget({...good,LS_DATABASE_TLS:'disable'},args)).toThrow();
  expect(()=>contactOpsProductionTarget({...good,LS_DATABASE_CA:''},args)).toThrow();
  expect(()=>contactOpsProductionTarget(good,[])).toThrow();
  expect(()=>contactOpsProductionTarget(good,['--apply','--deployment=00000000-0000-0000-0000-000000000000',args[2]!,args[3]!])).toThrow();
 });
 it('requires exactly one pending migration and absent objects before apply',()=>{
  expect(contactOpsMigrationState([prior,next],[prior],absent,taskAbsent)).toBe('pending');
  expect(()=>contactOpsMigrationState([prior,next],[prior],{...absent,immutableDemoRecordTrigger:false},taskAbsent)).toThrow('CONTACT_OPS_BASELINE_PROVENANCE_MISSING');
  expect(()=>contactOpsMigrationState([prior,next],[prior],{...absent,baselineRecordsCatalog:false},taskAbsent)).toThrow('CONTACT_OPS_BASELINE_PROVENANCE_MISSING');
  expect(()=>contactOpsMigrationState([prior,next],[prior],{...absent,profiles:true},taskAbsent)).toThrow();
  expect(()=>contactOpsMigrationState([prior,next],[],absent,taskAbsent)).toThrow();
 });
 it('accepts an exact idempotent readback but rejects drift or missing objects',()=>{
  const through0101=[prior,next].map(({name,checksum})=>({name,checksum}));
  expect(contactOpsMigrationState([prior,next],[prior,{name:next.name,checksum:next.checksum}],present,taskAbsent)).toBe('applied');
  expect(contactOpsMigrationState([prior,next,taskSuffix],[prior,next,taskSuffix].map(({name,checksum})=>({name,checksum})),present,taskPresent)).toBe('applied');
  expect(contactOpsMigrationState([prior,next,taskSuffix],through0101,present,taskAbsent)).toBe('pending');
  expect(()=>contactOpsMigrationState([prior,next,taskSuffix],through0101,{...present,profiles:false},taskAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState([prior,next,taskSuffix],through0101,present,{...taskAbsent,tables:true})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState([prior,next,taskSuffix],[prior],absent,taskAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  for(const key of Object.keys(taskPresent) as (keyof InternalTaskIntegrityObjects)[])
   expect(()=>contactOpsMigrationState([prior,next,taskSuffix],[prior,next,taskSuffix].map(({name,checksum})=>({name,checksum})),present,{...taskPresent,[key]:false})).toThrow();
  expect(()=>contactOpsMigrationState([prior,next,taskSuffix],through0101,present,{...taskAbsent,appendOnlyFunction:false})).toThrow('CONTACT_OPS_TASK_BASELINE_FUNCTION_MISSING');
  expect(()=>contactOpsMigrationState([prior,next,{...taskSuffix,checksum:'1'.repeat(64)}],[prior,next,taskSuffix].map(({name,checksum})=>({name,checksum})),present,taskPresent)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
  expect(()=>contactOpsMigrationState([prior,next,taskSuffix,{...taskSuffix,name:'0103_unreviewed.sql'}],[prior,next,taskSuffix].map(({name,checksum})=>({name,checksum})),present,taskPresent)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
  for(const key of Object.keys(present) as (keyof ContactOpsIntegrityObjects)[])
   expect(()=>contactOpsMigrationState([prior,next],[prior,{name:next.name,checksum:next.checksum}],{...present,[key]:false},taskAbsent)).toThrow();
  const incomplete={...present} as Partial<ContactOpsIntegrityObjects>;
  delete incomplete.commandReceipts;
  expect(()=>contactOpsMigrationState([prior,next],[prior,{name:next.name,checksum:next.checksum}],incomplete as ContactOpsIntegrityObjects,taskAbsent)).toThrow('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
  expect(()=>contactOpsMigrationState([prior,{...next,checksum:'1'.repeat(64)}],[prior],absent,taskAbsent)).toThrow();
 });
 it('admits only the exact 0103 suffix after 0102, with source catalog and unique index readback',()=>{
  const files=[prior,next,taskSuffix,sourceSuffix];
  const through0102=[prior,next,taskSuffix].map(({name,checksum})=>({name,checksum}));
  expect(contactOpsMigrationState(files,through0102,present,taskPresent,sourcePending)).toBe('pending');
  expect(contactOpsMigrationState(files,[...through0102,{name:sourceSuffix.name,checksum:sourceSuffix.checksum}],present,taskPresent,sourceApplied)).toBe('applied');
  expect(()=>contactOpsMigrationState(files,through0102,present,taskPresent,{...sourcePending,sourceIndex:true})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState(files,through0102,present,taskPresent,{...sourcePending,baseCatalog:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState(files,through0102,present,taskPresent)).toThrow('CONTACT_OPS_SOURCE_TASK_READBACK_INVALID');
  expect(()=>contactOpsMigrationState(files,[prior,next].map(({name,checksum})=>({name,checksum})),present,taskPresent,sourcePending)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState(files,through0102,present,taskPresent,{...sourceApplied,sourceIndex:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState([prior,next,taskSuffix,{...sourceSuffix,checksum:'0'.repeat(64)}],through0102,present,taskPresent,sourcePending)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
 });
 it('admits only exact 0104 after the verified 0103 baseline and refuses partial voice schema',()=>{
  const files=[prior,next,taskSuffix,sourceSuffix,voiceSuffix];
  const through0103=[prior,next,taskSuffix,sourceSuffix].map(({name,checksum})=>({name,checksum}));
  expect(contactOpsMigrationState(files,through0103,present,taskPresent,sourceApplied,voiceAbsent)).toBe('pending');
  expect(contactOpsMigrationState(files,[...through0103,voiceSuffix],present,taskPresent,sourceApplied,voicePresent)).toBe('applied');
  expect(()=>contactOpsMigrationState(files,through0103,present,taskPresent,sourceApplied)).toThrow('CONTACT_OPS_VOICE_READBACK_INVALID');
  expect(()=>contactOpsMigrationState(files,through0103,present,taskPresent,sourceApplied,{...voiceAbsent,namespaceAbsent:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  for(const key of Object.keys(voicePresent).filter(key=>key!=='namespaceAbsent') as (keyof VoiceRuleIntegrityObjects)[]){
   expect(()=>contactOpsMigrationState(files,through0103,present,taskPresent,sourceApplied,{...voiceAbsent,[key]:true})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   expect(()=>contactOpsMigrationState(files,[...through0103,voiceSuffix],present,taskPresent,sourceApplied,{...voicePresent,[key]:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  }
  expect(()=>contactOpsMigrationState(files,through0103,present,taskPresent,sourcePending,voiceAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState([prior,next,taskSuffix,sourceSuffix,{...voiceSuffix,checksum:'0'.repeat(64)}],through0103,present,taskPresent,sourceApplied,voiceAbsent)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
  expect(()=>contactOpsMigrationState([...files,{...voiceSuffix,name:'0105_unreviewed.sql'}],through0103,present,taskPresent,sourceApplied,voiceAbsent)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
 });
 it('admits only exact 0105 with complete prior baseline and strict absent/applied catalog proof',()=>{
  const before=[prior,next,taskSuffix,sourceSuffix,voiceSuffix],files=[...before,authoritySuffix];
  expect(contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent,authorityAbsent)).toBe('pending');
  expect(contactOpsMigrationState(files,files,present,taskPresent,sourceApplied,voicePresent,authorityPresent)).toBe('applied');
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent)).toThrow('CONTACT_OPS_AUTHORITY_READBACK_INVALID');
  for(const key of Object.keys(authorityPresent).filter(key=>key!=='objectsAbsent') as (keyof ContactAuthorityIntegrityObjects)[]){
   expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent,{...authorityAbsent,[key]:true})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   expect(()=>contactOpsMigrationState(files,files,present,taskPresent,sourceApplied,voicePresent,{...authorityPresent,[key]:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  }
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent,{...authorityAbsent,objectsAbsent:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState(files,files,present,taskPresent,sourceApplied,voicePresent,{...authorityPresent,objectsAbsent:true})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voiceAbsent,authorityAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  for(const key of Object.keys(voicePresent).filter(key=>key!=='namespaceAbsent') as (keyof VoiceRuleIntegrityObjects)[])
   expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,{...voicePresent,[key]:false},authorityAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  for(const key of Object.keys(present) as (keyof ContactOpsIntegrityObjects)[])
   expect(()=>contactOpsMigrationState(files,before,{...present,[key]:false},taskPresent,sourceApplied,voicePresent,authorityAbsent)).toThrow();
  const incomplete={...authorityPresent} as Partial<ContactAuthorityIntegrityObjects>;delete incomplete.referencesSound;
  expect(()=>contactOpsMigrationState(files,files,present,taskPresent,sourceApplied,voicePresent,incomplete as ContactAuthorityIntegrityObjects)).toThrow('CONTACT_OPS_AUTHORITY_READBACK_INVALID');
  expect(()=>contactOpsMigrationState(files,files,present,taskPresent,sourceApplied,voicePresent,{...authorityPresent,extra:true} as ContactAuthorityIntegrityObjects)).toThrow('CONTACT_OPS_AUTHORITY_READBACK_INVALID');
  expect(()=>contactOpsMigrationState(files,files,present,taskPresent,sourceApplied,voicePresent,{...authorityPresent,tables:1} as unknown as ContactAuthorityIntegrityObjects)).toThrow('CONTACT_OPS_AUTHORITY_READBACK_INVALID');
  expect(()=>contactOpsMigrationState([...before,{...authoritySuffix,checksum:'0'.repeat(64)}],before,present,taskPresent,sourceApplied,voicePresent,authorityAbsent)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
  expect(()=>contactOpsMigrationState([...files,{...authoritySuffix,name:'0106_unreviewed.sql'}],files,present,taskPresent,sourceApplied,voicePresent,authorityPresent)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
  expect(()=>contactOpsMigrationState(files,before.slice(0,-1),present,taskPresent,sourceApplied,voicePresent,authorityAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
 });
 it('admits only exact 0106 after complete 0105 and rejects every partial or malformed receipt proof',()=>{
  const before=[prior,next,taskSuffix,sourceSuffix,voiceSuffix,authoritySuffix],files=[...before,inboundSuffix];
  const state=(history=before,proof:ContactInboundIntegrityObjects|undefined=inboundAbsent,oldProof=authorityPresent)=>
   contactOpsMigrationState(files,history,present,taskPresent,sourceApplied,voicePresent,oldProof,proof);
  expect(state()).toBe('pending');
  expect(state(files,inboundPresent)).toBe('applied');
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent,authorityPresent)).toThrow('CONTACT_OPS_INBOUND_READBACK_INVALID');
  for(const key of Object.keys(inboundPresent).filter(key=>key!=='objectsAbsent') as (keyof ContactInboundIntegrityObjects)[]){
   expect(()=>state(before,{...inboundAbsent,[key]:true})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   expect(()=>state(files,{...inboundPresent,[key]:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  }
  expect(()=>state(before,{...inboundAbsent,objectsAbsent:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>state(files,{...inboundPresent,objectsAbsent:true})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  const incomplete={...inboundPresent} as Partial<ContactInboundIntegrityObjects>;delete incomplete.referencesSound;
  expect(()=>state(files,incomplete as ContactInboundIntegrityObjects)).toThrow('CONTACT_OPS_INBOUND_READBACK_INVALID');
  expect(()=>state(files,{...inboundPresent,extra:true} as ContactInboundIntegrityObjects)).toThrow('CONTACT_OPS_INBOUND_READBACK_INVALID');
  expect(()=>state(files,{...inboundPresent,tables:1} as unknown as ContactInboundIntegrityObjects)).toThrow('CONTACT_OPS_INBOUND_READBACK_INVALID');
  expect(()=>state(before,inboundAbsent,authorityAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  for(const key of Object.keys(authorityPresent).filter(key=>key!=='objectsAbsent') as (keyof ContactAuthorityIntegrityObjects)[])
   expect(()=>state(before,inboundAbsent,{...authorityPresent,[key]:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>state(before.slice(0,-1))).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voiceAbsent,authorityPresent,inboundAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState(files,before,present,taskAbsent,sourceApplied,voicePresent,authorityPresent,inboundAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourcePending,voicePresent,authorityPresent,inboundAbsent)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>contactOpsMigrationState([...before,{...inboundSuffix,checksum:'0'.repeat(64)}],before,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundAbsent)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
  expect(()=>contactOpsMigrationState([...files,{...inboundSuffix,name:'0107_unreviewed.sql'}],files,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
 });
 it('admits only the exact participant-body suffix after EVERY old baseline check passes',()=>{
  const before=[prior,next,taskSuffix,sourceSuffix,voiceSuffix,authoritySuffix,inboundSuffix];
  const suffix={name:PRACTICE_SUBJECT_GUARDS_MIGRATION.name,checksum:PRACTICE_SUBJECT_GUARDS_MIGRATION.sha256,sql:'SELECT 1;'},files=[...before,suffix];
  const old:PracticeSubjectIntegrity={baselineFunctions:true,reviewedFunctions:false,immutableHistory:true,schemaCatalog:true,foreignKeys:true,permissions:true,referencesSound:true};
  const current:PracticeSubjectIntegrity={...old,baselineFunctions:false,reviewedFunctions:true};
  const state=(history=before,proof:PracticeSubjectIntegrity|undefined=old)=>contactOpsMigrationState(files,history,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,proof);
  expect(state()).toBe('pending');expect(state(files,current)).toBe('applied');
  expect(()=>state(before.slice(0,-1))).toThrow();
  expect(()=>state(before,current)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  expect(()=>state(files,old)).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  for(const key of ['immutableHistory','schemaCatalog','foreignKeys','permissions','referencesSound'] as const){
   expect(()=>state(before,{...old,[key]:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   expect(()=>state(files,{...current,[key]:false})).toThrow('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  }
  for(const proof of [{...old,baselineFunctions:false},{...old,reviewedFunctions:true}])expect(()=>state(before,proof)).toThrow();
  const incomplete={...old} as Partial<PracticeSubjectIntegrity>;delete incomplete.permissions;
  expect(()=>state(before,incomplete as PracticeSubjectIntegrity)).toThrow('CONTACT_OPS_PRACTICE_READBACK_INVALID');
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent)).toThrow('CONTACT_OPS_PRACTICE_READBACK_INVALID');
  expect(()=>state(before,{...old,extra:true} as PracticeSubjectIntegrity)).toThrow('CONTACT_OPS_PRACTICE_READBACK_INVALID');
  expect(()=>state(before,{...old,permissions:1} as unknown as PracticeSubjectIntegrity)).toThrow('CONTACT_OPS_PRACTICE_READBACK_INVALID');
  for(const key of Object.keys(present) as (keyof ContactOpsIntegrityObjects)[])expect(()=>contactOpsMigrationState(files,before,{...present,[key]:false},taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,old)).toThrow();
  for(const key of Object.keys(taskPresent) as (keyof InternalTaskIntegrityObjects)[])expect(()=>contactOpsMigrationState(files,before,present,{...taskPresent,[key]:false},sourceApplied,voicePresent,authorityPresent,inboundPresent,old)).toThrow();
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourcePending,voicePresent,authorityPresent,inboundPresent,old)).toThrow();
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voiceAbsent,authorityPresent,inboundPresent,old)).toThrow();
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent,authorityAbsent,inboundPresent,old)).toThrow();
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundAbsent,old)).toThrow();
  expect(()=>contactOpsMigrationState([...before,{...suffix,checksum:'0'.repeat(64)}],before,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,old)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
  expect(()=>contactOpsMigrationState([...files,{...suffix,name:'0108_unreviewed.sql'}],files,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,current)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
 });
 it('matches one exact CREATE OR REPLACE practice body without changing the older source matcher',()=>{
  const body='\nBEGIN RETURN NEW; END;\n',sql=`CREATE OR REPLACE FUNCTION ls_practice.check_completion_author()\nRETURNS trigger LANGUAGE plpgsql AS $fn$${body}$fn$;`;
  const file={name:PRACTICE_SUBJECT_GUARDS_MIGRATION.name,checksum:PRACTICE_SUBJECT_GUARDS_MIGRATION.sha256,sql};
  expect(practiceFunctionBody([file],file.name,'ls_practice.check_completion_author')).toBe(body);
  expect(()=>practiceFunctionBody([{...file,sql:sql+sql}],file.name,'ls_practice.check_completion_author')).toThrow('CONTACT_OPS_PRACTICE_FUNCTION_SOURCE_MISSING');
  expect(()=>practiceFunctionBody([file],file.name,'ls_practice.missing')).toThrow('CONTACT_OPS_PRACTICE_FUNCTION_SOURCE_MISSING');
  expect(()=>practiceFunctionBody([file],file.name,'ls_practice.any()')).toThrow('CONTACT_OPS_PRACTICE_FUNCTION_SOURCE_INVALID');
 });
 it('admits exact0108 only after all27 prior gates, exact baseline/current catalogs and private immutable revision guards',()=>{
  const practice:PracticeSubjectIntegrity={baselineFunctions:false,reviewedFunctions:true,immutableHistory:true,schemaCatalog:true,foreignKeys:true,permissions:true,referencesSound:true};
  const before=[prior,next,taskSuffix,sourceSuffix,voiceSuffix,authoritySuffix,inboundSuffix,{name:PRACTICE_SUBJECT_GUARDS_MIGRATION.name,checksum:PRACTICE_SUBJECT_GUARDS_MIGRATION.sha256,sql:'SELECT 1;'}];
  const suffix={name:PROGRESS_REVIEW_REVISIONS_MIGRATION.name,checksum:PROGRESS_REVIEW_REVISIONS_MIGRATION.sha256,sql:'SELECT 1;'},files=[...before,suffix];
  const old:ProgressReviewIntegrity={baselineCatalog:true,revisedCatalog:false,publishedGuards:true,revisionGuards:false,foreignKeys:true,permissions:true,referencesSound:true};
  const current:ProgressReviewIntegrity={...old,baselineCatalog:false,revisedCatalog:true,revisionGuards:true};
  const state=(history=before,proof:ProgressReviewIntegrity|undefined=old,basePractice=practice)=>contactOpsMigrationState(files,history,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,basePractice,proof);
  expect(state()).toBe('pending');expect(state(files,current)).toBe('applied');
  expect(()=>state(before.slice(0,-1))).toThrow();expect(()=>state(before,current)).toThrow();expect(()=>state(files,old)).toThrow();
  for(const key of ['publishedGuards','foreignKeys','permissions','referencesSound'] as const){expect(()=>state(before,{...old,[key]:false})).toThrow();expect(()=>state(files,{...current,[key]:false})).toThrow();}
  for(const key of ['immutableHistory','schemaCatalog','foreignKeys','permissions','referencesSound'] as const)expect(()=>state(before,old,{...practice,[key]:false})).toThrow();
  for(const proof of [{...old,baselineCatalog:false},{...old,revisedCatalog:true},{...old,revisionGuards:true},{...current,revisionGuards:false}])expect(()=>state(before,proof)).toThrow();
  const incomplete={...old} as Partial<ProgressReviewIntegrity>;delete incomplete.permissions;
  expect(()=>state(before,incomplete as ProgressReviewIntegrity)).toThrow('CONTACT_OPS_PROGRESS_READBACK_INVALID');
  expect(()=>state(before,{...old,extra:true} as ProgressReviewIntegrity)).toThrow('CONTACT_OPS_PROGRESS_READBACK_INVALID');
  expect(()=>state(before,{...old,permissions:1} as unknown as ProgressReviewIntegrity)).toThrow('CONTACT_OPS_PROGRESS_READBACK_INVALID');
  expect(()=>contactOpsMigrationState(files,before,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,practice)).toThrow('CONTACT_OPS_PROGRESS_READBACK_INVALID');
  for(const key of Object.keys(present) as (keyof ContactOpsIntegrityObjects)[])expect(()=>contactOpsMigrationState(files,before,{...present,[key]:false},taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,practice,old)).toThrow();
  for(const key of Object.keys(taskPresent) as (keyof InternalTaskIntegrityObjects)[])expect(()=>contactOpsMigrationState(files,before,present,{...taskPresent,[key]:false},sourceApplied,voicePresent,authorityPresent,inboundPresent,practice,old)).toThrow();
  for(const [source,voice,authority,inbound] of [[sourcePending,voicePresent,authorityPresent,inboundPresent],[sourceApplied,voiceAbsent,authorityPresent,inboundPresent],[sourceApplied,voicePresent,authorityAbsent,inboundPresent],[sourceApplied,voicePresent,authorityPresent,inboundAbsent]] as const)expect(()=>contactOpsMigrationState(files,before,present,taskPresent,source,voice,authority,inbound,practice,old)).toThrow();
  expect(()=>contactOpsMigrationState([...before,{...suffix,checksum:'0'.repeat(64)}],before,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,practice,old)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
  expect(()=>contactOpsMigrationState([...files,{...suffix,name:'0109_unreviewed.sql'}],files,present,taskPresent,sourceApplied,voicePresent,authorityPresent,inboundPresent,practice,current)).toThrow('CONTACT_OPS_MANIFEST_MISMATCH');
 });
});
