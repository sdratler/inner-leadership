import {createHash} from 'node:crypto';
import type {SqlSession} from '../features/identity/store.ts';
import type {Migration} from './migration-plan.ts';

export const CONTACT_DELTA_MIGRATION={name:'0118_ls_contact_delta_history.sql',sha256:'89124785efc166f1f4aa1390f814798c2b63b71a874e37b4da10e11a7c0a202f'}as const;
/** First observation on disposable PostgreSQL17.11, 2026-10-04; older catalog
 * fingerprints are untouched. See the retained native catalog regression. */
export const CONTACT_DELTA_CATALOG_SHA256='79508512cd1fe99a0b6e281955a521a5ef359057f2f408045a2b1cfd6e82b56b';
export type ContactDeltaIntegrity={objectsAbsent:boolean;tables:boolean;schemaCatalog:boolean;foreignKeys:boolean;historyImmutable:boolean;reviewedFunctions:boolean;permissions:boolean;referencesSound:boolean};
const tables="('delta_operations','delta_history')";
export async function contactDeltaCatalog(tx:SqlSession):Promise<unknown>{
 return (await tx.query<{catalog:unknown}>(`SELECT json_build_object(
 'tables',(SELECT json_agg(json_build_object('name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables}),
 'columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE cn.nspname||'.'||co.collname END) ORDER BY c.relname,a.attnum)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT json_agg(json_build_object('table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND k.contype<>'n'),
 'indexes',(SELECT json_agg(json_build_object('table',c.relname,'name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY c.relname,ic.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables}),
 'triggers',(SELECT json_agg(json_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND NOT t.tgisinternal)) AS catalog`))[0]?.catalog;
}
export const contactDeltaCatalogDigest=(catalog:unknown)=>createHash('sha256').update(JSON.stringify(catalog)).digest('hex');

/** Read-only gate for this additive frame. Historical frames remain unchanged. */
export async function contactDeltaIntegrity(tx:SqlSession,files:readonly Migration[]):Promise<ContactDeltaIntegrity>{
 const file=files.find(row=>row.name===CONTACT_DELTA_MIGRATION.name);
 if(!file||file.checksum!==CONTACT_DELTA_MIGRATION.sha256||createHash('sha256').update(file.sql).digest('hex')!==file.checksum)throw Error('CONTACT_DELTA_SOURCE_MISMATCH');
 const objects=(await tx.query<Omit<ContactDeltaIntegrity,'schemaCatalog'|'reviewedFunctions'|'referencesSound'>>(`SELECT
 to_regclass('ls_contact_ops.delta_operations') IS NULL AND to_regclass('ls_contact_ops.delta_history') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_contact_ops' AND p.proname='deny_delta_history_mutation') AS "objectsAbsent",
 (SELECT count(*)=2 AND bool_and(c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables}) AS tables,
 (SELECT count(*)=3 AND bool_and(k.convalidated AND (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A')) FROM pg_trigger t WHERE t.tgconstraint=k.oid)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND k.contype='f') AS "foreignKeys",
 (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A') AND t.tgattr::text='' AND t.tgqual IS NULL AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgfoid=to_regprocedure('ls_contact_ops.deny_delta_history_mutation()') AND ((t.tgname=c.relname||'_no_edit' AND t.tgtype=27) OR (t.tgname=c.relname||'_no_truncate' AND t.tgtype=34))) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND NOT t.tgisinternal) AS "historyImmutable",
 (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_namespace n WHERE n.nspname='ls_contact_ops')
 AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='ls_contact_ops' AND acl.grantee<>n.nspowner)
 AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND acl.grantee<>c.relowner)
 AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)
 AND (SELECT count(*)=1 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_contact_ops' AND p.proname='deny_delta_history_mutation')
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='ls_contact_ops' AND p.proname='deny_delta_history_mutation' AND acl.grantee<>p.proowner) AS permissions`))[0];
 if(!objects)throw Error('CONTACT_DELTA_READBACK_INVALID');
 const functions=await tx.query<{body:string;safe:boolean}>(`SELECT p.prosrc AS body,
 p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND p.proconfig IS NULL AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_contact_ops' AND p.proname='deny_delta_history_mutation'`);
 const matches=[...file.sql.matchAll(/CREATE FUNCTION ls_contact_ops\.deny_delta_history_mutation\(\) RETURNS trigger LANGUAGE plpgsql AS \$fn\$([\s\S]*?)\$fn\$;/g)];
 const reviewedFunctions=matches.length===1&&functions.length===1&&functions[0]?.safe===true&&functions[0].body.replace(/\r\n/g,'\n')===matches[0]![1]!.replace(/\r\n/g,'\n');
 const schemaCatalog=objects.tables===true&&contactDeltaCatalogDigest(await contactDeltaCatalog(tx))===CONTACT_DELTA_CATALOG_SHA256;
 let referencesSound=false;
 if(schemaCatalog&&objects.foreignKeys===true)referencesSound=(await tx.query<{sound:boolean}>(`SELECT
 NOT EXISTS(SELECT 1 FROM ls_contact_ops.delta_operations d LEFT JOIN ls_identity.accounts a ON a.workspace_id=d.workspace_id AND a.id=d.actor_account_id WHERE a.id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.delta_history h LEFT JOIN ls_contact_ops.delta_operations d ON d.workspace_id=h.workspace_id AND d.operation_id=h.operation_id LEFT JOIN ls_contact_ops.profiles p ON p.workspace_id=h.workspace_id AND p.person_id=h.person_id WHERE d.operation_id IS NULL OR p.person_id IS NULL) AS sound`))[0]?.sound===true;
 return {objectsAbsent:objects.objectsAbsent===true,tables:objects.tables===true,schemaCatalog,foreignKeys:objects.foreignKeys===true,historyImmutable:objects.historyImmutable===true,reviewedFunctions,permissions:objects.tables===true&&objects.permissions===true,referencesSound};
}
