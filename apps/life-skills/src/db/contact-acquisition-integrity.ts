import {createHash} from 'node:crypto';
import type {SqlSession} from '../features/identity/store.ts';
import type {Migration} from './migration-plan.ts';

export const ACQUISITION_CANDIDATES_MIGRATION={name:'0116_ls_acquisition_candidates.sql',sha256:'dbbdc216b9c01e815488b2d416ad268a1481d363fefff2e4b00fc4bd6b831635'}as const;
export const ACQUISITION_DECISIONS_MIGRATION={name:'0117_ls_acquisition_decisions.sql',sha256:'d8ed5bfced4f29b473a1e052dcfd2eb607d0777992c18b339b23c79e90c0c7b6'}as const;
export type AcquisitionCatalogPhase='candidate'|'decisions';
function catalogTables(phase:AcquisitionCatalogPhase){
 if(phase==='candidate')return "('inbound_activity_candidates')";
 if(phase==='decisions')return "('lead_promotion_operations','acquisition_projection_status')";
 throw Error('CONTACT_ACQUISITION_PHASE_INVALID');
}
/** Only this independently observed additive frame; older fingerprints stay frozen. */
export async function contactAcquisitionCatalog(tx:SqlSession,phase:AcquisitionCatalogPhase):Promise<unknown>{
 const tables=catalogTables(phase);
 return (await tx.query<{catalog:unknown}>(`SELECT json_build_object(
 'tables',(SELECT json_agg(json_build_object('name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables}),
 'columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE cn.nspname||'.'||co.collname END) ORDER BY c.relname,a.attnum)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT json_agg(json_build_object('table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND k.contype<>'n'),
 'indexes',(SELECT json_agg(json_build_object('table',c.relname,'name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY c.relname,ic.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables}),
 'triggers',(SELECT json_agg(json_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND NOT t.tgisinternal)) AS catalog`))[0]?.catalog;
}
export const acquisitionCatalogDigest=(catalog:unknown)=>createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
/** Fresh disposable PostgreSQL17.11 observations, not replacements for old frames. */
export const ACQUISITION_CANDIDATE_CATALOG_SHA256='0b1f1c7f40e633f289612db2499c7780b25bfe61548b34e58b99c3cf40874e7c';
export const ACQUISITION_DECISION_CATALOG_SHA256='c200b09a376f8046bf92fa75a1c65167023ba2b82adbc2198e20a10de61d01ea';
export type ContactAcquisitionIntegrity={objectsAbsent:boolean;tables:boolean;schemaCatalog:boolean;foreignKeys:boolean;historyImmutable:boolean;reviewedFunctions:boolean;permissions:boolean;referencesSound:boolean};

/** Read-only source/catalog/body/ACL/FK/reference proof. No repair or grants. */
export async function contactAcquisitionIntegrity(tx:SqlSession,files:readonly Migration[],phase:AcquisitionCatalogPhase):Promise<ContactAcquisitionIntegrity>{
 const tables=catalogTables(phase),migration=phase==='candidate'?ACQUISITION_CANDIDATES_MIGRATION:ACQUISITION_DECISIONS_MIGRATION;
 for(const expected of [ACQUISITION_CANDIDATES_MIGRATION,...(phase==='decisions'?[ACQUISITION_DECISIONS_MIGRATION]:[])]){
  const file=files.find(row=>row.name===expected.name);
  if(!file||file.checksum!==expected.sha256||createHash('sha256').update(file.sql).digest('hex')!==file.checksum)throw Error('CONTACT_ACQUISITION_SOURCE_MISMATCH');
 }
 const absent=phase==='candidate'?"to_regclass('ls_contact_ops.inbound_activity_candidates') IS NULL AND to_regclass('ls_contact_ops.acquisition_candidates_recent') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_contact_ops' AND p.proname='deny_acquisition_receipt_mutation')":"to_regclass('ls_contact_ops.lead_promotion_operations') IS NULL AND to_regclass('ls_contact_ops.acquisition_projection_status') IS NULL";
 const historyTable=phase==='candidate'?'inbound_activity_candidates':'lead_promotion_operations',triggerPrefix=phase==='candidate'?'acquisition_candidates':'acquisition_decisions';
 const objects=(await tx.query<Omit<ContactAcquisitionIntegrity,'schemaCatalog'|'reviewedFunctions'|'referencesSound'>>(`SELECT
 ${absent} AS "objectsAbsent",
 (SELECT count(*)=${phase==='candidate'?1:2} AND bool_and(c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables}) AS tables,
 (SELECT count(*)=${phase==='candidate'?1:4} AND bool_and(k.convalidated AND (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A')) FROM pg_trigger t WHERE t.tgconstraint=k.oid)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND k.contype='f') AS "foreignKeys",
 (SELECT count(*)=2 AND bool_and(t.tgenabled IN ('O','A') AND t.tgattr::text='' AND t.tgqual IS NULL AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgfoid=to_regprocedure('ls_contact_ops.deny_acquisition_receipt_mutation()') AND ((t.tgname='${triggerPrefix}_no_edit' AND t.tgtype=27) OR (t.tgname='${triggerPrefix}_no_truncate' AND t.tgtype=34))) FROM pg_trigger t WHERE t.tgrelid=to_regclass('ls_contact_ops.${historyTable}') AND NOT t.tgisinternal) AS "historyImmutable",
 (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_namespace n WHERE n.nspname='ls_contact_ops')
 AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='ls_contact_ops' AND acl.grantee<>n.nspowner)
 AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND acl.grantee<>c.relowner)
 AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl WHERE n.nspname='ls_contact_ops' AND c.relname IN ${tables} AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)
 AND (SELECT count(*)=1 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_contact_ops' AND p.proname='deny_acquisition_receipt_mutation')
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='ls_contact_ops' AND p.proname='deny_acquisition_receipt_mutation' AND acl.grantee<>p.proowner) AS permissions`))[0];
 if(!objects)throw Error('CONTACT_ACQUISITION_READBACK_INVALID');
 const functions=await tx.query<{body:string;safe:boolean}>(`SELECT p.prosrc AS body,
 p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_contact_ops' AND p.proname='deny_acquisition_receipt_mutation'`);
 const source=files.find(row=>row.name===ACQUISITION_CANDIDATES_MIGRATION.name)!.sql;
 const matches=[...source.matchAll(/CREATE FUNCTION ls_contact_ops\.deny_acquisition_receipt_mutation\(\) RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS \$fn\$([\s\S]*?)\$fn\$;/g)];
 const reviewedFunctions=matches.length===1&&functions.length===1&&functions[0]?.safe===true&&functions[0].body.replace(/\r\n/g,'\n')===matches[0]![1]!.replace(/\r\n/g,'\n');
 const schemaCatalog=objects.tables===true&&acquisitionCatalogDigest(await contactAcquisitionCatalog(tx,phase))===(migration===ACQUISITION_CANDIDATES_MIGRATION?ACQUISITION_CANDIDATE_CATALOG_SHA256:ACQUISITION_DECISION_CATALOG_SHA256);
 let referencesSound=false;
 if(schemaCatalog&&objects.foreignKeys===true)referencesSound=(await tx.query<{sound:boolean}>(phase==='candidate'?`SELECT NOT EXISTS(SELECT 1 FROM ls_contact_ops.inbound_activity_candidates c LEFT JOIN ls_identity.workspaces w ON w.id=c.workspace_id WHERE w.id IS NULL) AS sound`:`SELECT
 NOT EXISTS(SELECT 1 FROM ls_contact_ops.lead_promotion_operations d
 LEFT JOIN ls_contact_ops.inbound_activity_candidates c ON c.workspace_id=d.workspace_id AND c.id=d.candidate_id
 LEFT JOIN ls_identity.accounts a ON a.workspace_id=d.workspace_id AND a.id=d.actor_account_id
 LEFT JOIN ls_contact_ops.profiles p ON p.workspace_id=d.workspace_id AND p.person_id=d.person_id
 WHERE c.id IS NULL OR a.id IS NULL OR (d.person_id IS NOT NULL AND p.person_id IS NULL)
 OR (d.state='NOT_A_LEAD') IS DISTINCT FROM (d.person_id IS NULL)
 OR (SELECT count(*) FROM ls_contact_ops.acquisition_projection_status s WHERE s.workspace_id=d.workspace_id AND s.operation_id=d.operation_id)<>CASE WHEN d.state='NOT_A_LEAD' THEN 0 ELSE 2 END)
 AND NOT EXISTS(SELECT 1 FROM ls_contact_ops.acquisition_projection_status s LEFT JOIN ls_contact_ops.lead_promotion_operations d ON d.workspace_id=s.workspace_id AND d.operation_id=s.operation_id WHERE d.operation_id IS NULL OR d.state='NOT_A_LEAD') AS sound`))[0]?.sound===true;
 return {objectsAbsent:objects.objectsAbsent===true,tables:objects.tables===true,schemaCatalog,foreignKeys:objects.foreignKeys===true,historyImmutable:objects.historyImmutable===true,reviewedFunctions,permissions:objects.tables===true&&objects.permissions===true,referencesSound};
}
