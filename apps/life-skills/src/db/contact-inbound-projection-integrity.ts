import {createHash} from 'node:crypto';
import type {SqlSession} from '../features/identity/store.ts';
import type {Migration} from './migration-plan.ts';

export const CONTACT_INBOUND_PROJECTION_MIGRATION={name:'0109_ls_contact_inbound_projection.sql',
 sha256:'b7dfad436d24a2a44fe08f74658d4571d6288ad9e5fa973f495cec5514444218'} as const;
/** Filled from the actual isolated native PostgreSQL catalog, never object names
 * alone. PostgreSQL 18 NOT NULL entries are compared via column attnotnull. */
export const CONTACT_INBOUND_PROJECTION_CATALOG={columns:19,constraints:21,
 sha256:'feb6653bcc0c8786107ba24a1496e9aca15a629ac1ac99a488c2977fb8ed290d'} as const;
export type ContactInboundProjectionIntegrity={objectsAbsent:boolean;tables:boolean;schemaCatalog:boolean;
 foreignKeys:boolean;historyImmutable:boolean;livePersonGuards:boolean;reviewedFunctions:boolean;permissions:boolean;referencesSound:boolean};
export function inboundProjectionCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==CONTACT_INBOUND_PROJECTION_CATALOG.columns||!Array.isArray(constraints))return false;
 const compared=constraints.filter(row=>row?.type!=='n');
 return compared.length===CONTACT_INBOUND_PROJECTION_CATALOG.constraints&&
  createHash('sha256').update(JSON.stringify({columns,constraints:compared})).digest('hex')===CONTACT_INBOUND_PROJECTION_CATALOG.sha256;
}
function body(files:readonly Migration[],name:string):string{
 const sql=files.find(f=>f.name===CONTACT_INBOUND_PROJECTION_MIGRATION.name)?.sql;
 const marker=`CREATE FUNCTION ls_contact_ops.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$`;
 const start=sql?.indexOf(marker)??-1,end=start<0?-1:sql!.indexOf('$fn$;',start+marker.length);
 if(start<0||end<0||sql!.indexOf(marker,start+marker.length)>=0)throw Error('CONTACT_OPS_PROJECTION_FUNCTION_SOURCE_MISSING');
 return sql!.slice(start+marker.length,end);
}
/** Read-only catalog, body, FK, live-person and ACL proof. No repairs/DDL,
 * decrypted business payloads, provider calls, phase switch or sends. */
export async function contactInboundProjectionIntegrity(tx:SqlSession,files:readonly Migration[]):Promise<ContactInboundProjectionIntegrity>{
 const objects=(await tx.query<Omit<ContactInboundProjectionIntegrity,'schemaCatalog'|'reviewedFunctions'|'referencesSound'>>(`SELECT
  to_regclass('ls_contact_ops.inbound_threads') IS NULL AND to_regclass('ls_contact_ops.inbound_projections') IS NULL
   AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_contact_ops'
    AND p.proname IN ('require_inbound_live_person','deny_inbound_projection_mutation'))
   AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ls_contact_ops' AND t.tgname IN ('inbound_thread_live_person','inbound_projection_live_person',
     'inbound_threads_no_edit','inbound_threads_no_truncate','inbound_projections_no_edit','inbound_projections_no_truncate')) AS "objectsAbsent",
  (SELECT count(*)=2 AND bool_and(c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops'
    AND c.relname IN ('inbound_threads','inbound_projections')) AS tables,
  (SELECT count(*)=5 AND bool_and(k.convalidated AND (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A'))
    FROM pg_trigger t WHERE t.tgconstraint=k.oid)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops'
    AND c.relname IN ('inbound_threads','inbound_projections') AND k.contype='f') AS "foreignKeys",
  (SELECT count(*)=6 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='ls_contact_ops' AND c.relname IN ('inbound_threads','inbound_projections') AND NOT t.tgisinternal)
   AND (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A') AND NOT t.tgisinternal AND t.tgattr::text='' AND t.tgqual IS NULL
    AND t.tgfoid=to_regprocedure('ls_contact_ops.deny_inbound_projection_mutation()') AND
     ((t.tgname=c.relname||'_no_edit' AND t.tgtype=27) OR (t.tgname=c.relname||'_no_truncate' AND t.tgtype=34)))
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ls_contact_ops' AND c.relname IN ('inbound_threads','inbound_projections')
     AND t.tgname IN ('inbound_threads_no_edit','inbound_threads_no_truncate','inbound_projections_no_edit','inbound_projections_no_truncate')) AS "historyImmutable",
  (SELECT count(*)=2 AND bool_and(t.tgenabled IN ('O','A') AND NOT t.tgisinternal AND t.tgtype=7 AND t.tgattr::text='' AND t.tgqual IS NULL
   AND t.tgfoid=to_regprocedure('ls_contact_ops.require_inbound_live_person()')
   AND ((t.tgname='inbound_thread_live_person' AND c.relname='inbound_threads') OR
    (t.tgname='inbound_projection_live_person' AND c.relname='inbound_projections')))
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops'
    AND c.relname IN ('inbound_threads','inbound_projections') AND t.tgname IN ('inbound_thread_live_person','inbound_projection_live_person')) AS "livePersonGuards",
  (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_namespace n WHERE n.nspname='ls_contact_ops')
   AND (SELECT count(*)=2 AND bool_and(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ls_contact_ops' AND c.relname IN ('inbound_threads','inbound_projections'))
   AND (SELECT count(*)=2 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='ls_contact_ops' AND p.proname IN ('require_inbound_live_person','deny_inbound_projection_mutation'))
   AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
    WHERE n.nspname='ls_contact_ops' AND acl.grantee<>n.nspowner)
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    WHERE n.nspname='ls_contact_ops' AND c.relname IN ('inbound_threads','inbound_projections') AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl
    WHERE n.nspname='ls_contact_ops' AND c.relname IN ('inbound_threads','inbound_projections') AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE n.nspname='ls_contact_ops' AND p.proname IN ('require_inbound_live_person','deny_inbound_projection_mutation') AND acl.grantee<>p.proowner) AS permissions`))[0];
 if(!objects)throw Error('CONTACT_OPS_PROJECTION_READBACK_INVALID');
 const columns=(await tx.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
  'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY c.relname,a.attnum),'[]'::json) AS catalog
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='ls_contact_ops' AND c.relname IN ('inbound_threads','inbound_projections') AND a.attnum>0 AND NOT a.attisdropped`))[0]?.catalog;
 const constraints=(await tx.query<{catalog:unknown;validated:boolean}>(`SELECT coalesce(json_agg(json_build_object('table',c.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]'::json) AS catalog,
  coalesce(bool_and(k.convalidated),false) AS validated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='ls_contact_ops' AND c.relname IN ('inbound_threads','inbound_projections')`))[0];
 const functions=await tx.query<{name:string;body:string;safe:boolean}>(`SELECT p.proname AS name,p.prosrc AS body,
  p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
   AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
   AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='ls_contact_ops' AND p.proname IN ('require_inbound_live_person','deny_inbound_projection_mutation')`);
 let referencesSound=false;
 if(objects.tables)referencesSound=(await tx.query<{sound:boolean}>(`SELECT
  NOT EXISTS(SELECT 1 FROM ls_contact_ops.inbound_threads t LEFT JOIN ls_contact_ops.profiles p ON p.workspace_id=t.workspace_id AND p.person_id=t.person_id
   WHERE p.person_id IS NULL OR p.record_mode<>'live' OR p.demo_batch_id IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.inbound_projections i LEFT JOIN ls_contact_ops.message_receipts r
   ON r.workspace_id=i.workspace_id AND r.channel=i.channel AND r.provider_binding_id=i.provider_binding_id AND r.provider_event_key=i.provider_event_key
   WHERE r.workspace_id IS NULL OR r.provider_message_key<>i.provider_message_key)
  AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.inbound_projections i LEFT JOIN ls_contact_ops.profiles p ON p.workspace_id=i.workspace_id AND p.person_id=i.person_id
   LEFT JOIN ls_contact_ops.inbound_threads t ON t.workspace_id=i.workspace_id AND t.provider_binding_id=i.provider_binding_id AND t.provider_thread_key=i.provider_thread_key
   WHERE i.state='projected' AND (p.person_id IS NULL OR p.record_mode<>'live' OR p.demo_batch_id IS NOT NULL OR t.person_id IS DISTINCT FROM i.person_id)) AS sound`))[0]?.sound===true;
 return {...objects,schemaCatalog:constraints?.validated===true&&inboundProjectionCatalogMatches(columns,constraints.catalog),
  reviewedFunctions:functions.length===2&&functions.every(f=>f.safe===true&&f.body===body(files,f.name)),referencesSound};
}
