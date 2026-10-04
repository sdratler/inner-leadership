import {createHash} from 'node:crypto';
import type {SqlSession} from '../features/identity/store.ts';
import type {Migration} from './migration-plan.ts';
import {practiceResponsibilityIntegrity} from './practice-responsibility-integrity.ts';
export const PRACTICE_REMINDER_MIGRATION={name:'0115_ls_practice_notification_outbox.sql',sha256:'0a5bdcb355d8d9ace91e431851a1c027a00499de0fb705cc28cadaf3052fbae7'}as const;
/** The new namespace is observed independently; historical practice hashes stay frozen. */
export const PRACTICE_REMINDER_SCHEMA_SHA256='1c730b840faf71dcbe851dcf5f5a41e7ba33bd5033dc950a14106aee5ba04e1a';
export async function practiceReminderCatalog(tx:SqlSession):Promise<unknown>{
 return (await tx.query<{catalog:unknown}>(`SELECT json_build_object(
 'columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY c.relname,a.attnum)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='ls_notifications' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT json_agg(json_build_object('table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_notifications' AND k.contype<>'n'),
 'indexes',(SELECT json_agg(json_build_object('table',c.relname,'name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) ORDER BY c.relname,ic.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname='ls_notifications'),
 'triggers',(SELECT json_agg(json_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_notifications' AND NOT t.tgisinternal)) AS catalog`))[0]?.catalog;
}
/** Read-only catalog/body/ACL/reference evidence. Never repairs or loosens a gate. */
export async function practiceReminderIntegrity(tx:SqlSession,files:readonly Migration[]){
 const file=files.find(row=>row.name===PRACTICE_REMINDER_MIGRATION.name);
 if(!file||file.checksum!==PRACTICE_REMINDER_MIGRATION.sha256||createHash('sha256').update(file.sql).digest('hex')!==file.checksum)throw Error('PRACTICE_REMINDER_SOURCE_MISMATCH');
 const prior=(await practiceResponsibilityIntegrity(tx,files)).current;
 const metadataAbsent=(await tx.query<{absent:boolean}>(`SELECT to_regclass('ls_notifications.notification_outbox') IS NULL AND to_regclass('ls_notifications.message_deliveries') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='ls_notifications') AS absent`))[0]?.absent===true;
 const catalogSha256=createHash('sha256').update(JSON.stringify(await practiceReminderCatalog(tx))).digest('hex');
 const objects=(await tx.query<{tables:boolean;foreignKeys:boolean;permissions:boolean}>(`SELECT
 (SELECT count(*)=2 AND bool_and(c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_notifications' AND c.relkind IN ('r','p','v','m','f')) AS tables,
 (SELECT count(*)=7 AND bool_and(k.convalidated AND (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A')) FROM pg_trigger t WHERE t.tgconstraint=k.oid)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_notifications' AND k.contype='f') AS "foreignKeys",
 (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_namespace n WHERE n.nspname='ls_notifications')
  AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='ls_notifications' AND acl.grantee<>n.nspowner)
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_notifications' AND c.relkind='r' AND acl.grantee<>c.relowner)
  AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl WHERE n.nspname='ls_notifications' AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)
  AND (SELECT count(*)=3 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_notifications')
  AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE n.nspname='ls_notifications' AND acl.grantee<>p.proowner) AS permissions`))[0];
 const functions=await tx.query<{name:string;body:string;safe:boolean}>(`SELECT p.proname AS name,p.prosrc AS body,
 p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND p.proconfig IS NULL AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_notifications'`);
 const reviewedFunctions=['check_practice_notice_scope','preserve_delivery_evidence','check_delivery_scope'].every(name=>{
  const pattern=new RegExp(`CREATE FUNCTION ls_notifications\\.${name}\\(\\)\\s+RETURNS trigger LANGUAGE plpgsql AS \\$fn\\$([\\s\\S]*?)\\$fn\\$;`,'g'),matches=[...file.sql.matchAll(pattern)],rows=functions.filter(row=>row.name===name);
  return matches.length===1&&rows.length===1&&rows[0]?.safe===true&&rows[0].body.replace(/\r\n/g,'\n')===matches[0]![1]!.replace(/\r\n/g,'\n');
 });
 const schemaCatalog=objects?.tables===true&&catalogSha256===PRACTICE_REMINDER_SCHEMA_SHA256;
 let referencesSound=false;
 if(schemaCatalog&&objects?.foreignKeys===true)referencesSound=(await tx.query<{sound:boolean}>(`SELECT
 NOT EXISTS(SELECT 1 FROM ls_notifications.notification_outbox n
 LEFT JOIN ls_practice.practice_occurrences o ON o.workspace_id=n.workspace_id AND o.id=n.occurrence_id
 LEFT JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
 LEFT JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=o.workspace_id AND v.id=o.practice_version_id AND v.assignment_id=a.id
 LEFT JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id AND c.assignment_id=a.id AND c.case_id=a.case_id AND c.audience_id=a.audience_id AND c.responsibility_version_id=v.id
 WHERE o.id IS NULL OR a.id IS NULL OR v.id IS NULL OR c.id IS NULL OR v.responsibility IS NULL
 OR a.case_id IS DISTINCT FROM n.case_id OR a.audience_id IS DISTINCT FROM n.audience_id OR a.id IS DISTINCT FROM n.source_id OR v.id IS DISTINCT FROM n.source_version_id OR c.id IS DISTINCT FROM n.coordination_version_id OR o.occurs_at IS DISTINCT FROM n.due_at
 OR NOT(n.recipient_account_id=ANY(c.reminder_candidate_account_ids))
 OR n.purpose IS DISTINCT FROM coalesce((SELECT value->>'purpose' FROM jsonb_array_elements(v.responsibility->'reminderRecipients') WHERE value->>'accountId'=n.recipient_account_id::text),CASE WHEN n.recipient_account_id=ANY(c.assignee_account_ids) THEN 'self' END)
 OR n.idempotency_key IS DISTINCT FROM 'practice_due:'||n.occurrence_id::text||':'||n.recipient_account_id::text||':'||n.channel
 OR (n.available_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ls_notifications.message_deliveries d WHERE d.workspace_id=n.workspace_id AND d.outbox_id=n.id AND d.recorded_at=n.available_at)))
 AND NOT EXISTS(SELECT 1 FROM ls_notifications.message_deliveries d LEFT JOIN ls_notifications.notification_outbox n ON n.workspace_id=d.workspace_id AND n.id=d.outbox_id WHERE n.id IS NULL OR n.channel<>'in_app' OR n.available_at IS DISTINCT FROM d.recorded_at) AS sound`))[0]?.sound===true;
 return{prior,current:{metadataAbsent,schemaCatalog,foreignKeys:objects?.foreignKeys===true,permissions:objects?.permissions===true,reviewedFunctions,referencesSound},catalogSha256};
}
