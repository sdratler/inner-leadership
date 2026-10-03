import {createHash} from "node:crypto";
import type {SqlSession} from "../features/identity/store.ts";
import type {Migration} from "./migration-plan.ts";
import {practiceAdultCoordinationIntegrity} from "./practice-adult-coordination-integrity.ts";
import type {PracticeSubjectIntegrity} from "./practice-subject-integrity.ts";
export const PRACTICE_RESPONSIBILITY_MIGRATION={name:"0114_ls_practice_responsibilities.sql",sha256:"f0403ceccdcd45638f8ab3bca23e757d79e769c77747869c7a0b7a0cf071e0ab"}as const;
/** Independently observed PG17.11 frame; never replaces the 0040/0107 hash. */
export const PRACTICE_RESPONSIBILITY_SCHEMA_SHA256="9f3741c23693c9b55f9ab6f87c0f6f7bec2d2770c281c2ba5b307116ecb9d211";
export type PracticeResponsibilityFrame={metadataAbsent:boolean;schemaCatalog:boolean;foreignKeys:boolean;permissions:boolean;reviewedFunctions:boolean;immutableHistory:boolean;referencesSound:boolean};
export type PracticeResponsibilityIntegrity={prior:PracticeSubjectIntegrity;current:PracticeResponsibilityFrame};
function newBody(files:readonly Migration[],name:string){
 const sql=files.find(file=>file.name===PRACTICE_RESPONSIBILITY_MIGRATION.name)?.sql;
 const pattern=new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ls_practice\\.${name}\\(\\)\\s+RETURNS trigger LANGUAGE plpgsql AS \\$fn\\$([\\s\\S]*?)\\$fn\\$;`,"g"),matches=sql?[...sql.matchAll(pattern)]:[];
 if(matches.length!==1)throw Error("PRACTICE_RESPONSIBILITY_FUNCTION_SOURCE_INVALID");return matches[0]![1]!.replace(/\r\n/g,"\n");
}
/** Read-only source/catalog/body/ACL/data proof. No drift repair or grants. */
export async function practiceResponsibilityIntegrity(tx:SqlSession,files:readonly Migration[]):Promise<PracticeResponsibilityIntegrity>{
 const file=files.find(file=>file.name===PRACTICE_RESPONSIBILITY_MIGRATION.name);
 if(!file||file.checksum!==PRACTICE_RESPONSIBILITY_MIGRATION.sha256||createHash("sha256").update(file.sql).digest("hex")!==file.checksum)throw Error("PRACTICE_RESPONSIBILITY_SOURCE_MISMATCH");
 const prior=(await practiceAdultCoordinationIntegrity(tx,files)).current;
 const metadataAbsent=(await tx.query<{absent:boolean}>(`SELECT
  NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='ls_practice.practice_assignment_versions'::regclass AND attname='responsibility' AND NOT attisdropped)
  AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='ls_practice.task_coordination_versions'::regclass AND attname IN ('responsibility_version_id','participant','assisted_parent_account_ids') AND NOT attisdropped)
  AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='ls_practice.practice_occurrences'::regclass AND attname IN ('occurs_at','cancelled_at','superseded_by_version_id') AND NOT attisdropped)
  AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='ls_practice.completion_reports'::regclass AND attname IN ('subject_person_id','authorship','note_ciphertext') AND NOT attisdropped)
  AND to_regprocedure('ls_practice.check_responsibility_occurrence()') IS NULL AS absent`))[0]?.absent===true;
 const catalog=(await tx.query<{catalog:unknown}>(`SELECT json_build_object(
  'columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY c.relname,a.attnum)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='ls_practice' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT json_agg(json_build_object('table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_practice' AND k.contype<>'n'),
  'indexes',(SELECT json_agg(json_build_object('table',c.relname,'name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY c.relname,ic.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname='ls_practice'),
  'triggers',(SELECT json_agg(json_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_practice' AND NOT t.tgisinternal)) AS catalog`))[0]?.catalog;
 const objects=(await tx.query<{tables:boolean;foreignKeys:boolean;permissions:boolean}>(`SELECT
  (SELECT count(*)=8 AND bool_and(c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_practice' AND c.relkind IN ('r','p','v','m','f')) AS tables,
  (SELECT count(*)=30 AND bool_and(k.convalidated AND (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A')) FROM pg_trigger t WHERE t.tgconstraint=k.oid)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_practice' AND k.contype='f') AS "foreignKeys",
  (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_namespace n WHERE n.nspname='ls_practice')
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='ls_practice' AND acl.grantee<>n.nspowner)
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_practice' AND c.relkind='r' AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl WHERE n.nspname='ls_practice' AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)
   AND (SELECT count(*)=6 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_practice')
   AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='ls_practice' AND (acl.grantee NOT IN (0,p.proowner) OR acl.privilege_type<>'EXECUTE' OR (acl.grantee=0 AND acl.is_grantable))) AS permissions`))[0];
 const schemaCatalog=objects?.tables===true&&createHash("sha256").update(JSON.stringify(catalog)).digest("hex")===PRACTICE_RESPONSIBILITY_SCHEMA_SHA256;
 const functions=await tx.query<{name:string;body:string;safe:boolean}>(`SELECT p.proname AS name,p.prosrc AS body,
  p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
   AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND p.proconfig IS NULL
   AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_practice'
   AND p.proname IN ('check_coordination_actor_and_assignees','check_completion_author','check_responsibility_occurrence')`);
 const reviewedFunctions=["check_coordination_actor_and_assignees","check_completion_author","check_responsibility_occurrence"].every(name=>{const rows=functions.filter(row=>row.name===name);return rows.length===1&&rows[0]?.safe===true&&rows[0]?.body.replace(/\r\n/g,"\n")===newBody(files,name);});
 // The prior reader still checks the ORIGINAL immutable/history and UUID bodies.
 // Its old schema/body/FK flags remain false after this genuinely new frame.
 const immutableHistory=prior.immutableHistory;
 let referencesSound=false;
 if(schemaCatalog&&objects?.foreignKeys===true)referencesSound=(await tx.query<{sound:boolean}>(`SELECT
  NOT EXISTS(SELECT 1 FROM ls_practice.practice_assignments a LEFT JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=a.workspace_id AND v.id=a.active_version_id AND v.assignment_id=a.id WHERE a.active_version_id IS NOT NULL AND (v.id IS NULL OR v.state<>'published'))
  AND NOT EXISTS(SELECT 1 FROM ls_practice.task_coordination_versions c LEFT JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=c.workspace_id AND v.id=c.responsibility_version_id AND v.assignment_id=c.assignment_id
   WHERE c.responsibility_version_id IS NOT NULL AND (v.id IS NULL OR v.state<>'published' OR v.responsibility IS NULL OR c.participant IS DISTINCT FROM v.responsibility->>'participant'))
  AND NOT EXISTS(SELECT 1 FROM ls_practice.practice_occurrences o
   LEFT JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
   LEFT JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=o.workspace_id AND v.id=o.practice_version_id AND v.assignment_id=o.assignment_id
   LEFT JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id AND c.assignment_id=o.assignment_id AND c.case_id=a.case_id AND c.audience_id=a.audience_id
   LEFT JOIN ls_practice.practice_assignment_versions next ON next.workspace_id=o.workspace_id AND next.id=o.superseded_by_version_id AND next.assignment_id=o.assignment_id
   WHERE a.id IS NULL OR v.id IS NULL OR v.state<>'published' OR c.id IS NULL
    OR (v.responsibility IS NULL AND (c.responsibility_version_id IS NOT NULL OR o.occurs_at IS NOT NULL))
    OR (v.responsibility IS NOT NULL AND (c.responsibility_version_id IS DISTINCT FROM v.id OR o.occurs_at IS NULL
     OR o.period IS DISTINCT FROM v.responsibility->>'period' OR (o.occurs_at AT TIME ZONE (v.responsibility->>'timezone'))::date IS DISTINCT FROM o.occurs_on
     OR to_char(o.occurs_at AT TIME ZONE (v.responsibility->>'timezone'),'HH24:MI') IS DISTINCT FROM v.responsibility->>'localTime'))
    OR (o.state='cancelled' AND (next.id IS NULL OR next.id=v.id OR next.state<>'published' OR EXISTS(SELECT 1 FROM ls_practice.completion_reports r WHERE r.workspace_id=o.workspace_id AND r.occurrence_id=o.id))))
  AND NOT EXISTS(SELECT 1 FROM ls_practice.completion_reports r
   LEFT JOIN ls_practice.practice_occurrences o ON o.workspace_id=r.workspace_id AND o.id=r.occurrence_id
   LEFT JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id
   LEFT JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
   LEFT JOIN ls_cases.cases ca ON ca.workspace_id=a.workspace_id AND ca.id=a.case_id
   LEFT JOIN ls_cases.clients cl ON cl.workspace_id=ca.workspace_id AND cl.id=ca.client_id
   LEFT JOIN ls_practice.completion_reports p ON p.workspace_id=r.workspace_id AND p.id=r.corrects_report_id AND p.occurrence_id=r.occurrence_id AND p.author_account_id=r.author_account_id AND p.revision=r.revision-1
   WHERE o.id IS NULL OR c.id IS NULL OR o.state='cancelled' OR (r.corrects_report_id IS NOT NULL AND p.id IS NULL)
    OR (c.responsibility_version_id IS NULL AND (NOT (r.author_account_id=ANY(c.assignee_account_ids)) OR r.subject_person_id IS NOT NULL OR r.authorship IS NOT NULL OR r.note_ciphertext IS NOT NULL))
    OR (c.responsibility_version_id IS NOT NULL AND (r.subject_person_id IS DISTINCT FROM cl.person_id OR r.authorship IS NULL OR r.note_ciphertext IS NULL
     OR (r.authorship='self' AND NOT (r.author_account_id=ANY(c.assignee_account_ids)))
     OR (r.authorship<>'self' AND (c.participant<>'client' OR NOT (r.author_account_id=ANY(c.assisted_parent_account_ids))))))) AS sound`))[0]?.sound===true;
 return {prior,current:{metadataAbsent,schemaCatalog,foreignKeys:objects?.foreignKeys===true,permissions:objects?.permissions===true,reviewedFunctions,immutableHistory,referencesSound}};
}
