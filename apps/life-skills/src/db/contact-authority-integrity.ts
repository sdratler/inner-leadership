import type {SqlSession} from '../features/identity/store.ts';
import type {Migration} from './migration-plan.ts';
import {contactAuthoritySchemaCatalogMatches,contactOpsFunctionBody,CONTACT_AUTHORITY_MIGRATION,type ContactAuthorityIntegrityObjects} from './contact-ops-production-guard.ts';

/** Read-only native catalog proof, shared by the exact-target production gate and
 * disposable tests. No transitions, repairs, DDL, contact reads or provider work. */
export async function contactAuthorityIntegrity(tx:SqlSession,files:readonly Migration[]):Promise<ContactAuthorityIntegrityObjects>{
 const objects=(await tx.query<Omit<ContactAuthorityIntegrityObjects,'schemaCatalog'|'appendOnlyFunction'|'referencesSound'>>(`SELECT
  to_regclass('ls_contact_ops.cutover') IS NULL AND to_regclass('ls_contact_ops.cutover_history') IS NULL
   AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='ls_contact_ops' AND p.proname='deny_cutover_history_mutation')
   AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ls_contact_ops' AND t.tgname IN ('cutover_history_no_edit','cutover_history_no_truncate')) AS "objectsAbsent",
  (SELECT count(*)=2 AND bool_and(c.relkind='r' AND c.relpersistence='p'
   AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='ls_contact_ops' AND c.relname IN ('cutover','cutover_history')) AS tables,
  (SELECT count(*)=3 AND bool_and(k.convalidated AND
   (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A')) FROM pg_trigger t WHERE t.tgconstraint=k.oid))
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='ls_contact_ops' AND c.relname IN ('cutover','cutover_history') AND k.contype='f') AS "foreignKeys",
  (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid=to_regclass('ls_contact_ops.cutover_history') AND NOT tgisinternal)
   AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('ls_contact_ops.cutover') AND NOT tgisinternal)
   AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='cutover_history_no_edit'
    AND tgrelid=to_regclass('ls_contact_ops.cutover_history') AND NOT tgisinternal
    AND tgenabled IN ('O','A') AND tgtype=27 AND tgattr::text='' AND tgqual IS NULL
    AND tgfoid=to_regprocedure('ls_contact_ops.deny_cutover_history_mutation()'))
   AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='cutover_history_no_truncate'
    AND tgrelid=to_regclass('ls_contact_ops.cutover_history') AND NOT tgisinternal
    AND tgenabled IN ('O','A') AND tgtype=34 AND tgattr::text='' AND tgqual IS NULL
    AND tgfoid=to_regprocedure('ls_contact_ops.deny_cutover_history_mutation()')) AS "historyImmutable",
  (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_namespace n WHERE n.nspname='ls_contact_ops')
   AND (SELECT count(*)=2 AND bool_and(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ls_contact_ops' AND c.relname IN ('cutover','cutover_history'))
   AND (SELECT count(*)=1 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='ls_contact_ops' AND p.proname='deny_cutover_history_mutation')
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
    WHERE n.nspname='ls_contact_ops' AND acl.grantee<>n.nspowner)
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
    LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    WHERE n.nspname='ls_contact_ops' AND c.relname IN ('cutover','cutover_history') AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,
    LATERAL aclexplode(a.attacl) acl WHERE n.nspname='ls_contact_ops' AND c.relname IN ('cutover','cutover_history')
    AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE n.nspname='ls_contact_ops' AND p.proname='deny_cutover_history_mutation' AND acl.grantee<>p.proowner) AS "publicRevoked"`))[0];
 if(!objects)throw new Error('CONTACT_OPS_AUTHORITY_READBACK_INVALID');
 const columns=(await tx.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
  'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
  'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
  ORDER BY c.relname,a.attnum),'[]'::json) AS catalog FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='ls_contact_ops' AND c.relname IN ('cutover','cutover_history') AND a.attnum>0 AND NOT a.attisdropped`))[0]?.catalog;
 const constraints=(await tx.query<{catalog:unknown;validated:boolean}>(`SELECT coalesce(json_agg(json_build_object(
  'table',c.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]'::json) AS catalog,
  coalesce(bool_and(k.convalidated),false) AS validated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ('cutover','cutover_history')`))[0];
 const fn=await tx.query<{body:string;safe:boolean}>(`SELECT p.prosrc AS body,
  p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.prokind='f' AND p.pronargs=0
   AND p.prorettype='trigger'::regtype AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef
   AND p.proconfig IS NULL AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe
  FROM pg_proc p WHERE p.oid=to_regprocedure('ls_contact_ops.deny_cutover_history_mutation()')`);
 let referencesSound=false;
 if(objects.tables){
  referencesSound=(await tx.query<{sound:boolean}>(`SELECT
   NOT EXISTS(SELECT 1 FROM ls_contact_ops.cutover c LEFT JOIN ls_identity.workspaces w ON w.id=c.workspace_id WHERE w.id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.cutover_history h LEFT JOIN ls_contact_ops.cutover c ON c.workspace_id=h.workspace_id WHERE c.workspace_id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.cutover_history h LEFT JOIN ls_identity.accounts a ON a.workspace_id=h.workspace_id AND a.id=h.actor_account_id WHERE a.id IS NULL) AS sound`))[0]?.sound===true;
 }
 return {...objects,schemaCatalog:constraints?.validated===true&&contactAuthoritySchemaCatalogMatches(columns,constraints.catalog),
  appendOnlyFunction:fn.length===1&&fn[0]?.safe===true&&fn[0]?.body===contactOpsFunctionBody(files,CONTACT_AUTHORITY_MIGRATION.name,'ls_contact_ops.deny_cutover_history_mutation'),referencesSound};
}
