import { createHash } from 'node:crypto';
import type { SqlSession } from '../features/identity/store.ts';
import type { Migration } from './migration-plan.ts';

export const PROGRESS_REVIEW_REVISIONS_MIGRATION = {
 name: '0108_ls_progress_review_revisions.sql',
 sha256: '42b2f3f5828289d15f0bdf6efd3175a33e7f722416bc998ba6f9c2779f8287af',
} as const;
const BASELINE = '0050_forms_resources_qualitative_reviews_20260911.sql';
// Calibrated only from the verified native PG17 baseline and populated upgrade.
export const PROGRESS_BASELINE_SCHEMA_SHA256 = '85c8ccb93e1c04d9838e746ddd96a25c94e291b0cbcd53a7d67d6402a1288e54';
export const PROGRESS_REVISED_SCHEMA_SHA256 = '01860aee4e7e381dc99e3faf4810b8bf04ce9b826f03285a199b4e71921e3a2a';
export interface ProgressReviewIntegrity {
 baselineCatalog: boolean; revisedCatalog: boolean; publishedGuards: boolean;
 revisionGuards: boolean; foreignKeys: boolean; permissions: boolean; referencesSound: boolean;
}
const oldFunctions = ['protect_published_review', 'protect_published_review_reference'] as const;
const newFunctions = ['protect_review_revision_history', 'check_review_revision_insert', 'record_review_baseline', 'check_review_head_revision', 'check_review_revision_committed'] as const;
export function progressReviewFunctionBody(files: readonly Migration[], migration: string, name: string): string {
 if (!/^ls_progress\.[a-z_]+$/.test(name)) throw Error('CONTACT_OPS_PROGRESS_FUNCTION_SOURCE_INVALID');
 const sql = files.find(file => file.name === migration)?.sql;
 const pattern = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replace('.', '\\.')}\\(\\)\\s+RETURNS trigger LANGUAGE plpgsql AS \\$fn\\$([\\s\\S]*?)\\$fn\\$;`, 'g');
 const matches = sql ? [...sql.matchAll(pattern)] : [];
 if (matches.length !== 1) throw Error('CONTACT_OPS_PROGRESS_FUNCTION_SOURCE_MISSING');
 return matches[0]![1]!.replace(/\r\n/g, '\n');
}

/** Payload-free full catalog fingerprint, not a readiness assertion by itself. */
export async function progressReviewCatalogDigest(tx: SqlSession): Promise<string> {
 const catalog = (await tx.query<{ catalog: unknown }>(`SELECT json_build_object(
 'columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY c.relname,a.attnum)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='ls_progress' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT json_agg(json_build_object('table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_progress' AND k.contype<>'n'),
 'indexes',(SELECT json_agg(json_build_object('table',c.relname,'name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY c.relname,ic.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname='ls_progress'),
 'triggers',(SELECT json_agg(json_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_progress' AND NOT t.tgisinternal)) AS catalog`))[0]?.catalog;
 return createHash('sha256').update(JSON.stringify(catalog) ?? 'null').digest('hex');
}

/** Read-only proof before/after the existing exact one-migration operator.
 * Historical accounts/grants are not repaired or inferred to be still active. */
export async function progressReviewIntegrity(tx: SqlSession, files: readonly Migration[]): Promise<ProgressReviewIntegrity> {
 const digest = await progressReviewCatalogDigest(tx);
 const baselineCatalog = digest === PROGRESS_BASELINE_SCHEMA_SHA256, revisedCatalog = digest === PROGRESS_REVISED_SCHEMA_SHA256;
 const functions = await tx.query<{ name: string; body: string; safe: boolean; ownerOnly: boolean }>(`SELECT p.proname AS name,p.prosrc AS body,
  p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
   AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND p.proconfig IS NULL
   AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe,
  NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee<>p.proowner) AS "ownerOnly"
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_progress' ORDER BY p.proname,p.oid`);
 const matches = (name: string, migration: string) => {
  const found = functions.filter(fn => fn.name === name);
  return found.length === 1 && found[0]?.safe === true && found[0]?.body.replace(/\r\n/g, '\n') === progressReviewFunctionBody(files, migration, 'ls_progress.' + name);
 };
 const objects = (await tx.query<{ foreignKeys: boolean; permissions: boolean }>(`SELECT
  NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='ls_progress' AND k.contype='f' AND (NOT k.convalidated OR
    (SELECT count(*)<>4 OR NOT bool_and(t.tgenabled IN ('O','A')) FROM pg_trigger t WHERE t.tgconstraint=k.oid))) AS "foreignKeys",
  (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_namespace n WHERE n.nspname='ls_progress')
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='ls_progress' AND acl.grantee<>n.nspowner)
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_progress' AND c.relkind IN ('r','p','v','m','f') AND (c.relkind<>'r' OR c.relpersistence<>'p' OR c.relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)))
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_progress' AND c.relkind='r' AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl WHERE n.nspname='ls_progress' AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='ls_progress' AND (acl.grantee NOT IN (0,p.proowner) OR acl.privilege_type<>'EXECUTE' OR (acl.grantee=0 AND acl.is_grantable))) AS permissions`))[0];
 const publishedGuards = oldFunctions.every(name => matches(name, BASELINE));
 const revisionGuards = functions.length === 7 && newFunctions.every(name => matches(name, PROGRESS_REVIEW_REVISIONS_MIGRATION.name) && functions.find(fn => fn.name === name)?.ownerOnly === true);
 let referencesSound = false;
 if ((baselineCatalog || revisedCatalog) && objects?.foreignKeys === true) {
  const existing = (await tx.query<{ sound: boolean }>(`SELECT
   NOT EXISTS(SELECT 1 FROM ls_progress.qualitative_reviews q LEFT JOIN ls_cases.cases c ON c.workspace_id=q.workspace_id AND c.id=q.case_id LEFT JOIN ls_cases.audiences a ON a.workspace_id=q.workspace_id AND a.case_id=q.case_id AND a.id=q.audience_id WHERE c.id IS NULL OR a.id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM ls_progress.review_practice_versions r LEFT JOIN ls_progress.qualitative_reviews q ON q.workspace_id=r.workspace_id AND q.id=r.review_id WHERE q.id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM ls_progress.review_parent_reports r LEFT JOIN ls_progress.qualitative_reviews q ON q.workspace_id=r.workspace_id AND q.id=r.review_id LEFT JOIN ls_identity.accounts a ON a.workspace_id=r.workspace_id AND a.id=r.author_account_id WHERE q.id IS NULL OR a.id IS NULL) AS sound`))[0]?.sound === true;
  const history = !revisedCatalog || (await tx.query<{ sound: boolean }>(`SELECT
   NOT EXISTS(SELECT 1 FROM ls_progress.qualitative_reviews q WHERE
    (SELECT count(*) FROM ls_progress.qualitative_review_revisions r WHERE r.workspace_id=q.workspace_id AND r.review_id=q.id)<>q.revision
    OR NOT EXISTS(SELECT 1 FROM ls_progress.qualitative_review_revisions r WHERE r.workspace_id=q.workspace_id AND r.review_id=q.id AND r.revision=q.revision AND r.narrative_ciphertext=q.narrative_ciphertext)
    OR NOT EXISTS(SELECT 1 FROM ls_progress.qualitative_review_revisions r WHERE r.workspace_id=q.workspace_id AND r.review_id=q.id AND r.revision=1 AND r.author_account_id=q.created_by_account_id AND r.saved_at=q.created_at))
   AND NOT EXISTS(SELECT 1 FROM ls_progress.qualitative_review_revisions r LEFT JOIN ls_progress.qualitative_reviews q ON q.workspace_id=r.workspace_id AND q.id=r.review_id LEFT JOIN ls_identity.accounts a ON a.workspace_id=r.workspace_id AND a.id=r.author_account_id WHERE q.id IS NULL OR a.id IS NULL OR r.revision>q.revision) AS sound`))[0]?.sound === true;
  referencesSound = existing && history;
 }
 return { baselineCatalog, revisedCatalog, publishedGuards, revisionGuards,
  foreignKeys: objects?.foreignKeys === true, permissions: objects?.permissions === true && (baselineCatalog ? functions.length === 2 : revisedCatalog && revisionGuards), referencesSound };
}
