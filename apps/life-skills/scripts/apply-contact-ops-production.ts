/** Reviewed additive native CRM/task schema gate for the registered dedicated app DB.
 * Run only inside the deployed app service after exact-deployment readback,
 * current full encrypted backup/restore proof and protected checks. It does
 * not import contacts, switch CRM authority, send messages or change providers.
 *
 * First obtain an owner-private, authenticated Railway variable readback from
 * BOTH exact service IDs: SHA-256(app LS_DATABASE_URL) must equal
 * SHA-256(database service DATABASE_URL). Supply only that verified digest:
 * Compare the reviewed source-file bundle by authenticated Railway SSH with the exact
 * reviewed Git head; supply that normalized bundle digest on both calls.
 * node --import tsx scripts/apply-contact-ops-production.ts --preflight --deployment=<Railway deployment ID> --database-binding=<database service ID>:<verified digest> --source-bundle=<reviewed remote digest>
 * node --import tsx scripts/apply-contact-ops-production.ts --apply --deployment=<same ID> --database-binding=<same ID>:<same digest> --source-bundle=<same reviewed digest>
 */
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {migrate} from '../src/db/migration-runner.ts';
import {contactAuthorityIntegrity} from '../src/db/contact-authority-integrity.ts';
import {contactInboundIntegrity} from '../src/db/contact-inbound-integrity.ts';
import {practiceSubjectIntegrity,PRACTICE_SUBJECT_GUARDS_MIGRATION} from '../src/db/practice-subject-integrity.ts';
import {progressReviewIntegrity,PROGRESS_REVIEW_REVISIONS_MIGRATION} from '../src/db/progress-review-integrity.ts';
import {contactInboundProjectionIntegrity,CONTACT_INBOUND_PROJECTION_MIGRATION} from '../src/db/contact-inbound-projection-integrity.ts';
import {contactOutboundProjectionIntegrity,CONTACT_OUTBOUND_PROJECTION_MIGRATION} from '../src/db/contact-outbound-projection-integrity.ts';
import {practiceAdultCoordinationIntegrity,PRACTICE_ADULT_COORDINATION_MIGRATION} from '../src/db/practice-adult-coordination-integrity.ts';
import {assertContactOpsDatabaseIdentity,calendarAppendOnlyFunctionBody,contactOpsBaselineRecordsMatches,contactOpsCanonicalConstraint,contactOpsFunctionBody,contactOpsMigrationState,contactOpsProductionTarget,contactOpsSchemaCatalogMatches,contactOpsSourceBundle,internalTaskSchemaCatalogMatches,sourceTaskSchemaCatalogMatches,voiceRuleSchemaCatalogMatches,CONTACT_OPS_MIGRATION,CONTACT_OPS_SOURCE_FILES,type ContactOpsIntegrityObjects,type InternalTaskIntegrityObjects,type SourceTaskIntegrityObjects,type VoiceRuleIntegrityObjects} from '../src/db/contact-ops-production-guard.ts';
import type {AppliedMigration,Migration} from '../src/db/migration-plan.ts';

async function migrations():Promise<Migration[]>{
 const root=new URL('../migrations/',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')) as unknown;
 if(!Array.isArray(manifest)||!manifest.length||manifest.some(item=>!item||typeof item!=='object'||typeof item.name!=='string'||typeof item.sha256!=='string'||!/^\d{4}_[a-z][a-z0-9_]*\.sql$/.test(item.name)||!/^[a-f0-9]{64}$/.test(item.sha256)))throw new Error('CONTACT_OPS_MANIFEST_INVALID');
 const entries=manifest as {name:string;sha256:string}[];
 const actual=(await readdir(fileURLToPath(root))).filter(name=>name.endsWith('.sql')).sort();
 if(JSON.stringify(actual)!==JSON.stringify(entries.map(item=>item.name).sort()))throw new Error('CONTACT_OPS_MIGRATION_INVENTORY_MISMATCH');
 const files:Migration[]=[];
 for(const entry of entries){
  const bytes=await readFile(new URL(entry.name,root));
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('CONTACT_OPS_MIGRATION_CHECKSUM_MISMATCH');
  files.push({name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')});
 }
 return files;
}

async function main(){
 const target=contactOpsProductionTarget(process.env,process.argv.slice(2));
 const appRoot=new URL('../',import.meta.url);
 const sourceEntries=await Promise.all(CONTACT_OPS_SOURCE_FILES.map(async path=>({path,bytes:await readFile(new URL(path,appRoot))})));
 if(contactOpsSourceBundle(sourceEntries)!==target.sourceBundleSha256)throw new Error('CONTACT_OPS_SOURCE_PROVENANCE_MISMATCH');
 const files=await migrations();
 // The state gate admits at most one exact reviewed suffix. Every preceding
 // body, catalog and permission gate must pass before 0110 may be applied.
 // The strict state gate refuses partial or unreviewed schema before any write.
 if(!files.some(file=>file.name===CONTACT_OPS_MIGRATION.name&&file.checksum===CONTACT_OPS_MIGRATION.sha256))throw new Error('CONTACT_OPS_MIGRATION_MISSING');
 const reviewedMigration=files.at(-1)!;
 const functionBodies=new Map([
  ['ls_demo.prevent_marker_change',contactOpsFunctionBody(files,'0097_ls_demo_provenance.sql','ls_demo.prevent_marker_change')],
  ['ls_contact_ops.require_profile_provenance',contactOpsFunctionBody(files,CONTACT_OPS_MIGRATION.name,'ls_contact_ops.require_profile_provenance')],
  ['ls_contact_ops.require_marker_compatibility',contactOpsFunctionBody(files,CONTACT_OPS_MIGRATION.name,'ls_contact_ops.require_marker_compatibility')],
 ]);
 const pool=new Pool({connectionString:target.url,ssl:{rejectUnauthorized:true,ca:process.env.LS_DATABASE_CA},max:1,connectionTimeoutMillis:8000,statement_timeout:30000});
 try{
  const client=await pool.connect();
  try{
   const inspect=async()=>{
    await client.query('BEGIN READ ONLY');
    try{
     const identity=await client.query<{system_identifier:string;ssl:boolean}>(`SELECT
       (SELECT system_identifier FROM pg_control_system()) AS system_identifier,
       (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`);
     assertContactOpsDatabaseIdentity(identity.rows[0]?.system_identifier,identity.rows[0]?.ssl);
     const ledger=await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name');
     const objects=await client.query<ContactOpsIntegrityObjects>(`SELECT
       to_regclass('ls_contact_ops.profiles') IS NOT NULL AS profiles,
       to_regclass('ls_contact_ops.legacy_links') IS NOT NULL AS "legacyLinks",
       to_regclass('ls_contact_ops.command_receipts') IS NOT NULL AS "commandReceipts",
       EXISTS(SELECT 1 FROM pg_index i
         WHERE i.indexrelid=to_regclass('ls_contact_ops.legacy_links_by_person')
           AND i.indrelid=to_regclass('ls_contact_ops.legacy_links')
           AND i.indisvalid AND i.indisready AND i.indislive AND NOT i.indisunique
           AND i.indnatts=2 AND i.indnkeyatts=2 AND i.indkey::text='1 6'
           AND i.indpred IS NULL AND i.indexprs IS NULL) AS "legacyIndex",
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='profile_provenance'
         AND tgrelid=to_regclass('ls_contact_ops.profiles') AND NOT tgisinternal
         AND tgenabled IN ('O','A') AND tgtype=23 AND tgattr::text='' AND tgqual IS NULL
         AND tgfoid=to_regprocedure('ls_contact_ops.require_profile_provenance()')) AS "profileProvenanceTrigger",
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='contact_person_marker_compatibility'
         AND tgrelid=to_regclass('ls_demo.records') AND NOT tgisinternal
         AND tgenabled IN ('O','A') AND tgtype=7 AND tgattr::text='' AND tgqual IS NULL
         AND tgfoid=to_regprocedure('ls_contact_ops.require_marker_compatibility()')) AS "markerCompatibilityTrigger",
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='immutable_demo_record'
         AND tgrelid=to_regclass('ls_demo.records') AND NOT tgisinternal
         AND tgenabled IN ('O','A') AND tgtype=27 AND tgattr::text='' AND tgqual IS NULL
         AND tgfoid=to_regprocedure('ls_demo.prevent_marker_change()')) AS "immutableDemoRecordTrigger",
       EXISTS(SELECT 1 FROM pg_constraint WHERE conname='canonical_demo_person_key'
         AND conrelid=to_regclass('ls_demo.records') AND contype='c'
         AND convalidated) AS "canonicalPersonConstraint"`);
     const functions=await client.query<{name:string;body:string;plpgsql:boolean;ordinary:boolean}>(`SELECT
       n.nspname||'.'||p.proname AS name,p.prosrc AS body,
       p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AS plpgsql,
       p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
         AND p.provolatile='v' AND p.proparallel='u'
         AND NOT p.prosecdef AND p.proconfig IS NULL AS ordinary
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE p.pronargs=0 AND ((n.nspname='ls_demo' AND p.proname='prevent_marker_change')
          OR (n.nspname='ls_contact_ops' AND p.proname IN
            ('require_profile_provenance','require_marker_compatibility')))`);
     const definitions=await client.query<{definition:string}>(`SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE conname='canonical_demo_person_key'
         AND conrelid=to_regclass('ls_demo.records')`);
     const columns=await client.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
       'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
       'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),
       'identity',a.attidentity,'generated',a.attgenerated)
       ORDER BY c.relname,a.attnum),'[]'::json) AS catalog
       FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE n.nspname='ls_contact_ops'
         AND c.relname IN ('profiles','legacy_links','command_receipts')
         AND a.attnum>0 AND NOT a.attisdropped`);
     const constraints=await client.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
       'table',c.relname,'name',k.conname,'type',k.contype,
       'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]'::json) AS catalog
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='ls_contact_ops' AND c.relname IN ('profiles','legacy_links','command_receipts')`);
     const baselineColumns=await client.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
       'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
       'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),
       'identity',a.attidentity,'generated',a.attgenerated)
       ORDER BY a.attnum),'[]'::json) AS catalog
       FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE n.nspname='ls_demo' AND c.relname='records'
         AND a.attnum>0 AND NOT a.attisdropped`);
     const baselineConstraints=await client.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
       'name',k.conname,'type',k.contype,'validated',k.convalidated,
       'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname),'[]'::json) AS catalog
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='ls_demo' AND c.relname='records' AND k.contype<>'n'`);
     const validated=await client.query<{contactOps:boolean;baseline:boolean}>(`SELECT
       NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='ls_contact_ops' AND c.relname IN ('profiles','legacy_links','command_receipts') AND NOT k.convalidated) AS "contactOps",
       NOT EXISTS(SELECT 1 FROM pg_constraint k
         WHERE k.conrelid=to_regclass('ls_demo.records') AND NOT k.convalidated) AS baseline`);
     const baselineForeignKeys=await client.query<{enforced:boolean}>(`SELECT count(*)=3
       AND bool_and(k.convalidated AND
         (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A'))
          FROM pg_trigger t WHERE t.tgconstraint=k.oid)) AS enforced
       FROM pg_constraint k WHERE k.conrelid=to_regclass('ls_demo.records') AND k.contype='f'`);
     const baselineReferences=await client.query<{sound:boolean}>(`SELECT
       NOT EXISTS(SELECT 1 FROM ls_demo.records r LEFT JOIN ls_demo.batches b
         ON b.workspace_id=r.workspace_id AND b.batch_id=r.batch_id
         WHERE b.batch_id IS NULL) AND
       NOT EXISTS(SELECT 1 FROM ls_demo.records r LEFT JOIN ls_demo.cases c
         ON c.workspace_id=r.workspace_id AND c.batch_id=r.batch_id AND c.case_id=r.case_id
         WHERE r.case_id IS NOT NULL AND c.case_id IS NULL) AND
       NOT EXISTS(SELECT 1 FROM ls_demo.records r LEFT JOIN ls_demo.accounts a
         ON a.workspace_id=r.workspace_id AND a.batch_id=r.batch_id AND a.account_id=r.account_id
         WHERE r.account_id IS NOT NULL AND a.account_id IS NULL) AS sound`);
     const tables=await client.query<{permanent:boolean}>(`SELECT count(*)=3
       AND bool_and(c.relkind='r' AND c.relpersistence='p') AS permanent
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='ls_contact_ops'
         AND c.relname IN ('profiles','legacy_links','command_receipts')`);
     const foreignKeys=await client.query<{enforced:boolean}>(`SELECT count(*)=5
       AND bool_and(k.convalidated AND
         (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A'))
          FROM pg_trigger t WHERE t.tgconstraint=k.oid)) AS enforced
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='ls_contact_ops' AND c.relname IN ('profiles','legacy_links','command_receipts') AND k.contype='f'`);
     const privileges=await client.query<{restricted:boolean}>(`SELECT
       EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='ls_contact_ops') AND
       (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         FROM pg_namespace n WHERE n.nspname='ls_contact_ops') AND
       (SELECT count(*)=3 AND bool_and(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='ls_contact_ops' AND c.relname IN
           ('profiles','legacy_links','command_receipts')) AND
       (SELECT count(*)=2 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='ls_contact_ops' AND p.proname IN
           ('require_profile_provenance','require_marker_compatibility')) AND
       (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         FROM pg_namespace n WHERE n.nspname='ls_demo') AND
       (SELECT c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         FROM pg_class c WHERE c.oid=to_regclass('ls_demo.records')) AND
       (SELECT p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         FROM pg_proc p WHERE p.oid=to_regprocedure('ls_demo.prevent_marker_change()')) AND
       NOT EXISTS(SELECT 1 FROM pg_auth_members m
         WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AND
       (SELECT count(*)=1 AND bool_and(rolname=current_user)
         FROM pg_roles WHERE rolsuper AND rolcanlogin) AND
       NOT EXISTS(SELECT 1 FROM pg_namespace n,
         LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
         WHERE n.nspname IN ('ls_contact_ops','ls_demo') AND acl.grantee<>n.nspowner) AND
       NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
         LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
         WHERE ((n.nspname='ls_contact_ops' AND c.relname IN
           ('profiles','legacy_links','command_receipts')) OR
           (n.nspname='ls_demo' AND c.relname='records')) AND acl.grantee<>c.relowner) AND
       NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace,
         LATERAL aclexplode(a.attacl) acl
         WHERE ((n.nspname='ls_contact_ops' AND c.relname IN
           ('profiles','legacy_links','command_receipts')) OR
           (n.nspname='ls_demo' AND c.relname='records'))
           AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner) AND
       -- 0097 revoked public schema USAGE, but not the baseline trigger
       -- function's default EXECUTE grant. Verify its owner/body/trigger above;
       -- restrict ACLs here only for functions created by 0101.
       NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
         LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
         WHERE n.nspname='ls_contact_ops' AND p.proname IN
           ('require_profile_provenance','require_marker_compatibility')
           AND acl.grantee<>p.proowner) AS restricted`);
     const taskObjects=await client.query<Omit<InternalTaskIntegrityObjects,'schemaCatalog'>>(`SELECT
       (SELECT count(*)=2 AND bool_and(c.relkind='r' AND c.relpersistence='p'
         AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history')) AS tables,
       (SELECT count(*) IN (20,23) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_calendar'
         AND c.relname IN ('tasks','task_history') AND a.attnum>0 AND NOT a.attisdropped)
        AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('ls_calendar.tasks')
         AND a.attname='title_ciphertext' AND a.atttypid='text'::regtype AND a.attnotnull)
        AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('ls_calendar.tasks')
         AND a.attname='due_date' AND a.atttypid='date'::regtype AND a.attnotnull)
        AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('ls_calendar.tasks')
         AND a.attname='due_time' AND a.atttypid='time without time zone'::regtype)
        AS columns,
       (SELECT count(*) IN (13,14) AND bool_and(k.convalidated) FROM pg_constraint k
        JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history')
         AND k.contype<>'n') AS constraints,
       (SELECT count(*)=5 AND bool_and(k.convalidated AND
         (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A'))
          FROM pg_trigger t WHERE t.tgconstraint=k.oid)) FROM pg_constraint k
        JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history')
         AND k.contype='f') AS "foreignKeys",
       EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('ls_calendar.tasks_by_due')
        AND i.indrelid=to_regclass('ls_calendar.tasks') AND i.indisvalid AND i.indisready
        AND i.indislive AND NOT i.indisunique AND i.indnatts=4 AND i.indnkeyatts=4
        AND i.indkey::text='1 8 9 2' AND i.indpred IS NULL AND i.indexprs IS NULL) AS "dueIndex",
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='task_history_immutable'
        AND tgrelid=to_regclass('ls_calendar.task_history') AND NOT tgisinternal
        AND tgenabled IN ('O','A') AND tgtype=27 AND tgattr::text='' AND tgqual IS NULL
        AND tgfoid=to_regprocedure('ls_calendar.append_only()')) AS "historyImmutable",
       (to_regclass('ls_calendar.tasks') IS NOT NULL
        AND to_regclass('ls_calendar.task_history') IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
         LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
         WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history')
          AND acl.grantee<>c.relowner)
        AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl
         WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history')
          AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)) AS "publicRevoked"`);
     const taskColumns=await client.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
       'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
       'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),
       'identity',a.attidentity,'generated',a.attgenerated)
       ORDER BY c.relname,a.attnum),'[]'::json) AS catalog
       FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history')
        AND a.attnum>0 AND NOT a.attisdropped`);
     const taskConstraints=await client.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
       'table',c.relname,'name',k.conname,'type',k.contype,
       'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]'::json) AS catalog
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history')
        AND k.contype<>'n'`);
     const sourceIndex=await client.query<{exact:boolean}>(`SELECT EXISTS(SELECT 1 FROM pg_index i
       WHERE i.indexrelid=to_regclass('ls_calendar.tasks_one_source')
        AND i.indrelid=to_regclass('ls_calendar.tasks') AND i.indisvalid AND i.indisready
        AND i.indislive AND i.indisunique AND i.indnatts=3 AND i.indnkeyatts=3
        AND i.indkey::text='1 14 15' AND i.indexprs IS NULL
        AND pg_get_expr(i.indpred,i.indrelid)='(source_digest IS NOT NULL)') AS exact`);
     const voiceObjects=await client.query<Omit<VoiceRuleIntegrityObjects,'schemaCatalog'>>(`SELECT
       to_regnamespace('ls_content_voice') IS NULL AS "namespaceAbsent",
       (SELECT count(*)=2 AND bool_and(c.relkind='r' AND c.relpersistence='p'
         AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='ls_content_voice' AND c.relname IN ('rule_changes','rule_change_history')) AS tables,
       (SELECT count(*)=4 AND bool_and(k.convalidated AND
         (SELECT count(*)=4 AND bool_and(t.tgenabled IN ('O','A')) FROM pg_trigger t WHERE t.tgconstraint=k.oid))
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='ls_content_voice' AND c.relname IN ('rule_changes','rule_change_history') AND k.contype='f') AS "foreignKeys",
       EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('ls_content_voice.rule_changes_by_owner_time')
        AND i.indrelid=to_regclass('ls_content_voice.rule_changes') AND i.indisvalid AND i.indisready AND i.indislive
        AND NOT i.indisunique AND i.indnatts=3 AND i.indnkeyatts=3 AND i.indkey::text='1 3 20'
        AND i.indoption::text='0 0 3' AND i.indpred IS NULL AND i.indexprs IS NULL) AS "ownerIndex",
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='rule_change_history_immutable'
        AND tgrelid=to_regclass('ls_content_voice.rule_change_history') AND NOT tgisinternal
        AND tgenabled IN ('O','A') AND tgtype=27 AND tgattr::text='' AND tgqual IS NULL
        AND tgfoid=to_regprocedure('ls_calendar.append_only()')) AS "historyImmutable",
       (EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='ls_content_voice')
        AND (SELECT n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         FROM pg_namespace n WHERE n.nspname='ls_content_voice')
        AND (SELECT count(*)=2 AND bool_and(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='ls_content_voice' AND c.relname IN ('rule_changes','rule_change_history'))
        AND NOT EXISTS(SELECT 1 FROM pg_namespace n,
         LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
         WHERE n.nspname='ls_content_voice' AND acl.grantee<>n.nspowner)
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
         LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
         WHERE n.nspname='ls_content_voice' AND c.relname IN ('rule_changes','rule_change_history') AND acl.grantee<>c.relowner)
        AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) acl
         WHERE n.nspname='ls_content_voice' AND c.relname IN ('rule_changes','rule_change_history')
          AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner)) AS "publicRevoked"`);
     const voiceColumns=await client.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
       'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
       'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
       ORDER BY c.relname,a.attnum),'[]'::json) AS catalog FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE n.nspname='ls_content_voice' AND c.relname IN ('rule_changes','rule_change_history') AND a.attnum>0 AND NOT a.attisdropped`);
     const voiceConstraints=await client.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
       'table',c.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]'::json) AS catalog
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='ls_content_voice' AND c.relname IN ('rule_changes','rule_change_history') AND k.contype<>'n'`);
     const appendOnly=await client.query<{body:string;safe:boolean}>(`SELECT p.prosrc AS body,
       p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
        AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
        AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef
        AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
        AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS safe
       FROM pg_proc p WHERE p.oid=to_regprocedure('ls_calendar.append_only()')`);
     let referencesSound=false;
     if(objects.rows[0]?.profiles&&objects.rows[0]?.legacyLinks&&objects.rows[0]?.commandReceipts){
      const orphaned=await client.query<{sound:boolean}>(`SELECT
       NOT EXISTS(SELECT 1 FROM ls_contact_ops.profiles p LEFT JOIN ls_identity.people i
         ON i.workspace_id=p.workspace_id AND i.id=p.person_id
         WHERE i.id IS NULL) AND
       NOT EXISTS(SELECT 1 FROM ls_contact_ops.profiles p LEFT JOIN ls_demo.batches b
         ON b.workspace_id=p.workspace_id AND b.batch_id=p.demo_batch_id
         WHERE p.demo_batch_id IS NOT NULL AND b.batch_id IS NULL) AND
       NOT EXISTS(SELECT 1 FROM ls_contact_ops.legacy_links l LEFT JOIN ls_contact_ops.profiles p
         ON p.workspace_id=l.workspace_id AND p.person_id=l.person_id
         WHERE p.person_id IS NULL) AND
       NOT EXISTS(SELECT 1 FROM ls_contact_ops.command_receipts r LEFT JOIN ls_contact_ops.profiles p
         ON p.workspace_id=r.workspace_id AND p.person_id=r.person_id
         WHERE p.person_id IS NULL) AND
       NOT EXISTS(SELECT 1 FROM ls_contact_ops.command_receipts r LEFT JOIN ls_identity.accounts a
         ON a.workspace_id=r.workspace_id AND a.id=r.actor_account_id
         WHERE a.id IS NULL) AS sound`);
      referencesSound=orphaned.rows[0]?.sound===true;
     }
     const authorityIntegrity=await contactAuthorityIntegrity({query:async <R extends object>(statement:string,values:readonly unknown[]=[])=>
      (await client.query<R>(statement,[...values])).rows},files);
     const inboundIntegrity=await contactInboundIntegrity({query:async <R extends object>(statement:string,values:readonly unknown[]=[])=>
       (await client.query<R>(statement,[...values])).rows},files);
     const practiceIntegrity=files.some(file=>file.name===PRACTICE_SUBJECT_GUARDS_MIGRATION.name)?await practiceSubjectIntegrity({query:async <R extends object>(statement:string,values:readonly unknown[]=[])=>
       (await client.query<R>(statement,[...values])).rows},files):undefined;
     const progressIntegrity=files.some(file=>file.name===PROGRESS_REVIEW_REVISIONS_MIGRATION.name)?await progressReviewIntegrity({query:async <R extends object>(statement:string,values:readonly unknown[]=[])=>
       (await client.query<R>(statement,[...values])).rows},files):undefined;
     const projectionIntegrity=files.some(file=>file.name===CONTACT_INBOUND_PROJECTION_MIGRATION.name)?await contactInboundProjectionIntegrity({query:async <R extends object>(statement:string,values:readonly unknown[]=[])=>
       (await client.query<R>(statement,[...values])).rows},files):undefined;
     const outboundIntegrity=files.some(file=>file.name===CONTACT_OUTBOUND_PROJECTION_MIGRATION.name)?await contactOutboundProjectionIntegrity({query:async <R extends object>(statement:string,values:readonly unknown[]=[])=>
       (await client.query<R>(statement,[...values])).rows}):undefined;
     const adultIntegrity=files.some(file=>file.name===PRACTICE_ADULT_COORDINATION_MIGRATION.name)?await practiceAdultCoordinationIntegrity({query:async <R extends object>(statement:string,values:readonly unknown[]=[])=>
       (await client.query<R>(statement,[...values])).rows},files):undefined;
     await client.query('COMMIT');
     const history:AppliedMigration[]=ledger.rows.map(row=>({name:row.name,checksum:row.checksum}));
     const verified=new Map(functions.rows.map(row=>[row.name,
       row.plpgsql===true&&row.ordinary===true&&row.body===functionBodies.get(row.name)]));
     const integrity:ContactOpsIntegrityObjects={...objects.rows[0]!,
       immutableFunction:verified.get('ls_demo.prevent_marker_change')===true,
       profileFunction:verified.get('ls_contact_ops.require_profile_provenance')===true,
       markerFunction:verified.get('ls_contact_ops.require_marker_compatibility')===true,
       canonicalConstraintDefinition:definitions.rows.length===1&&contactOpsCanonicalConstraint(definitions.rows[0]?.definition),
       schemaCatalog:contactOpsSchemaCatalogMatches(columns.rows[0]?.catalog,constraints.rows[0]?.catalog)&&validated.rows[0]?.contactOps===true,
       baselineRecordsCatalog:contactOpsBaselineRecordsMatches(baselineColumns.rows[0]?.catalog,baselineConstraints.rows[0]?.catalog)&&validated.rows[0]?.baseline===true&&baselineForeignKeys.rows[0]?.enforced===true&&baselineReferences.rows[0]?.sound===true,
       permanentTables:tables.rows[0]?.permanent===true,
       foreignKeysEnforced:foreignKeys.rows[0]?.enforced===true,
       foreignKeyReferencesSound:referencesSound,
       publicRevoked:privileges.rows[0]?.restricted===true};
     const baseCatalog=internalTaskSchemaCatalogMatches(taskColumns.rows[0]?.catalog,taskConstraints.rows[0]?.catalog);
     const sourceCatalog=sourceTaskSchemaCatalogMatches(taskColumns.rows[0]?.catalog,taskConstraints.rows[0]?.catalog);
     const taskIntegrity:InternalTaskIntegrityObjects={...taskObjects.rows[0]!,
       schemaCatalog:baseCatalog||sourceCatalog,
       appendOnlyFunction:appendOnly.rows.length===1&&appendOnly.rows[0]?.safe===true&&
        appendOnly.rows[0]?.body===calendarAppendOnlyFunctionBody(files)};
     const sourceIntegrity:SourceTaskIntegrityObjects={baseCatalog,sourceCatalog,sourceIndex:sourceIndex.rows[0]?.exact===true};
     const voiceIntegrity:VoiceRuleIntegrityObjects={...voiceObjects.rows[0]!,
       schemaCatalog:voiceRuleSchemaCatalogMatches(voiceColumns.rows[0]?.catalog,voiceConstraints.rows[0]?.catalog)};
     return contactOpsMigrationState(files,history,integrity,taskIntegrity,sourceIntegrity,voiceIntegrity,authorityIntegrity,inboundIntegrity,practiceIntegrity,progressIntegrity,projectionIntegrity,outboundIntegrity,adultIntegrity);
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
   };
   const before=await inspect();
   if(target.mode==='preflight'){
    process.stdout.write(JSON.stringify({code:'CONTACT_OPS_PREFLIGHT_OK',deploymentId:target.deploymentId,databaseServiceId:target.databaseServiceId,migration:reviewedMigration.name,state:before})+'\n');
    return;
   }
   const result=before==='pending'?await migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},files,false):{applied:0,pending:0};
   const after=await inspect();
   if(after!=='applied'||result.applied!==(before==='pending'?1:0))throw new Error('CONTACT_OPS_APPLY_READBACK_FAILED');
   process.stdout.write(JSON.stringify({code:'CONTACT_OPS_SCHEMA_VERIFIED',deploymentId:target.deploymentId,databaseServiceId:target.databaseServiceId,migration:reviewedMigration.name,checksum:reviewedMigration.checksum,applied:result.applied,state:after})+'\n');
  }finally{client.release();}
 }finally{await pool.end();}
}
main().catch(error=>{const code=error instanceof Error && /^(CONTACT_OPS|MIGRATION)_[A-Z0-9_]+$/.test(error.message)?error.message:'CONTACT_OPS_OPERATION_FAILED';process.stderr.write(code+'\n');process.exitCode=1;});
