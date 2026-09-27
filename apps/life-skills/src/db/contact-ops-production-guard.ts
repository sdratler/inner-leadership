import {createHash} from 'node:crypto';
import {planMigrations, type AppliedMigration, type Migration} from './migration-plan.ts';

export const CONTACT_OPS_MIGRATION = {
 name: '0101_ls_contact_operations.sql',
 sha256: 'a831604af25aa3ad713d7a1270007be9cebd315a8ac3a46cfa680a22b54dc25f',
} as const;
const REVIEWED_TASKS_SUFFIX = {
 name: '0102_ls_internal_tasks.sql',
 sha256: 'dde1bbd0b8c92ea407611f4dffecc98bbd4dd295468509469919e5fa796565ce',
} as const;

/** Catalog fingerprint from 0101 applied to a clean, disposable native PG17
 * restore. It covers every column and all 21 PK/FK/CHECK definitions across
 * profiles, legacy_links and command_receipts, not only object names. PG18
 * additionally lists NOT NULL constraints; column attnotnull covers those. */
export const CONTACT_OPS_SCHEMA_CATALOG = {
 columns:25,constraints:21,
 sha256:'dde228b5f919a09ee668420517817eceb673d9a5764ed3a8552de8f980057222',
} as const;
/** 0097 plus 0100 baseline from the canonical PG18 service, cross-checked
 * against a PG17 restore. PostgreSQL 18 reports NOT NULL as catalog
 * constraints; attnotnull below is the version-independent check for those. */
const DEMO_RECORDS_BASELINE = {
 constraints:10,
 sha256:'50e7e9a7b86a521c711e65347440b29c7114a9e655b08c46002811b3a91240f2',
 columns:[
  ['workspace_id','uuid',true,null],['batch_id','text',true,null],
  ['entity_kind','text',true,null],['entity_key','text',true,null],
  ['source_key','text',true,null],['case_id','uuid',false,null],
  ['account_id','uuid',false,null],['marked_at','timestamp with time zone',true,'clock_timestamp()'],
 ] as const,
} as const;
export const CONTACT_OPS_SOURCE_FILES = [
 'migrations/0097_ls_demo_provenance.sql',
 'migrations/0101_ls_contact_operations.sql',
 'migrations/0102_ls_internal_tasks.sql',
 'migrations/manifest.json',
 'scripts/apply-contact-ops-production.ts',
 'src/db/contact-ops-production-guard.ts',
 'src/db/migration-plan.ts',
 'src/db/migration-runner.ts',
] as const;

const target = {
 projectId: '3b756632-1f66-4f75-a016-eabc37aa0d67',
 environmentId: 'dd91bd71-57cc-45e6-a75b-8c858491d7c7',
 appServiceId: '0267d061-f3ce-4a0a-82d4-ce133e4501e9',
 databaseServiceId: '354b5343-9e83-45a7-b764-09396f14ae29',
 // Read independently from the exact Railway database service and app DB
 // connection on 2026-09-27. A rebound URL must not select another cluster.
 databaseSystemIdentifier: '7682781321794240577',
 databaseHost: 'postgres.railway.internal',
 databaseName: '/railway',
 appOrigin: 'https://life-skills.bneineviimacademy.org',
} as const;

export type ContactOpsMigrationMode = 'preflight'|'apply';
export type ContactOpsIntegrityObjects={
 profiles:boolean;legacyLinks:boolean;commandReceipts:boolean;legacyIndex:boolean;
 profileProvenanceTrigger:boolean;markerCompatibilityTrigger:boolean;immutableDemoRecordTrigger:boolean;
 profileFunction:boolean;markerFunction:boolean;immutableFunction:boolean;
 canonicalPersonConstraint:boolean;canonicalConstraintDefinition:boolean;schemaCatalog:boolean;
 baselineRecordsCatalog:boolean;permanentTables:boolean;foreignKeysEnforced:boolean;foreignKeyReferencesSound:boolean;publicRevoked:boolean;
};

export function contactOpsSchemaCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==CONTACT_OPS_SCHEMA_CATALOG.columns||!Array.isArray(constraints))return false;
 const materialConstraints=contactOpsComparableConstraints(constraints);
 if(materialConstraints.length!==CONTACT_OPS_SCHEMA_CATALOG.constraints)return false;
 const digest=createHash('sha256').update(JSON.stringify({columns,constraints:materialConstraints})).digest('hex');
 return digest===CONTACT_OPS_SCHEMA_CATALOG.sha256;
}

/** PostgreSQL 18 exposes NOT NULL as contype=n while 17 does not. */
export function contactOpsComparableConstraints(constraints:readonly {type?:unknown}[]):readonly {type?:unknown}[]{
 return constraints.filter(row=>row?.type!=='n');
}

export function contactOpsBaselineRecordsMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==DEMO_RECORDS_BASELINE.columns.length||!Array.isArray(constraints))return false;
 if(!columns.every((row,index)=>{
  const expected=DEMO_RECORDS_BASELINE.columns[index];
  return row?.column===expected?.[0]&&row?.type===expected?.[1]&&row?.notNull===expected?.[2]&&
   row?.default===expected?.[3]&&row?.identity===''&&row?.generated==='';
 }))return false;
 const baseline=constraints.filter(row=>row?.type!=='n'&&row?.name!=='canonical_demo_person_key');
 if(baseline.length!==DEMO_RECORDS_BASELINE.constraints||
    baseline.some(row=>row?.validated!==true||typeof row?.definition!=='string'))return false;
 const normalized=baseline.map(row=>({name:row.name,type:row.type,validated:row.validated,definition:row.definition}));
 return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')===DEMO_RECORDS_BASELINE.sha256;
}

/** Match the checked-in, checksum-verified migration bodies, not mutable OIDs. */
export function contactOpsFunctionBody(files:readonly Migration[],migrationName:string,qualifiedName:string):string{
 const sql=files.find(file=>file.name===migrationName)?.sql;
 const marker=`CREATE FUNCTION ${qualifiedName}() RETURNS trigger LANGUAGE plpgsql AS $fn$`;
 const start=sql?.indexOf(marker)??-1;
 if(start<0||sql!.indexOf(marker,start+marker.length)>=0)throw new Error('CONTACT_OPS_FUNCTION_SOURCE_MISSING');
 const bodyStart=start+marker.length,end=sql!.indexOf('$fn$;',bodyStart);
 if(end<0)throw new Error('CONTACT_OPS_FUNCTION_SOURCE_MISSING');
 return sql!.slice(bodyStart,end);
}

/** pg_get_constraintdef adds formatting/casts around this one simple CHECK. */
export function contactOpsCanonicalConstraint(definition:unknown):boolean{
 if(typeof definition!=='string')return false;
 const normalized=definition.replace(/\s+/g,'').replace(/[()]/g,'').replace(/'person'::text/g,"'person'");
 return normalized==="CHECKentity_kind<>'person'ORentity_key=entity_key::uuid::text";
}

export function assertContactOpsDatabaseIdentity(systemIdentifier:unknown,ssl:unknown):void{
 if(ssl!==true)throw new Error('CONTACT_OPS_DATABASE_TLS_INACTIVE');
 if(String(systemIdentifier)!==target.databaseSystemIdentifier)throw new Error('CONTACT_OPS_DATABASE_IDENTITY_MISMATCH');
}

/** This is an exceptional, one-migration production gate. The normal migrate.ts
 * continues to reject non-loopback databases. A CLI argument cannot select a
 * different project, service, environment, deployment or database.
 */
export function contactOpsProductionTarget(env:Record<string,string|undefined>,argv:readonly string[]):{mode:ContactOpsMigrationMode;url:string;deploymentId:string;databaseServiceId:string;sourceBundleSha256:string}{
 if(argv.length!==4 || !['--preflight','--apply'].includes(argv[0]??''))throw new Error('CONTACT_OPS_ARGUMENTS_INVALID');
 const expected=argv[1]?.match(/^--deployment=([0-9a-f-]{36})$/)?.[1];
 if(!expected || env.RAILWAY_DEPLOYMENT_ID!==expected)throw new Error('CONTACT_OPS_DEPLOYMENT_MISMATCH');
 const binding=argv[2]?.match(/^--database-binding=([0-9a-f-]{36}):([a-f0-9]{64})$/);
 if(!binding || binding[1]!==target.databaseServiceId)throw new Error('CONTACT_OPS_DATABASE_BINDING_REQUIRED');
 const sourceBundleSha256=argv[3]?.match(/^--source-bundle=([a-f0-9]{64})$/)?.[1];
 if(!sourceBundleSha256)throw new Error('CONTACT_OPS_SOURCE_PROVENANCE_REQUIRED');
 if(env.RAILWAY_PROJECT_ID!==target.projectId || env.RAILWAY_ENVIRONMENT_ID!==target.environmentId || env.RAILWAY_SERVICE_ID!==target.appServiceId || env.LS_APP_ORIGIN!==target.appOrigin)throw new Error('CONTACT_OPS_RAILWAY_TARGET_MISMATCH');
 if(env.LS_DATABASE_TLS!=='verify-full' || !env.LS_DATABASE_CA?.trim())throw new Error('CONTACT_OPS_TLS_REQUIRED');
 let url:URL;
 try{url=new URL(env.LS_DATABASE_URL??'');}catch{throw new Error('CONTACT_OPS_DATABASE_URL_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==target.databaseHost||url.port!=='5432'||url.pathname!==target.databaseName||url.search||url.hash||!url.username||!url.password)throw new Error('CONTACT_OPS_DATABASE_TARGET_MISMATCH');
 const actualDigest=createHash('sha256').update(env.LS_DATABASE_URL!,'utf8').digest('hex');
 if(binding[2]!==actualDigest)throw new Error('CONTACT_OPS_DATABASE_BINDING_MISMATCH');
 return {mode:argv[0]==='--apply'?'apply':'preflight',url:url.toString(),deploymentId:expected,databaseServiceId:target.databaseServiceId,sourceBundleSha256};
}

/** The operator compares these bytes with the exact reviewed Git head using
 * authenticated Railway SSH before invoking the runner. This second check
 * prevents a different file set from being substituted between readback/run. */
export function contactOpsSourceBundle(entries:readonly {path:string;bytes:Uint8Array}[]):string{
 if(entries.length!==CONTACT_OPS_SOURCE_FILES.length||entries.some((entry,index)=>entry.path!==CONTACT_OPS_SOURCE_FILES[index]))throw new Error('CONTACT_OPS_SOURCE_INVENTORY_MISMATCH');
 const hash=createHash('sha256');
 for(const entry of entries){
  const normalized=new TextDecoder('utf-8',{fatal:true}).decode(entry.bytes).replace(/\r\n/g,'\n');
  hash.update(entry.path).update('\0').update(createHash('sha256').update(normalized).digest('hex')).update('\n');
 }
 return hash.digest('hex');
}

/** No partial/unknown schema and no surprise migration may be promoted. */
export function contactOpsMigrationState(files:readonly Migration[],history:readonly AppliedMigration[],objects:ContactOpsIntegrityObjects):'pending'|'applied'{
 const index=files.findIndex(file=>file.name===CONTACT_OPS_MIGRATION.name);
 if(index<0||files[index]?.checksum!==CONTACT_OPS_MIGRATION.sha256)throw new Error('CONTACT_OPS_MANIFEST_MISMATCH');
 const suffix=files.slice(index+1);
 if(suffix.length>1||suffix.some(file=>file.name!==REVIEWED_TASKS_SUFFIX.name||file.checksum!==REVIEWED_TASKS_SUFFIX.sha256))throw new Error('CONTACT_OPS_MANIFEST_MISMATCH');
 const pending=planMigrations(files,history);
 const expectedKeys=['profiles','legacyLinks','commandReceipts','legacyIndex','profileProvenanceTrigger','markerCompatibilityTrigger','immutableDemoRecordTrigger','profileFunction','markerFunction','immutableFunction','canonicalPersonConstraint','canonicalConstraintDefinition','schemaCatalog','baselineRecordsCatalog','permanentTables','foreignKeysEnforced','foreignKeyReferencesSound','publicRevoked'].sort();
 if(JSON.stringify(Object.keys(objects).sort())!==JSON.stringify(expectedKeys))throw new Error('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
 const values=Object.values(objects);
 if(values.some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
 if(!objects.immutableDemoRecordTrigger||!objects.immutableFunction||!objects.baselineRecordsCatalog)throw new Error('CONTACT_OPS_BASELINE_PROVENANCE_MISSING');
 const newlyCreated=Object.entries(objects).filter(([key])=>!['immutableDemoRecordTrigger','immutableFunction','baselineRecordsCatalog'].includes(key)).map(([,value])=>value);
 if(suffix.length===0 && pending.length===1 && pending[0]?.name===CONTACT_OPS_MIGRATION.name && newlyCreated.every(value=>!value))return 'pending';
 if(suffix.length===1 && pending.length===1 && pending[0]?.name===REVIEWED_TASKS_SUFFIX.name && values.every(Boolean))return 'pending';
 if(pending.length===0 && values.every(Boolean))return 'applied';
 throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
}
