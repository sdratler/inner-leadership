import {createHash} from 'node:crypto';
import {planMigrations, type AppliedMigration, type Migration} from './migration-plan.ts';

export const CONTACT_OPS_MIGRATION = {
 name: '0101_ls_contact_operations.sql',
 sha256: 'a831604af25aa3ad713d7a1270007be9cebd315a8ac3a46cfa680a22b54dc25f',
} as const;

const target = {
 projectId: '3b756632-1f66-4f75-a016-eabc37aa0d67',
 environmentId: 'dd91bd71-57cc-45e6-a75b-8c858491d7c7',
 appServiceId: '0267d061-f3ce-4a0a-82d4-ce133e4501e9',
 databaseServiceId: '354b5343-9e83-45a7-b764-09396f14ae29',
 databaseHost: 'postgres.railway.internal',
 databaseName: '/railway',
 appOrigin: 'https://life-skills.bneineviimacademy.org',
} as const;

export type ContactOpsMigrationMode = 'preflight'|'apply';
export type ContactOpsIntegrityObjects={
 profiles:boolean;legacyLinks:boolean;commandReceipts:boolean;legacyIndex:boolean;
 profileProvenanceTrigger:boolean;markerCompatibilityTrigger:boolean;canonicalPersonConstraint:boolean;
};

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
 const expectedKeys=['profiles','legacyLinks','commandReceipts','legacyIndex','profileProvenanceTrigger','markerCompatibilityTrigger','canonicalPersonConstraint'].sort();
 if(JSON.stringify(Object.keys(objects).sort())!==JSON.stringify(expectedKeys))throw new Error('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
 const values=Object.values(objects);
 if(values.some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
 if(pending.length===1 && pending[0]?.name===CONTACT_OPS_MIGRATION.name && values.every(value=>!value))return 'pending';
 if(pending.length===0 && values.every(Boolean))return 'applied';
 throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
}
