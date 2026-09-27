import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {assertContactOpsDatabaseIdentity,contactOpsCanonicalConstraint,contactOpsFunctionBody,contactOpsMigrationState,contactOpsProductionTarget,contactOpsSchemaCatalogMatches,contactOpsSourceBundle,CONTACT_OPS_MIGRATION,CONTACT_OPS_SOURCE_FILES,type ContactOpsIntegrityObjects} from '../../src/db/contact-ops-production-guard.ts';

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
const absent:ContactOpsIntegrityObjects={profiles:false,legacyLinks:false,commandReceipts:false,legacyIndex:false,profileProvenanceTrigger:false,markerCompatibilityTrigger:false,immutableDemoRecordTrigger:true,profileFunction:false,markerFunction:false,immutableFunction:true,canonicalPersonConstraint:false,canonicalConstraintDefinition:false,schemaCatalog:false,permanentTables:false,foreignKeysEnforced:false,foreignKeyReferencesSound:false,publicRevoked:false};
const present:ContactOpsIntegrityObjects={profiles:true,legacyLinks:true,commandReceipts:true,legacyIndex:true,profileProvenanceTrigger:true,markerFunction:true,markerCompatibilityTrigger:true,immutableDemoRecordTrigger:true,profileFunction:true,immutableFunction:true,canonicalPersonConstraint:true,canonicalConstraintDefinition:true,schemaCatalog:true,permanentTables:true,foreignKeysEnforced:true,foreignKeyReferencesSound:true,publicRevoked:true};

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
 });
 it('rejects incomplete or changed three-table schema catalogs',()=>{
  expect(contactOpsSchemaCatalogMatches([],[])).toBe(false);
  expect(contactOpsSchemaCatalogMatches(new Array(25).fill({}),new Array(21).fill({}))).toBe(false);
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
  expect(contactOpsMigrationState([prior,next],[prior],absent)).toBe('pending');
  expect(()=>contactOpsMigrationState([prior,next],[prior],{...absent,immutableDemoRecordTrigger:false})).toThrow('CONTACT_OPS_BASELINE_PROVENANCE_MISSING');
  expect(()=>contactOpsMigrationState([prior,next],[prior],{...absent,profiles:true})).toThrow();
  expect(()=>contactOpsMigrationState([prior,next],[],absent)).toThrow();
 });
 it('accepts an exact idempotent readback but rejects drift or missing objects',()=>{
  expect(contactOpsMigrationState([prior,next],[prior,{name:next.name,checksum:next.checksum}],present)).toBe('applied');
  for(const key of Object.keys(present) as (keyof ContactOpsIntegrityObjects)[])
   expect(()=>contactOpsMigrationState([prior,next],[prior,{name:next.name,checksum:next.checksum}],{...present,[key]:false})).toThrow();
  const incomplete={...present} as Partial<ContactOpsIntegrityObjects>;
  delete incomplete.commandReceipts;
  expect(()=>contactOpsMigrationState([prior,next],[prior,{name:next.name,checksum:next.checksum}],incomplete as ContactOpsIntegrityObjects)).toThrow('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
  expect(()=>contactOpsMigrationState([prior,{...next,checksum:'1'.repeat(64)}],[prior],absent)).toThrow();
 });
});
