import {createHash} from 'node:crypto';
import type {SqlSession} from '../features/identity/store.ts';
import type {Migration} from './migration-plan.ts';

export const PRACTICE_SUBJECT_GUARDS_MIGRATION={
 name:'0107_ls_practice_subject_guards.sql',
 sha256:'7608bc445e4d394b9041745a85bb1d1f36850e7c4841e5acbc0114724b72b720',
} as const;
const BASELINE='0040_ls_home_practice_20260911.sql';
/** Native PG17.11: 0107 changes two bodies only; all 80 columns, 74
 * constraints, 26 indexes and six triggers must remain exactly unchanged.
 * PG18 NOT NULL constraints are represented by column attnotnull instead. */
export const PRACTICE_SCHEMA_SHA256='518adcd5f429994682dba74895a2ff58a1283b1ba8baa98db54170bb20bde89f';
export type PracticeSubjectIntegrity={
 baselineFunctions:boolean;reviewedFunctions:boolean;immutableHistory:boolean;
 schemaCatalog:boolean;foreignKeys:boolean;permissions:boolean;referencesSound:boolean;
};

export function practiceFunctionBody(files:readonly Migration[],migration:string,name:string):string{
 if(!/^ls_practice\.[a-z_]+$/.test(name))throw new Error('CONTACT_OPS_PRACTICE_FUNCTION_SOURCE_INVALID');
 const sql=files.find(file=>file.name===migration)?.sql;
 const escaped=name.replace('.', '\\.');
 const pattern=new RegExp(`CREATE OR REPLACE FUNCTION ${escaped}\\(\\)\\s+RETURNS trigger LANGUAGE plpgsql AS \\$fn\\$([\\s\\S]*?)\\$fn\\$;`,'g');
 const matches=sql?[...sql.matchAll(pattern)]:[];
 if(matches.length!==1)throw new Error('CONTACT_OPS_PRACTICE_FUNCTION_SOURCE_MISSING');
 return matches[0]![1]!.replace(/\r\n/g,'\n');
}

/** Read-only, payload-free proof for the existing one-migration operator.
 * Never repairs drift, grants roles, or rewrites historical responsibility. */
export async function practiceSubjectIntegrity(tx:SqlSession,files:readonly Migration[]):Promise<PracticeSubjectIntegrity>{
 const catalog=(await tx.query<{catalog:unknown}>(`SELECT json_build_object(
  'columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY c.relname,a.attnum)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='ls_practice' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT json_agg(json_build_object('table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_practice' AND k.contype<>'n'),
  'indexes',(SELECT json_agg(json_build_object('table',c.relname,'name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY c.relname,ic.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname='ls_practice'),
  'triggers',(SELECT json_agg(json_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_practice' AND NOT t.tgisinternal)) AS catalog`))[0]?.catalog;
 const objects=(await tx.query<{tables:boolean;foreignKeys:boolean;permissions:boolean}>(`SELECT
  (SELECT count(*)=8 AND bool_and(c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_practice' AND c.relkind IN ('r','p','v','m','f')) AS tables,
  (SELECT count(*)=27 AND bool_and(k.convalidated AND (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A')) FROM pg_trigger t WHERE t.tgconstraint=k.oid)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_practice' AND k.contype='f') AS "foreignKeys",
  (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_namespace n WHERE n.nspname='ls_practice')
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='ls_practice' AND acl.grantee<>n.nspowner)
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_practice' AND c.relkind='r' AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl WHERE n.nspname='ls_practice' AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)
   -- 0040's existing invoker functions have default PUBLIC EXECUTE, but no
   -- PUBLIC schema/table access. 0107 must not broaden or create any grant.
   AND (SELECT count(*)=5 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_practice')
   AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='ls_practice' AND (acl.grantee NOT IN (0,p.proowner) OR acl.privilege_type<>'EXECUTE' OR (acl.grantee=0 AND acl.is_grantable))) AS permissions`))[0];
 const functions=await tx.query<{name:string;body:string;safe:boolean}>(`SELECT p.proname AS name,p.prosrc AS body,
  p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
   AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND p.proconfig IS NULL
   AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_practice'
   AND p.proname IN ('check_coordination_actor_and_assignees','check_completion_author','protect_immutable_row','check_active_version')`);
 const matches=(migration:string,name:string)=>{
  const found=functions.filter(fn=>fn.name===name);
  return found.length===1&&found[0]?.safe===true&&found[0]?.body.replace(/\r\n/g,'\n')===practiceFunctionBody(files,migration,'ls_practice.'+name);
 };
 const participants=['check_coordination_actor_and_assignees','check_completion_author'];
 const unique=(await tx.query<{body:string;safe:boolean}>(`SELECT p.prosrc AS body,
  p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND p.prokind='f' AND p.pronargs=1 AND p.prorettype='boolean'::regtype
   AND p.proargtypes::text='2951' AND p.provolatile='i' AND p.proparallel='s' AND p.proisstrict AND NOT p.prosecdef
   AND p.proconfig IS NULL AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe
  FROM pg_proc p WHERE p.oid=to_regprocedure('ls_practice.uuid_array_is_unique(uuid[])')`));
 const expectedUnique=files.find(file=>file.name===BASELINE)?.sql.match(/CREATE OR REPLACE FUNCTION ls_practice\.uuid_array_is_unique\(value uuid\[\]\) RETURNS boolean\s+LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS \$fn\$([\s\S]*?)\$fn\$;/)?.[1]?.replace(/\r\n/g,'\n');
 const schemaCatalog=objects?.tables===true&&createHash('sha256').update(JSON.stringify(catalog)).digest('hex')===PRACTICE_SCHEMA_SHA256;
 let referencesSound=false;
 if(schemaCatalog&&objects?.foreignKeys===true)referencesSound=(await tx.query<{sound:boolean}>(`SELECT
  NOT EXISTS(SELECT 1 FROM ls_practice.practice_assignments a LEFT JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=a.workspace_id AND v.id=a.active_version_id AND v.assignment_id=a.id WHERE a.active_version_id IS NOT NULL AND (v.id IS NULL OR v.state<>'published'))
  AND NOT EXISTS(SELECT 1 FROM ls_practice.practice_occurrences o
   LEFT JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
   LEFT JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=o.workspace_id AND v.id=o.practice_version_id AND v.assignment_id=o.assignment_id
   LEFT JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id AND c.assignment_id=o.assignment_id AND c.case_id=a.case_id AND c.audience_id=a.audience_id
   WHERE a.id IS NULL OR v.id IS NULL OR v.state<>'published' OR c.id IS NULL)
  AND NOT EXISTS(SELECT 1 FROM ls_practice.completion_reports r
   LEFT JOIN ls_practice.practice_occurrences o ON o.workspace_id=r.workspace_id AND o.id=r.occurrence_id
   LEFT JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id
   LEFT JOIN ls_practice.completion_reports p ON p.workspace_id=r.workspace_id AND p.id=r.corrects_report_id AND p.occurrence_id=r.occurrence_id AND p.author_account_id=r.author_account_id AND p.revision=r.revision-1
   WHERE o.id IS NULL OR c.id IS NULL OR NOT (r.author_account_id=ANY(c.assignee_account_ids)) OR (r.corrects_report_id IS NOT NULL AND p.id IS NULL)) AS sound`))[0]?.sound===true;
 return {
  baselineFunctions:participants.every(name=>matches(BASELINE,name)),
  reviewedFunctions:participants.every(name=>matches(PRACTICE_SUBJECT_GUARDS_MIGRATION.name,name)),
  immutableHistory:matches(BASELINE,'protect_immutable_row')&&matches(BASELINE,'check_active_version')&&unique.length===1&&unique[0]?.safe===true&&!!expectedUnique&&unique[0]?.body.replace(/\r\n/g,'\n')===expectedUnique,
  schemaCatalog,foreignKeys:objects?.foreignKeys===true,permissions:objects?.permissions===true,referencesSound,
 };
}
