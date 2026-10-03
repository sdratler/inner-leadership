import {createHash} from 'node:crypto';
import {planMigrations, type AppliedMigration, type Migration} from './migration-plan.ts';
import {PRACTICE_SUBJECT_GUARDS_MIGRATION,type PracticeSubjectIntegrity} from './practice-subject-integrity.ts';
import {PROGRESS_REVIEW_REVISIONS_MIGRATION,type ProgressReviewIntegrity} from './progress-review-integrity.ts';
import {CONTACT_INBOUND_PROJECTION_MIGRATION,type ContactInboundProjectionIntegrity} from './contact-inbound-projection-integrity.ts';
import {CONTACT_OUTBOUND_PROJECTION_MIGRATION,type ContactOutboundProjectionIntegrity} from './contact-outbound-projection-integrity.ts';
import {PRACTICE_ADULT_COORDINATION_MIGRATION,type PracticeAdultCoordinationIntegrity} from './practice-adult-coordination-integrity.ts';
import {SCOPED_DISCLOSURE_USE_MIGRATION,SPEAKER_CORRECTION_RECEIPTS_MIGRATION,type ScopedDisclosureIntegrity,type SpeakerReceiptIntegrity} from './scoped-disclosure-integrity.ts';
import {PRACTICE_RESPONSIBILITY_MIGRATION,type PracticeResponsibilityIntegrity,type PracticeResponsibilityFrame} from './practice-responsibility-integrity.ts';
import {PRACTICE_REMINDER_MIGRATION,type PracticeReminderIntegrity} from './practice-reminder-integrity.ts';
import {ACQUISITION_CANDIDATES_MIGRATION,ACQUISITION_DECISIONS_MIGRATION,type ContactAcquisitionIntegrity} from './contact-acquisition-integrity.ts';

export const CONTACT_OPS_MIGRATION = {
 name: '0101_ls_contact_operations.sql',
 sha256: 'a831604af25aa3ad713d7a1270007be9cebd315a8ac3a46cfa680a22b54dc25f',
} as const;
export const INTERNAL_TASKS_MIGRATION = {
 name: '0102_ls_internal_tasks.sql',
 sha256: '61a99c4bc62d57eeb63c99de0b4482fcec10b019e128ee4b98abb8e92aeaaa7c',
} as const;
export const SOURCE_TASKS_MIGRATION = {
 name: '0103_ls_task_sources.sql',
 sha256: '190390847c7537ed80a2dd223c961514804f37068c1b672bc051ab5b4ef00f20',
} as const;
export const VOICE_RULE_MIGRATION = {
 name:'0104_ls_content_voice_corrections.sql',
 sha256:'421fe7e93e4d2ac9ff6685916a54c762183f36daeb1d18f9bd8d9d9dcc5fb579',
} as const;
export const VOICE_RULE_SCHEMA_CATALOG = {
 columns:31,constraints:23,
 sha256:'98d22c1e4e01428580476131f79df1fbcd66adac26d93a2ce1dd92fd4e7fd244',
} as const;
export const CONTACT_AUTHORITY_MIGRATION = {
 name:'0105_ls_contact_authority.sql',
 sha256:'2bc7c0f24d87b88ee30e4c0e89497ba8e9e8e4a993fa92386af919c58356a429',
} as const;
/** Fresh native PG17.11 catalog; PG18 NOT NULL entries are compared via columns. */
export const CONTACT_AUTHORITY_SCHEMA_CATALOG = {
 columns:14,constraints:15,
 sha256:'0c1c0c35d9223f11fc9023dfd30c9e5293a6ce99c7bff159455eec8cab574408',
} as const;
export const CONTACT_INBOUND_MIGRATION = {
 name:'0106_ls_contact_inbound_receipts.sql',
 sha256:'bf67d47e1f3bd6a23d098c4a78c50b0bd9c787719a1bc59a3b7c10a0f549a062',
} as const;
export const CONTACT_INBOUND_SCHEMA_CATALOG = {
 columns:10,constraints:9,
 sha256:'e3778480ecfde370d3af0493ee25099b47981124a6c1b413306d7f0383a58e19',
} as const;
export const INTERNAL_TASKS_SCHEMA_CATALOG = {
 columns:20,constraints:13,
 sha256:'f05bc3595900d94aa6e507b2689b21583b34d62393da24848a8f66538a1189c1',
} as const;
export const SOURCE_TASKS_SCHEMA_CATALOG = {
 columns:23,constraints:14,
 sha256:'7d33ce774d19e7dc9bbf6aca8960b52d7171f6b5de9bffc32b8b5d539963df8d',
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
 'migrations/0030_ls_calendar_attendance_20260907.sql',
 'migrations/0040_ls_home_practice_20260911.sql',
 'migrations/0050_forms_resources_qualitative_reviews_20260911.sql',
 'migrations/0097_ls_demo_provenance.sql',
 'migrations/0101_ls_contact_operations.sql',
 'migrations/0102_ls_internal_tasks.sql',
 'migrations/0103_ls_task_sources.sql',
 'migrations/0104_ls_content_voice_corrections.sql',
 'migrations/0105_ls_contact_authority.sql',
 'migrations/0106_ls_contact_inbound_receipts.sql',
 'migrations/0107_ls_practice_subject_guards.sql',
 'migrations/0108_ls_progress_review_revisions.sql',
 'migrations/0109_ls_contact_inbound_projection.sql',
 'migrations/0110_ls_contact_outbound_projection.sql',
 'migrations/0111_ls_adult_practice_coordination.sql',
 'migrations/0112_ls_scoped_disclosure_use.sql',
  'migrations/0113_ls_speaker_correction_receipts.sql',
  'migrations/0114_ls_practice_responsibilities.sql',
 'migrations/0115_ls_practice_notification_outbox.sql',
 'migrations/0116_ls_acquisition_candidates.sql',
 'migrations/0117_ls_acquisition_decisions.sql',
 'migrations/0093_ls_session_records.sql',
 'migrations/manifest.json',
 'scripts/apply-contact-ops-production.ts',
 'src/db/contact-ops-production-guard.ts',
 'src/db/contact-authority-integrity.ts',
 'src/db/contact-inbound-integrity.ts',
 'src/db/practice-subject-integrity.ts',
  'src/db/practice-adult-coordination-integrity.ts',
  'src/db/practice-responsibility-integrity.ts',
 'src/db/practice-reminder-integrity.ts',
 'src/db/contact-acquisition-integrity.ts',
 'src/db/scoped-disclosure-integrity.ts',
 'src/db/progress-review-integrity.ts',
 'src/db/contact-inbound-projection-integrity.ts',
 'src/db/contact-outbound-projection-integrity.ts',
 'src/db/migration-plan.ts',
 'src/db/migration-runner.ts',
 'scripts/release-intake.ts',
 'src/db/intake-migration-scope.ts',
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
export type InternalTaskIntegrityObjects={
 tables:boolean;columns:boolean;constraints:boolean;schemaCatalog:boolean;foreignKeys:boolean;
 dueIndex:boolean;historyImmutable:boolean;appendOnlyFunction:boolean;publicRevoked:boolean;
};
export type SourceTaskIntegrityObjects={sourceIndex:boolean;baseCatalog:boolean;sourceCatalog:boolean};
export type VoiceRuleIntegrityObjects={namespaceAbsent:boolean;tables:boolean;schemaCatalog:boolean;foreignKeys:boolean;
 ownerIndex:boolean;historyImmutable:boolean;publicRevoked:boolean};
export type ContactAuthorityIntegrityObjects={objectsAbsent:boolean;tables:boolean;schemaCatalog:boolean;foreignKeys:boolean;
 historyImmutable:boolean;appendOnlyFunction:boolean;publicRevoked:boolean;referencesSound:boolean};
export type ContactInboundIntegrityObjects=ContactAuthorityIntegrityObjects;

const allowedSuffix=[INTERNAL_TASKS_MIGRATION,SOURCE_TASKS_MIGRATION,VOICE_RULE_MIGRATION,CONTACT_AUTHORITY_MIGRATION,CONTACT_INBOUND_MIGRATION,PRACTICE_SUBJECT_GUARDS_MIGRATION,PROGRESS_REVIEW_REVISIONS_MIGRATION,CONTACT_INBOUND_PROJECTION_MIGRATION,CONTACT_OUTBOUND_PROJECTION_MIGRATION,PRACTICE_ADULT_COORDINATION_MIGRATION,SCOPED_DISCLOSURE_USE_MIGRATION,SPEAKER_CORRECTION_RECEIPTS_MIGRATION,PRACTICE_RESPONSIBILITY_MIGRATION,PRACTICE_REMINDER_MIGRATION,ACQUISITION_CANDIDATES_MIGRATION,ACQUISITION_DECISIONS_MIGRATION]as const;
/** An explicit registered prefix, never a bypass of the one-pending state gate.
 * The runner validates the FULL inventory/bundle first. A later ledger cannot
 * be treated as this shorter prefix; planMigrations still rejects that state. */
export function contactOpsMigrationPrefix(files:readonly Migration[],through?:string):readonly Migration[]{
 if(through===undefined)return files;
 const expected=[CONTACT_OPS_MIGRATION,...allowedSuffix].find(file=>file.name===through);
 const index=files.findIndex(file=>file.name===through);
 if(!expected||index<0||files[index]?.checksum!==expected.sha256)throw Error('CONTACT_OPS_MIGRATION_PREFIX_INVALID');
 return files.slice(0,index+1);
}

export function contactInboundSchemaCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==CONTACT_INBOUND_SCHEMA_CATALOG.columns||!Array.isArray(constraints))return false;
 const material=contactOpsComparableConstraints(constraints);
 return material.length===CONTACT_INBOUND_SCHEMA_CATALOG.constraints&&
  createHash('sha256').update(JSON.stringify({columns,constraints:material})).digest('hex')===CONTACT_INBOUND_SCHEMA_CATALOG.sha256;
}

export function contactAuthoritySchemaCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==CONTACT_AUTHORITY_SCHEMA_CATALOG.columns||!Array.isArray(constraints))return false;
 const material=contactOpsComparableConstraints(constraints);
 if(material.length!==CONTACT_AUTHORITY_SCHEMA_CATALOG.constraints)return false;
 return createHash('sha256').update(JSON.stringify({columns,constraints:material})).digest('hex')===CONTACT_AUTHORITY_SCHEMA_CATALOG.sha256;
}

export function voiceRuleSchemaCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==VOICE_RULE_SCHEMA_CATALOG.columns||!Array.isArray(constraints))return false;
 const material=contactOpsComparableConstraints(constraints);
 if(material.length!==VOICE_RULE_SCHEMA_CATALOG.constraints)return false;
 return createHash('sha256').update(JSON.stringify({columns,constraints:material})).digest('hex')===VOICE_RULE_SCHEMA_CATALOG.sha256;
}

export function internalTaskSchemaCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==INTERNAL_TASKS_SCHEMA_CATALOG.columns||
  !Array.isArray(constraints)||constraints.length!==INTERNAL_TASKS_SCHEMA_CATALOG.constraints)return false;
 return createHash('sha256').update(JSON.stringify({columns,constraints})).digest('hex')===INTERNAL_TASKS_SCHEMA_CATALOG.sha256;
}
export function sourceTaskSchemaCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==SOURCE_TASKS_SCHEMA_CATALOG.columns||
  !Array.isArray(constraints)||constraints.length!==SOURCE_TASKS_SCHEMA_CATALOG.constraints)return false;
 return createHash('sha256').update(JSON.stringify({columns,constraints})).digest('hex')===SOURCE_TASKS_SCHEMA_CATALOG.sha256;
}

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

export function calendarAppendOnlyFunctionBody(files:readonly Migration[]):string{
 const sql=files.find(file=>file.name==='0030_ls_calendar_attendance_20260907.sql')?.sql;
 const marker='CREATE FUNCTION ls_calendar.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$';
 const start=sql?.indexOf(marker)??-1;
 if(start<0||sql!.indexOf(marker,start+marker.length)>=0)throw new Error('CONTACT_OPS_TASK_FUNCTION_SOURCE_MISSING');
 const bodyStart=start+marker.length,end=sql!.indexOf('$$;',bodyStart);
 if(end<0)throw new Error('CONTACT_OPS_TASK_FUNCTION_SOURCE_MISSING');
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
export function contactOpsProductionTarget(env:Record<string,string|undefined>,argv:readonly string[]):{mode:ContactOpsMigrationMode;url:string;deploymentId:string;databaseServiceId:string;sourceBundleSha256:string;through?:string}{
 if(![4,5].includes(argv.length) || !['--preflight','--apply'].includes(argv[0]??''))throw new Error('CONTACT_OPS_ARGUMENTS_INVALID');
 const through=argv.length===5?argv[4]?.match(/^--through=(\d{4}_[a-z][a-z0-9_]*\.sql)$/)?.[1]:undefined;
 if(argv.length===5&&(!through||![CONTACT_OPS_MIGRATION,...allowedSuffix].some(file=>file.name===through)))throw Error('CONTACT_OPS_MIGRATION_PREFIX_INVALID');
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
 return {mode:argv[0]==='--apply'?'apply':'preflight',url:url.toString(),deploymentId:expected,databaseServiceId:target.databaseServiceId,sourceBundleSha256,...(through?{through}:{})};
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
export function contactOpsMigrationState(files:readonly Migration[],history:readonly AppliedMigration[],objects:ContactOpsIntegrityObjects,tasks:InternalTaskIntegrityObjects,source?:SourceTaskIntegrityObjects,voice?:VoiceRuleIntegrityObjects,authority?:ContactAuthorityIntegrityObjects,inbound?:ContactInboundIntegrityObjects,practice?:PracticeSubjectIntegrity,progress?:ProgressReviewIntegrity,projection?:ContactInboundProjectionIntegrity,outbound?:ContactOutboundProjectionIntegrity,adult?:PracticeAdultCoordinationIntegrity,disclosure?:ScopedDisclosureIntegrity,speakers?:SpeakerReceiptIntegrity,responsibility?:PracticeResponsibilityIntegrity,reminder?:PracticeReminderIntegrity,acquisition?:ContactAcquisitionIntegrity,decisions?:ContactAcquisitionIntegrity):'pending'|'applied'{
 // Only the FULL exact 0114 suffix may admit the separately observed current
 // practice frame. Older callers cannot inject it to bypass historical gates.
 let acceptedResponsibility:PracticeResponsibilityFrame|undefined;
 const inspect=(files:readonly Migration[],history:readonly AppliedMigration[],objects:ContactOpsIntegrityObjects,tasks:InternalTaskIntegrityObjects,source?:SourceTaskIntegrityObjects,voice?:VoiceRuleIntegrityObjects,authority?:ContactAuthorityIntegrityObjects,inbound?:ContactInboundIntegrityObjects,practice?:PracticeSubjectIntegrity,progress?:ProgressReviewIntegrity,projection?:ContactInboundProjectionIntegrity,outbound?:ContactOutboundProjectionIntegrity,adult?:PracticeAdultCoordinationIntegrity,disclosure?:ScopedDisclosureIntegrity,speakers?:SpeakerReceiptIntegrity):'pending'|'applied'=>{
 const index=files.findIndex(file=>file.name===CONTACT_OPS_MIGRATION.name);
 if(index<0||files[index]?.checksum!==CONTACT_OPS_MIGRATION.sha256)throw new Error('CONTACT_OPS_MANIFEST_MISMATCH');
 const suffix=files.slice(index+1);
 if(suffix.length>allowedSuffix.length||suffix.some((file,index)=>file.name!==allowedSuffix[index]?.name||file.checksum!==allowedSuffix[index]?.sha256))throw new Error('CONTACT_OPS_MANIFEST_MISMATCH');
  const pending=planMigrations(files,history);
  if(suffix.length>=14){
   const frame=suffix.length===14?reminder?.current:suffix.length===15?acquisition:decisions;
   const absentKey=suffix.length===14?'metadataAbsent':'objectsAbsent';
   const keys=suffix.length===14?['metadataAbsent','schemaCatalog','foreignKeys','permissions','reviewedFunctions','referencesSound']:['objectsAbsent','tables','schemaCatalog','foreignKeys','historyImmutable','reviewedFunctions','permissions','referencesSound'];
   const migration=allowedSuffix[suffix.length-1]!;
   const code=suffix.length===14?'PRACTICE_REMINDER_READBACK_INVALID':'CONTACT_ACQUISITION_READBACK_INVALID';
   if(!frame||JSON.stringify(Object.keys(frame).sort())!==JSON.stringify(keys.sort())||Object.values(frame).some(value=>typeof value!=='boolean'))throw Error(code);
   if(suffix.length===14){
    const priorKeys=['metadataAbsent','schemaCatalog','foreignKeys','permissions','reviewedFunctions','immutableHistory','referencesSound'].sort();
    if(!reminder||JSON.stringify(Object.keys(reminder).sort())!==JSON.stringify(['current','prior'])||!reminder.prior||JSON.stringify(Object.keys(reminder.prior).sort())!==JSON.stringify(priorKeys)||Object.values(reminder.prior).some(value=>typeof value!=='boolean'))throw Error(code);
    if(reminder.prior.metadataAbsent||Object.entries(reminder.prior).filter(([key])=>key!=='metadataAbsent').some(([,value])=>!value))throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   }
   // 0117 reuses the already-reviewed0116 immutable function; it must be
   // present even before the decision tables. No fabricated absence frame.
   if(suffix.length===16&&!frame.reviewedFunctions)throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   const created=Object.entries(frame).filter(([key])=>key!==absentKey&&(suffix.length!==16||key!=='reviewedFunctions')).map(([,value])=>value);
   const absent=Object.entries(frame).find(([key])=>key===absentKey)?.[1];
   const isPending=pending.length===1&&pending[0]?.name===migration.name&&absent===true&&created.every(value=>!value);
   const isApplied=pending.length===0&&absent===false&&created.every(Boolean);
   if(!isPending&&!isApplied)throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   if(inspect(files.slice(0,-1),history.filter(row=>row.name!==migration.name),objects,tasks,source,voice,authority,inbound,practice,progress,projection,outbound,adult,disclosure,speakers)!=='applied')throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   return isPending?'pending':'applied';
  }
  if(suffix.length===13){
   const priorKeys=['baselineFunctions','reviewedFunctions','immutableHistory','schemaCatalog','foreignKeys','permissions','referencesSound'].sort(),currentKeys=['metadataAbsent','reviewedFunctions','immutableHistory','schemaCatalog','foreignKeys','permissions','referencesSound'].sort();
   if(!responsibility||JSON.stringify(Object.keys(responsibility).sort())!==JSON.stringify(['current','prior'])||!responsibility.prior||!responsibility.current||JSON.stringify(Object.keys(responsibility.prior).sort())!==JSON.stringify(priorKeys)||JSON.stringify(Object.keys(responsibility.current).sort())!==JSON.stringify(currentKeys)||[...Object.values(responsibility.prior),...Object.values(responsibility.current)].some(value=>typeof value!=='boolean'))throw Error('PRACTICE_RESPONSIBILITY_READBACK_INVALID');
   const prior=responsibility.prior,current=responsibility.current;
   const isPending=pending.length===1&&pending[0]?.name===PRACTICE_RESPONSIBILITY_MIGRATION.name&&!prior.baselineFunctions&&prior.reviewedFunctions&&prior.immutableHistory&&prior.schemaCatalog&&prior.foreignKeys&&prior.permissions&&prior.referencesSound&&current.metadataAbsent&&current.immutableHistory&&Object.entries(current).filter(([key])=>!['metadataAbsent','immutableHistory'].includes(key)).every(([,value])=>!value);
   const isApplied=pending.length===0&&!current.metadataAbsent&&Object.entries(current).filter(([key])=>key!=='metadataAbsent').every(([,value])=>value)&&prior.immutableHistory&&Object.entries(prior).filter(([key])=>key!=='immutableHistory').every(([,value])=>!value);
   if(!isPending&&!isApplied)throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   if(isApplied)acceptedResponsibility=current;
   if(inspect(files.slice(0,-1),history.filter(row=>row.name!==PRACTICE_RESPONSIBILITY_MIGRATION.name),objects,tasks,source,voice,authority,inbound,practice,progress,projection,outbound,adult,disclosure,speakers)!=='applied')throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   return isPending?'pending':'applied';
  }
 if(suffix.length===12){
  const keys=['baselineOperation','currentOperation','schemaCatalog','foreignKeys','permissions'].sort();
  if(!speakers||JSON.stringify(Object.keys(speakers).sort())!==JSON.stringify(['current','prior'])||[speakers.prior,speakers.current].some(frame=>!frame||JSON.stringify(Object.keys(frame).sort())!==JSON.stringify(keys)||Object.values(frame).some(value=>typeof value!=='boolean')))throw Error('SPEAKER_INTEGRITY_READBACK_INVALID');
  for(const frame of [speakers.prior,speakers.current])if(frame.baselineOperation||!frame.schemaCatalog||!frame.foreignKeys||!frame.permissions)throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  // Supersede only the operation CHECK with the independently observed exact
  // 0113 frame. All 32 preceding bodies/catalogs/privacy gates still run.
  const isPending=pending.length===1&&pending[0]?.name===SPEAKER_CORRECTION_RECEIPTS_MIGRATION.name&&speakers.prior.currentOperation&&!speakers.current.currentOperation;
  const isApplied=pending.length===0&&!speakers.prior.currentOperation&&speakers.current.currentOperation;
  if(!isPending&&!isApplied)throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   if(inspect(files.slice(0,-1),history.filter(row=>row.name!==SPEAKER_CORRECTION_RECEIPTS_MIGRATION.name),objects,tasks,source,voice,authority,inbound,practice,progress,projection,outbound,adult,isApplied?speakers.current:speakers.prior)!=='applied')throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  return isPending?'pending':'applied';
 }
 if(suffix.length===11){
  const keys=['baselineOperation','currentOperation','schemaCatalog','foreignKeys','permissions'].sort();
  if(!disclosure||JSON.stringify(Object.keys(disclosure).sort())!==JSON.stringify(keys)||Object.values(disclosure).some(v=>typeof v!=='boolean'))throw Error('DISCLOSURE_INTEGRITY_READBACK_INVALID');
  if(!disclosure.schemaCatalog||!disclosure.foreignKeys||!disclosure.permissions)throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  const isPending=pending.length===1&&pending[0]?.name===SCOPED_DISCLOSURE_USE_MIGRATION.name&&disclosure.baselineOperation&&!disclosure.currentOperation;
  const isApplied=pending.length===0&&!disclosure.baselineOperation&&disclosure.currentOperation;
  if(!isPending&&!isApplied)throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   if(inspect(files.slice(0,-1),history.filter(row=>row.name!==SCOPED_DISCLOSURE_USE_MIGRATION.name),objects,tasks,source,voice,authority,inbound,practice,progress,projection,outbound,adult)!=='applied')throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  return isPending?'pending':'applied';
 }
 if(suffix.length===10){
  const keys=['baselineFunctions','reviewedFunctions','immutableHistory','schemaCatalog','foreignKeys','permissions','referencesSound'].sort();
   if(!adult||JSON.stringify(Object.keys(adult).sort())!==JSON.stringify(['current','prior'])||[adult.prior,adult.current].some(frame=>!frame||JSON.stringify(Object.keys(frame).sort())!==JSON.stringify(keys)||Object.values(frame).some(value=>typeof value!=='boolean')))throw new Error('CONTACT_OPS_ADULT_COORDINATION_READBACK_INVALID');
   if(acceptedResponsibility){
    if(pending.length!==0||inspect(files.slice(0,-1),history.filter(row=>row.name!==PRACTICE_ADULT_COORDINATION_MIGRATION.name),objects,tasks,source,voice,authority,inbound,practice,progress,projection,outbound)!=='applied')throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
    return 'applied';
   }
  // Check both independently observed frames. The new exact body supersedes
  // only the coordination actor function; no historical hash is changed.
  for(const frame of [adult.prior,adult.current])if(frame.baselineFunctions||!frame.immutableHistory||!frame.schemaCatalog||!frame.foreignKeys||!frame.permissions||!frame.referencesSound)throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  const isPending=pending.length===1&&pending[0]?.name===PRACTICE_ADULT_COORDINATION_MIGRATION.name&&adult.prior.reviewedFunctions&&!adult.current.reviewedFunctions;
  const isApplied=pending.length===0&&!adult.prior.reviewedFunctions&&adult.current.reviewedFunctions;
  if(!isPending&&!isApplied)throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  const baselineHistory=history.filter(row=>row.name!==PRACTICE_ADULT_COORDINATION_MIGRATION.name);
  // All preceding data/catalog/privacy gates still run. After 0111 the exact
  // current actor body is the accepted replacement frame, not a fabricated
  // claim that the old 0107 body is still serving.
   if(inspect(files.slice(0,-1),baselineHistory,objects,tasks,source,voice,authority,inbound,isApplied?adult.current:adult.prior,progress,projection,outbound)!=='applied')throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  return isPending?'pending':'applied';
 }
 if(suffix.length===9){
  const baselineHistory=history.filter(row=>row.name!==CONTACT_OUTBOUND_PROJECTION_MIGRATION.name);
   if(inspect(files.slice(0,-1),baselineHistory,objects,tasks,source,voice,authority,inbound,practice,progress,projection)!=='applied')throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  const keys=['objectsAbsent','table','schemaCatalog','foreignKeys','pendingIndex','permissions','referencesSound'].sort();
  if(!outbound||JSON.stringify(Object.keys(outbound).sort())!==JSON.stringify(keys)||Object.values(outbound).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_OUTBOUND_READBACK_INVALID');
  const created=Object.entries(outbound).filter(([key])=>key!=='objectsAbsent').map(([,value])=>value);
  if(pending.length===1&&pending[0]?.name===CONTACT_OUTBOUND_PROJECTION_MIGRATION.name&&outbound.objectsAbsent&&created.every(v=>!v))return 'pending';
  if(pending.length===0&&!outbound.objectsAbsent&&created.every(Boolean))return 'applied';
  throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
 }
 if(suffix.length===8){
  // All 28 prior migrations and their exact bodies/catalogs/ACL/FK/permission
  // gates must already be applied. This is only the reviewed additive 0109.
  const baselineHistory=history.filter(row=>row.name!==CONTACT_INBOUND_PROJECTION_MIGRATION.name);
   if(inspect(files.slice(0,-1),baselineHistory,objects,tasks,source,voice,authority,inbound,practice,progress)!=='applied')throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  const keys=['objectsAbsent','tables','schemaCatalog','foreignKeys','historyImmutable','livePersonGuards','reviewedFunctions','permissions','referencesSound'].sort();
  if(!projection||JSON.stringify(Object.keys(projection).sort())!==JSON.stringify(keys)||Object.values(projection).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_PROJECTION_READBACK_INVALID');
  const created=Object.entries(projection).filter(([key])=>key!=='objectsAbsent').map(([,value])=>value);
  if(pending.length===1&&pending[0]?.name===CONTACT_INBOUND_PROJECTION_MIGRATION.name&&projection.objectsAbsent&&created.every(v=>!v))return 'pending';
  if(pending.length===0&&!projection.objectsAbsent&&created.every(Boolean))return 'applied';
  throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
 }
 if(suffix.length===7){
  // Require all 27 prior migrations and EVERY prior catalog/body/FK/ACL gate.
  // This operator may apply only the exact reviewed additive 0108 suffix.
  const baselineHistory=history.filter(row=>row.name!==PROGRESS_REVIEW_REVISIONS_MIGRATION.name);
   if(inspect(files.slice(0,-1),baselineHistory,objects,tasks,source,voice,authority,inbound,practice)!=='applied')throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  const keys=['baselineCatalog','revisedCatalog','publishedGuards','revisionGuards','foreignKeys','permissions','referencesSound'].sort();
  if(!progress||JSON.stringify(Object.keys(progress).sort())!==JSON.stringify(keys)||Object.values(progress).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_PROGRESS_READBACK_INVALID');
  if(!progress.publishedGuards||!progress.foreignKeys||!progress.permissions||!progress.referencesSound)throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  if(pending.length===1&&pending[0]?.name===PROGRESS_REVIEW_REVISIONS_MIGRATION.name&&progress.baselineCatalog&&!progress.revisedCatalog&&!progress.revisionGuards)return 'pending';
  if(pending.length===0&&!progress.baselineCatalog&&progress.revisedCatalog&&progress.revisionGuards)return 'applied';
  throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
 }
 if(suffix.length===6){
  // Reuse EVERY 0101..0106 baseline gate, requiring it already applied. This
  // new suffix may neither admit an earlier pending migration nor ignore drift.
  const baselineHistory=history.filter(row=>row.name!==PRACTICE_SUBJECT_GUARDS_MIGRATION.name);
   if(inspect(files.slice(0,-1),baselineHistory,objects,tasks,source,voice,authority,inbound)!=='applied')throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  const keys=['baselineFunctions','reviewedFunctions','immutableHistory','schemaCatalog','foreignKeys','permissions','referencesSound'].sort();
   if(!practice||JSON.stringify(Object.keys(practice).sort())!==JSON.stringify(keys)||Object.values(practice).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_PRACTICE_READBACK_INVALID');
   if(acceptedResponsibility){if(pending.length!==0)throw Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');return 'applied';}
  if(!practice.immutableHistory||!practice.schemaCatalog||!practice.foreignKeys||!practice.permissions||!practice.referencesSound)throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  if(pending.length===1&&pending[0]?.name===PRACTICE_SUBJECT_GUARDS_MIGRATION.name&&practice.baselineFunctions&&!practice.reviewedFunctions)return 'pending';
  if(pending.length===0&&!practice.baselineFunctions&&practice.reviewedFunctions)return 'applied';
  throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
 }
 const expectedKeys=['profiles','legacyLinks','commandReceipts','legacyIndex','profileProvenanceTrigger','markerCompatibilityTrigger','immutableDemoRecordTrigger','profileFunction','markerFunction','immutableFunction','canonicalPersonConstraint','canonicalConstraintDefinition','schemaCatalog','baselineRecordsCatalog','permanentTables','foreignKeysEnforced','foreignKeyReferencesSound','publicRevoked'].sort();
 if(JSON.stringify(Object.keys(objects).sort())!==JSON.stringify(expectedKeys))throw new Error('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
 const values=Object.values(objects);
 if(values.some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_INTEGRITY_READBACK_INVALID');
 const taskKeys=['tables','columns','constraints','schemaCatalog','foreignKeys','dueIndex','historyImmutable','appendOnlyFunction','publicRevoked'].sort();
 if(JSON.stringify(Object.keys(tasks).sort())!==JSON.stringify(taskKeys)||Object.values(tasks).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_TASK_READBACK_INVALID');
 const taskValues=Object.values(tasks);
 if(!tasks.appendOnlyFunction)throw new Error('CONTACT_OPS_TASK_BASELINE_FUNCTION_MISSING');
 const newTaskValues=Object.entries(tasks).filter(([key])=>key!=='appendOnlyFunction').map(([,value])=>value);
 if(!objects.immutableDemoRecordTrigger||!objects.immutableFunction||!objects.baselineRecordsCatalog)throw new Error('CONTACT_OPS_BASELINE_PROVENANCE_MISSING');
 const newlyCreated=Object.entries(objects).filter(([key])=>!['immutableDemoRecordTrigger','immutableFunction','baselineRecordsCatalog'].includes(key)).map(([,value])=>value);
 if(suffix.length>=2){
  if(!source||JSON.stringify(Object.keys(source).sort())!==JSON.stringify(['baseCatalog','sourceCatalog','sourceIndex'])||
   Object.values(source).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_SOURCE_TASK_READBACK_INVALID');
  if(suffix.length>=3){
   if(!voice||JSON.stringify(Object.keys(voice).sort())!==JSON.stringify(['namespaceAbsent','tables','schemaCatalog','foreignKeys','ownerIndex','historyImmutable','publicRevoked'].sort())||
    Object.values(voice).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_VOICE_READBACK_INVALID');
   if(!values.every(Boolean)||!taskValues.every(Boolean)||source.baseCatalog||!source.sourceCatalog||!source.sourceIndex)
    throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   const newVoiceValues=Object.entries(voice).filter(([key])=>key!=='namespaceAbsent').map(([,value])=>value);
   if(suffix.length>=4){
    if(!authority||JSON.stringify(Object.keys(authority).sort())!==JSON.stringify(['objectsAbsent','tables','schemaCatalog','foreignKeys','historyImmutable','appendOnlyFunction','publicRevoked','referencesSound'].sort())||
     Object.values(authority).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_AUTHORITY_READBACK_INVALID');
    if(voice.namespaceAbsent||!newVoiceValues.every(Boolean))throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
    const newAuthorityValues=Object.entries(authority).filter(([key])=>key!=='objectsAbsent').map(([,value])=>value);
    if(suffix.length===5){
     if(authority.objectsAbsent||!newAuthorityValues.every(Boolean))throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
     if(!inbound||JSON.stringify(Object.keys(inbound).sort())!==JSON.stringify(['objectsAbsent','tables','schemaCatalog','foreignKeys','historyImmutable','appendOnlyFunction','publicRevoked','referencesSound'].sort())||
      Object.values(inbound).some(value=>typeof value!=='boolean'))throw new Error('CONTACT_OPS_INBOUND_READBACK_INVALID');
     const newInboundValues=Object.entries(inbound).filter(([key])=>key!=='objectsAbsent').map(([,value])=>value);
     if(pending.length===1&&pending[0]?.name===CONTACT_INBOUND_MIGRATION.name&&inbound.objectsAbsent&&newInboundValues.every(value=>!value))return 'pending';
     if(pending.length===0&&!inbound.objectsAbsent&&newInboundValues.every(Boolean))return 'applied';
     throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
    }
    if(pending.length===1&&pending[0]?.name===CONTACT_AUTHORITY_MIGRATION.name&&authority.objectsAbsent&&newAuthorityValues.every(value=>!value))return 'pending';
    if(pending.length===0&&!authority.objectsAbsent&&newAuthorityValues.every(Boolean))return 'applied';
    throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
   }
   if(pending.length===1&&pending[0]?.name===VOICE_RULE_MIGRATION.name&&voice.namespaceAbsent&&newVoiceValues.every(value=>!value))return 'pending';
   if(pending.length===0&&!voice.namespaceAbsent&&newVoiceValues.every(Boolean))return 'applied';
   throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
  }
  if(pending.length===1&&pending[0]?.name===SOURCE_TASKS_MIGRATION.name&&values.every(Boolean)&&taskValues.every(Boolean)&&
   source.baseCatalog&&!source.sourceCatalog&&!source.sourceIndex)return 'pending';
  if(pending.length===0&&values.every(Boolean)&&taskValues.every(Boolean)&&
   !source.baseCatalog&&source.sourceCatalog&&source.sourceIndex)return 'applied';
  throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
 }
 if(suffix.length===0 && pending.length===1 && pending[0]?.name===CONTACT_OPS_MIGRATION.name && newlyCreated.every(value=>!value)&&newTaskValues.every(value=>!value))return 'pending';
 if(suffix.length===1 && pending.length===1 && pending[0]?.name===INTERNAL_TASKS_MIGRATION.name && values.every(Boolean)&&newTaskValues.every(value=>!value))return 'pending';
  if(pending.length===0 && values.every(Boolean)&&(suffix.length===0?newTaskValues.every(value=>!value):taskValues.every(Boolean)))return 'applied';
  throw new Error('CONTACT_OPS_SCHEMA_STATE_CONFLICT');
 };
 return inspect(files,history,objects,tasks,source,voice,authority,inbound,practice,progress,projection,outbound,adult,disclosure,speakers);
}
