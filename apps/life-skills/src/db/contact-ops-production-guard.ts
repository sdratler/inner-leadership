import {createHash} from 'node:crypto';
import {planMigrations, type AppliedMigration, type Migration} from './migration-plan.ts';

export const CONTACT_OPS_MIGRATION = {
 name: '0101_ls_contact_operations.sql',
 sha256: 'a831604af25aa3ad713d7a1270007be9cebd315a8ac3a46cfa680a22b54dc25f',
} as const;

/** Catalog fingerprint from 0101 applied to a clean, disposable native PG17
 * restore. It covers every column and all 21 PK/FK/CHECK definitions across
 * profiles, legacy_links and command_receipts, not only object names. */
export const CONTACT_OPS_SCHEMA_CATALOG = {
 columns:25,constraints:21,
 sha256:'dde228b5f919a09ee668420517817eceb673d9a5764ed3a8552de8f980057222',
} as const;

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
 permanentTables:boolean;foreignKeysEnforced:boolean;foreignKeyReferencesSound:boolean;publicRevoked:boolean;
};

export function contactOpsSchemaCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==CONTACT_OPS_SCHEMA_CATALOG.columns||
    !Array.isArray(constraints)||constraints.length!==CONTACT_OPS_SCHEMA_CATALOG.constraints)return false;
 const digest=createHash('sha256').update(JSON.stringify({columns,constraints})).digest('hex');
 return digest===CONTACT_OPS_SCHEMA_CATALOG.sha256;
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
export function contactOpsProductionTarget(env:Record<string,string|undefined>,argv:readonly string[]):{mode:ContactOpsMigrationMode;url:string;deploymentId:string;databaseServiceId:string}{
 if(argv.length!==3 || !['--preflight','--apply'].includes(argv[0]??''))throw new Error('CONTACT_OPS_ARGUMENTS_INVALID');
 const expected=argv[1]?.match(/^--deployment=([0-9a-f-]{36})$/)?.[1];
 if(!expected || env.RAILWAY_DEPLOYMENT_ID!==expected)throw new Error('CONTACT_OPS_DEPLOYMENT_MISMATCH');
 const binding=argv[2]?.match(/^--database-binding=([0-9a-f-]{36}):([a-f0-9]{64})$/);
 if(!binding || binding[1]!==target.databaseServiceId)throw new Error('CONTACT_OPS_DATABASE_BINDING_REQUIRED');
 if(env.RAILWAY_PROJECT_ID!==target.projectId || env.RAILWAY_ENVIRONMENT_ID!==target.environmentId || env.RAILWAY_SERVICE_ID!==target.appServiceId || env.LS_APP_ORIGIN!==target.appOrigin)throw new Error('CONTACT_OPS_RAILWAY_TARGET_MISMATCH');
 if(env.LS_DATABASE_TLS!=='verify-full' || !env.LS_DATABASE_CA?.trim())throw new Error('CONTACT_OPS_TLS_REQUIRED');
 let url:URL;
 try{url=new URL(env.LS_DATABASE_URL??'');}catch{throw new Error('CONTACT_OPS_DATABASE_URL_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==target.databaseHost||url.port!=='5432'||url.pathname!==target.databaseName||url.search||url.hash||!url.username||!url.password)throw new Error('CONTACT_OPS_DATABASE_TARGET_MISMATCH');
 const actualDigest=createHash('sha256').update(env.LS_DATABASE_URL!,'utf8').digest('hex');
 if(binding[2]!==actualDigest)throw new Error('CONTACT_OPS_DATABASE_BINDING_MISMATCH');
 return {mode:argv[0]==='--apply'?'apply':'preflight',url:url.toString(),deploymentId:expected,databaseServiceId:target.databaseServiceId};
}

/** No partial/unknown schema and no surprise migration may be promoted. */
export function contactOpsMigrationState(files:readonly Migration[],history:readonly AppliedMigration[],objects:ContactOpsIntegrityObjects):'pending'|'applied'{
 if(files.at(-1)?.name!==CONTACT_OPS_MIGRATION.name || files.at(-1)?.checksum!==CONTACT_OPS_MIGRATION.sha256)throw new Error('CONTACT_OPS_MANIFEST_MISMATCH');
 const pending=planMigrations(files,history);
 const expectedKeys=['profiles','legacyLinks','commandReceipts','legacyIndex','profileProvenanceTrigger','markerCompatibilityTrigger','immutableDemoRecordTrigger','profileFunction','markerFunction','immutableFunction','canonicalPersonConstraint','canonicalConstraintDefinition','schemaCatalog','permanentTables','foreignKeysEnforced','foreignKeyReferencesSound','publicRevoked'].sort();
 if(JSON.stringify(Object.keys(objects).sort())!==JSON.stringify(expectedKeys))throw new Error('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
 const values=Object.values(objects);
 if(values.some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
 if(!objects.immutableDemoRecordTrigger||!objects.immutableFunction)throw new Error('CONTACT_OPS_BASELINE_PROVENANCE_MISSING');
 const newlyCreated=Object.entries(objects).filter(([key])=>key!=='immutableDemoRecordTrigger'&&key!=='immutableFunction').map(([,value])=>value);
 if(pending.length===1 && pending[0]?.name===CONTACT_OPS_MIGRATION.name && newlyCreated.every(value=>!value))return 'pending';
 if(pending.length===0 && values.every(Boolean))return 'applied';
 throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
}
