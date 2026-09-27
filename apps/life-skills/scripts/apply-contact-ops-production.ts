/** One-time additive native CRM schema gate for the registered dedicated app DB.
 * Run only inside the deployed app service after exact-deployment readback,
 * current full encrypted backup/restore proof and protected checks. It does
 * not import contacts, switch CRM authority, send messages or change providers.
 *
 * First obtain an owner-private, authenticated Railway variable readback from
 * BOTH exact service IDs: SHA-256(app LS_DATABASE_URL) must equal
 * SHA-256(database service DATABASE_URL). Supply only that verified digest:
 * Compare the seven source files by authenticated Railway SSH with the exact
 * reviewed Git head; supply that normalized bundle digest on both calls.
 * node --import tsx scripts/apply-contact-ops-production.ts --preflight --deployment=<Railway deployment ID> --database-binding=<database service ID>:<verified digest> --source-bundle=<reviewed remote digest>
 * node --import tsx scripts/apply-contact-ops-production.ts --apply --deployment=<same ID> --database-binding=<same ID>:<same digest> --source-bundle=<same reviewed digest>
 */
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {migrate} from '../src/db/migration-runner.ts';
import {assertContactOpsDatabaseIdentity,contactOpsCanonicalConstraint,contactOpsFunctionBody,contactOpsMigrationState,contactOpsProductionTarget,contactOpsSchemaCatalogMatches,contactOpsSourceBundle,CONTACT_OPS_MIGRATION,CONTACT_OPS_SOURCE_FILES,type ContactOpsIntegrityObjects} from '../src/db/contact-ops-production-guard.ts';
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
 if(files.at(-1)?.name!==CONTACT_OPS_MIGRATION.name)throw new Error('CONTACT_OPS_NOT_LAST_MIGRATION');
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
       WHERE n.nspname='ls_contact_ops'`);
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
       WHERE n.nspname='ls_contact_ops' AND k.contype='f'`);
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
       NOT EXISTS(SELECT 1 FROM pg_namespace n,
         LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
         WHERE n.nspname='ls_contact_ops' AND acl.grantee<>n.nspowner) AND
       NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
         LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
         WHERE n.nspname='ls_contact_ops' AND c.relname IN
           ('profiles','legacy_links','command_receipts') AND acl.grantee<>c.relowner) AND
       NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace,
         LATERAL aclexplode(a.attacl) acl
         WHERE n.nspname='ls_contact_ops' AND c.relname IN
           ('profiles','legacy_links','command_receipts')
           AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner) AND
       NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
         LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
         WHERE n.nspname='ls_contact_ops' AND p.proname IN
           ('require_profile_provenance','require_marker_compatibility')
           AND acl.grantee<>p.proowner) AS restricted`);
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
     await client.query('COMMIT');
     const history:AppliedMigration[]=ledger.rows.map(row=>({name:row.name,checksum:row.checksum}));
     const verified=new Map(functions.rows.map(row=>[row.name,
       row.plpgsql===true&&row.ordinary===true&&row.body===functionBodies.get(row.name)]));
     const integrity:ContactOpsIntegrityObjects={...objects.rows[0]!,
       immutableFunction:verified.get('ls_demo.prevent_marker_change')===true,
       profileFunction:verified.get('ls_contact_ops.require_profile_provenance')===true,
       markerFunction:verified.get('ls_contact_ops.require_marker_compatibility')===true,
       canonicalConstraintDefinition:definitions.rows.length===1&&contactOpsCanonicalConstraint(definitions.rows[0]?.definition),
       schemaCatalog:contactOpsSchemaCatalogMatches(columns.rows[0]?.catalog,constraints.rows[0]?.catalog),
       permanentTables:tables.rows[0]?.permanent===true,
       foreignKeysEnforced:foreignKeys.rows[0]?.enforced===true,
       foreignKeyReferencesSound:referencesSound,
       publicRevoked:privileges.rows[0]?.restricted===true};
     return contactOpsMigrationState(files,history,integrity);
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
   };
   const before=await inspect();
   if(target.mode==='preflight'){
    process.stdout.write(JSON.stringify({code:'CONTACT_OPS_PREFLIGHT_OK',deploymentId:target.deploymentId,databaseServiceId:target.databaseServiceId,migration:CONTACT_OPS_MIGRATION.name,state:before})+'\n');
    return;
   }
   const result=before==='pending'?await migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},files,false):{applied:0,pending:0};
   const after=await inspect();
   if(after!=='applied'||result.applied!==(before==='pending'?1:0))throw new Error('CONTACT_OPS_APPLY_READBACK_FAILED');
   process.stdout.write(JSON.stringify({code:'CONTACT_OPS_SCHEMA_VERIFIED',deploymentId:target.deploymentId,databaseServiceId:target.databaseServiceId,migration:CONTACT_OPS_MIGRATION.name,checksum:CONTACT_OPS_MIGRATION.sha256,applied:result.applied,state:after})+'\n');
  }finally{client.release();}
 }finally{await pool.end();}
}
main().catch(error=>{const code=error instanceof Error && /^(CONTACT_OPS|MIGRATION)_[A-Z0-9_]+$/.test(error.message)?error.message:'CONTACT_OPS_OPERATION_FAILED';process.stderr.write(code+'\n');process.exitCode=1;});
