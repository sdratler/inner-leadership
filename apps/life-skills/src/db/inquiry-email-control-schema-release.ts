import { z } from 'zod';
import { planMigrations, type AppliedMigration, type Migration } from './migration-plan.ts';
import { INQUIRY_EMAIL_CONTROL_MIGRATIONS } from './inquiry-email-control-history.ts';
import { owner305Hash, type Owner305ReleaseQuery } from './owner-305-schema-release.ts';

const prefixSha256 = 'c378aefbf0c6acc192481c8dd5408c173613d315835bb843a2ff9416e2b03174';
export const inquirySchemaTarget = Object.freeze({
 projectId:'3b756632-1f66-4f75-a016-eabc37aa0d67',environmentId:'dd91bd71-57cc-45e6-a75b-8c858491d7c7',
 appServiceId:'0267d061-f3ce-4a0a-82d4-ce133e4501e9',databaseServiceId:'354b5343-9e83-45a7-b764-09396f14ae29',
 databaseHost:'postgres.railway.internal',appOrigin:'https://life-skills.bneineviimacademy.org',
});
const sha = z.string().regex(/^[a-f0-9]{64}$/), commit = z.string().regex(/^[a-f0-9]{40}$/);
export type InquirySchemaStage = 0|1|2;
export const schemaFailure = (suffix:string) => new Error('INQUIRY_EMAIL_CONTROL_SCHEMA_'+suffix);
type Env = Readonly<Record<string,string|undefined>>;
export function inquirySchemaTargetBinding(env:Env) {
 const t = inquirySchemaTarget;
 if (env.RAILWAY_PROJECT_ID !== t.projectId || env.RAILWAY_ENVIRONMENT_ID !== t.environmentId ||
     env.RAILWAY_SERVICE_ID !== t.appServiceId || env.LS_APP_ORIGIN !== t.appOrigin) throw schemaFailure('TARGET_MISMATCH');
 const deployment = z.string().uuid().safeParse(env.RAILWAY_DEPLOYMENT_ID),source = commit.safeParse(env.RAILWAY_GIT_COMMIT_SHA);
 if (!deployment.success || !source.success || source.data !== env.LIFE_SKILLS_RELEASE_COMMIT) throw schemaFailure('RELEASE_MISMATCH');
 if (env.LS_DATABASE_TLS !== 'verify-full' || !env.LS_DATABASE_CA?.trim()) throw schemaFailure('TLS_REQUIRED');
 let url:URL;
 try {url = new URL(env.LS_DATABASE_URL ?? '');} catch {throw schemaFailure('DATABASE_TARGET_MISMATCH');}
 if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname !== t.databaseHost || url.port !== '5432' ||
     url.pathname !== '/railway' || url.search || url.hash || !url.username || !url.password) throw schemaFailure('DATABASE_TARGET_MISMATCH');
 return {deploymentId:deployment.data,mergedCommit:source.data,databaseBindingSha256:owner305Hash(env.LS_DATABASE_URL!)};
}

/** Only the exact 67/70 predecessor and the reviewed 151/152 suffix. A generic
 * plan may expose deferred BNA migrations. Never give that plan to a runner. */
export function validateInquirySchemaSource(files:readonly Migration[]) {
 if (files.length !== 72 || files.some((file,n) => (n>0 && files[n-1]!.name >= file.name) || owner305Hash(file.sql) !== file.checksum))
  throw schemaFailure('SOURCE_MISMATCH');
 if (owner305Hash(JSON.stringify(files.slice(0,70).map(f=>({name:f.name,sha256:f.checksum})))) !== prefixSha256) throw schemaFailure('SOURCE_PREFIX_MISMATCH');
 for (const [n,pin] of INQUIRY_EMAIL_CONTROL_MIGRATIONS.entries()) {
  const actual=files[70+n]!;
  if(actual.name!==pin.name || actual.checksum!==pin.sha256)throw schemaFailure('SELECTED_SOURCE_MISMATCH');
 }
}
export function inquiryEmailSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:InquirySchemaStage) {
 validateInquirySchemaSource(files);
 planMigrations(files,history);
 const prefix = history.length-stage;
 if ((prefix !== 67 && prefix !== 70) || ![0,1,2].includes(stage)) throw schemaFailure('BASELINE_CONFLICT');
 const expected = [...files.slice(0,prefix),...files.slice(70,70+stage)];
 if(history.length !== expected.length || history.some((row,n)=>row.name!==expected[n]!.name || row.checksum!==expected[n]!.checksum))
  throw schemaFailure('LEDGER_CATALOG_CONFLICT');
 return {prefix,stage,pending:files.slice(70+stage),ledgerSha256:owner305Hash(JSON.stringify(history.map(({name,checksum})=>({name,checksum}))))};
}

const restorationStep=z.object({name:z.string(),sha256:sha,catalogSha256:sha}).strict();
export const inquirySchemaProof = z.object({
 kind:z.literal('fishing_inquiry_email_control_schema_v1'),approvalId:z.string().uuid(),approvalReceiptSha256:sha,
 projectId:z.string().uuid(),environmentId:z.string().uuid(),appServiceId:z.string().uuid(),databaseServiceId:z.string().uuid(),
 deploymentId:z.string().uuid(),mergedCommit:commit,mergeReceiptSha256:sha,protectedCiReceiptSha256:sha,sourceSha256:sha,
 manifestSha256:sha,databaseBindingSha256:sha,baselineStage:z.union([z.literal(0),z.literal(1)]),baselineLedgerSha256:sha,
 baselineCatalogSha256:sha,notBefore:z.iso.datetime(),expiresAt:z.iso.datetime(),receiptDirectory:z.string().min(1).max(1000),
 backup:z.object({receiptId:z.string().min(1).max(200),receiptSha256:sha,archiveSha256:sha,readbackAt:z.iso.datetime(),databaseSystemIdentifier:z.string().regex(/^\d+$/)}).strict(),
 isolatedRestore:z.object({receiptId:z.string().min(1).max(200),receiptSha256:sha,isolatedTargetReceiptSha256:sha,
  sourceReceiptId:z.string().min(1).max(200),archiveSha256:sha,verifiedAt:z.iso.datetime(),verified:z.literal(true),
  baselineLedgerSha256:sha,baselineCatalogSha256:sha,previousObjectsPreserved:z.literal(true),stages:z.array(restorationStep).min(1).max(2)}).strict(),
 rollback:z.object({reviewed:z.literal(true),receiptSha256:sha,description:z.string().min(20).max(2000)}).strict(),
}).strict();
export type InquirySchemaProof = z.infer<typeof inquirySchemaProof>;
export function assertInquirySchemaProof(p:InquirySchemaProof,f:ReturnType<typeof inquirySchemaTargetBinding> & {sourceSha256:string;manifestSha256:string;databaseSystemIdentifier:string}) {
 const t=inquirySchemaTarget;
 if(p.projectId!==t.projectId || p.environmentId!==t.environmentId || p.appServiceId!==t.appServiceId || p.databaseServiceId!==t.databaseServiceId ||
   p.deploymentId!==f.deploymentId || p.mergedCommit!==f.mergedCommit || p.databaseBindingSha256!==f.databaseBindingSha256 ||
   p.sourceSha256!==f.sourceSha256 || p.manifestSha256!==f.manifestSha256 || p.backup.databaseSystemIdentifier!==f.databaseSystemIdentifier)
  throw schemaFailure('PROOF_TARGET_MISMATCH');
 const restore=p.isolatedRestore,expected=INQUIRY_EMAIL_CONTROL_MIGRATIONS.slice(p.baselineStage);
 if(p.backup.receiptId!==restore.sourceReceiptId || p.backup.receiptId===restore.receiptId || p.backup.receiptSha256===restore.receiptSha256 || p.backup.archiveSha256!==restore.archiveSha256 ||
   p.baselineLedgerSha256!==restore.baselineLedgerSha256 || p.baselineCatalogSha256!==restore.baselineCatalogSha256 ||
   expected.length!==restore.stages.length || expected.some((pin,n)=>pin.name!==restore.stages[n]!.name || pin.sha256!==restore.stages[n]!.sha256))
  throw schemaFailure('RESTORE_MISMATCH');
 if(Date.parse(p.backup.readbackAt)>Date.parse(restore.verifiedAt) || Date.parse(restore.verifiedAt)>Date.parse(p.notBefore) ||
   Date.parse(p.notBefore)>=Date.parse(p.expiresAt))throw schemaFailure('PROOF_CHRONOLOGY');
}
export function assertInquirySchemaApply(p:InquirySchemaProof,env:Env,now:Date) {
 const n=now.getTime();
 if(env.LS_INQUIRY_EMAIL_CONTROL_SCHEMA_APPLY_APPROVED!=='true' || env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED==='true' ||
    env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_QUEUE_ENABLED==='true') throw schemaFailure('APPLY_NOT_APPROVED');
 if(!Number.isFinite(n)||n<Date.parse(p.notBefore)||n>=Date.parse(p.expiresAt)||n-Date.parse(p.backup.readbackAt)>7*86400000)
  throw schemaFailure('APPLY_WINDOW_CLOSED');
}
export function expectedInquiryCatalog(p:InquirySchemaProof,stage:InquirySchemaStage):string {
 if(stage===p.baselineStage)return p.baselineCatalogSha256;
 const step=p.isolatedRestore.stages[stage-p.baselineStage-1];
 if(!step)throw schemaFailure('RESTORED_STAGE_MISSING');
 return step.catalogSha256;
}
export function assertInquirySchemaProgress(p:InquirySchemaProof,current:{history:readonly AppliedMigration[];prefix:number;stage:InquirySchemaStage;ledgerSha256:string;catalogSha256:string},newApply=false) {
 const original=current.history.slice(0,current.prefix+p.baselineStage).map(({name,checksum})=>({name,checksum}));
 if(current.stage<p.baselineStage || owner305Hash(JSON.stringify(original))!==p.baselineLedgerSha256 ||
    current.catalogSha256!==expectedInquiryCatalog(p,current.stage))throw schemaFailure('BASELINE_OR_CATALOG_CHANGED');
 if(newApply && current.stage!==2 && (current.stage!==p.baselineStage || current.ledgerSha256!==p.baselineLedgerSha256))
  throw schemaFailure('NEW_BASELINE_PROOF_REQUIRED');
}

export async function readInquiryEmailCatalog(db:Owner305ReleaseQuery) {
 const state=await db.query<{base:boolean;verification:boolean;column:boolean;guard:boolean;uniqueIndex:boolean}>(`SELECT
  to_regclass('ls_service_interest.public_applications') IS NOT NULL AND to_regclass('ls_service_interest.inquiry_email_outbox') IS NOT NULL AS base,
  to_regclass('ls_service_interest.inquiry_email_control_verifications') IS NOT NULL AS verification,
  EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ls_service_interest.inquiry_email_outbox') AND attname='control_delivery_ciphertext' AND NOT attisdropped) AS "column",
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('ls_service_interest.inquiry_email_outbox') AND conname='inquiry_email_control_envelope') AS guard,
  to_regclass('ls_service_interest.inquiry_email_control_parent_once') IS NOT NULL AS "uniqueIndex"`);
 const flags=state.rows[0];
 if(!flags?.base)throw schemaFailure('CATALOG_CONFLICT');
 const second=[flags.column,flags.guard,flags.uniqueIndex].filter(Boolean).length;
 if((second!==0 && second!==3) || (!flags.verification && second!==0))throw schemaFailure('CATALOG_CONFLICT');
 const stage:InquirySchemaStage=second===3?2:flags.verification?1:0;
 // Check actual definitions/ACLs against the reviewed isolated restore. No
 // application/customer rows or secrets enter the catalog evidence.
 const catalog=await db.query<{kind:string;name:string;definition:string}>(`WITH rel AS (
 SELECT c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ls_service_interest' AND c.relname IN ('inquiry_email_control_verifications','inquiry_email_outbox'))
 SELECT 'relation' AS kind,relname::text AS name,relkind::text||'|'||relpersistence::text||'|'||relrowsecurity::text||'|'||relforcerowsecurity::text AS definition FROM rel
 UNION ALL SELECT 'column',r.relname||'.'||a.attname,a.attnum::text||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull::text||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
 FROM rel r JOIN pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraint',r.relname||'.'||k.conname,k.contype::text||'|'||k.convalidated::text||'|'||pg_get_constraintdef(k.oid)
 FROM rel r JOIN pg_constraint k ON k.conrelid=r.oid WHERE k.contype<>'n'
 UNION ALL SELECT 'index',i.indexrelid::regclass::text,i.indisready::text||'|'||i.indisvalid::text||'|'||pg_get_indexdef(i.indexrelid)
 FROM pg_index i WHERE i.indrelid IN(SELECT oid FROM rel)
 UNION ALL SELECT 'trigger',r.relname||'.'||t.tgname,t.tgenabled::text||'|'||pg_get_triggerdef(t.oid)
 FROM rel r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
 UNION ALL SELECT 'acl',r.relname::text,
  CASE WHEN a.grantor=r.relowner THEN 'OWNER' ELSE pg_get_userbyid(a.grantor) END||'|'||
  CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN a.grantee=r.relowner THEN 'OWNER' ELSE pg_get_userbyid(a.grantee) END||'|'||a.privilege_type||'|'||a.is_grantable::text
 FROM rel r CROSS JOIN LATERAL aclexplode(COALESCE(r.relacl,acldefault('r',r.relowner))) a`);
 if(!catalog.rows.length)throw schemaFailure('CATALOG_CONFLICT');
 const rows=catalog.rows.map(({kind,name,definition})=>JSON.stringify([kind,name,definition])).sort();
 return {stage,catalogSha256:owner305Hash(JSON.stringify(rows))};
}
