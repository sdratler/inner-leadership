import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { progressReviewFunctionBody, progressReviewIntegrity, PROGRESS_REVIEW_REVISIONS_MIGRATION } from '../../src/db/progress-review-integrity.ts';
const body='\nBEGIN RETURN NEW; END;\n';
const baseline={name:'0050_forms_resources_qualitative_reviews_20260911.sql',checksum:'0'.repeat(64),sql:`CREATE OR REPLACE FUNCTION ls_progress.protect_published_review() RETURNS trigger LANGUAGE plpgsql AS $fn$${body}$fn$;`};
const revised={name:PROGRESS_REVIEW_REVISIONS_MIGRATION.name,checksum:PROGRESS_REVIEW_REVISIONS_MIGRATION.sha256,sql:`CREATE FUNCTION ls_progress.check_review_head_revision() RETURNS trigger LANGUAGE plpgsql AS $fn$${body}$fn$;`};
test('reads exactly one reviewed baseline/new trigger body without accepting injected names or duplicate definitions',()=>{
 expect(progressReviewFunctionBody([baseline],baseline.name,'ls_progress.protect_published_review')).toBe(body);
 expect(progressReviewFunctionBody([revised],revised.name,'ls_progress.check_review_head_revision')).toBe(body);
 expect(()=>progressReviewFunctionBody([revised],revised.name,'ls_progress.head()')).toThrow('CONTACT_OPS_PROGRESS_FUNCTION_SOURCE_INVALID');
 expect(()=>progressReviewFunctionBody([{...revised,sql:revised.sql+revised.sql}],revised.name,'ls_progress.check_review_head_revision')).toThrow('CONTACT_OPS_PROGRESS_FUNCTION_SOURCE_MISSING');
 expect(()=>progressReviewFunctionBody([],revised.name,'ls_progress.check_review_head_revision')).toThrow('CONTACT_OPS_PROGRESS_FUNCTION_SOURCE_MISSING');
});
test('unknown/missing readbacks do not constitute an absent or valid protected schema',async()=>{
 expect(await progressReviewIntegrity({query:async()=>[]},[baseline,revised])).toEqual({baselineCatalog:false,revisedCatalog:false,publishedGuards:false,revisionGuards:false,foreignKeys:false,permissions:false,referencesSound:false});
});
test('pins the exact candidate SQL and keeps all five new guards invoker-only and owner-executable',()=>{
 const bytes=readFileSync(new URL('../../migrations/'+revised.name,import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(revised.checksum);
 const sql=bytes.toString('utf8');expect(sql).not.toContain('SECURITY DEFINER');
 for(const name of ['protect_review_revision_history','check_review_revision_insert','record_review_baseline','check_review_head_revision','check_review_revision_committed']){
  expect(progressReviewFunctionBody([{...revised,sql}],revised.name,'ls_progress.'+name)).toContain('BEGIN');
  expect(sql).toContain(`REVOKE ALL ON FUNCTION ls_progress.${name}() FROM PUBLIC;`);
 }
});
