import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';

/** Read-only preparation, never migration/adoption authority. No connection,
 * environment, credential lookup, DDL, DML, manifest writer or runtime gate. */
export const academySchemaSourcePins=Object.freeze(([
 {path:'migrations/manifest.json',sha256:'602bbc5dc51a24060eaaa82db76a529ddf2c10b7615ea4a98c7ef09cc5ee4252'},
 {path:'src/features/fishing-payments/candidate-schema.sql',sha256:'af08db497a42722fffa815e583b65953d2a04107a52f2b18055da5467bf3e35c'},
 {path:'src/features/fishing-stage/candidate.sql',sha256:'b026e9c5352593b8c760a0693a4dca2a0a176e5300e83a572ed1d183db8d11f8'},
 {path:'src/features/fishing/native-program-schema.sql',sha256:'31975d4c0db5da2f0bc454906b47cf78ddd622f5fadffeb7c41f4c431dfaf748'},
 {path:'src/features/fishing/native-stripe-bindings.sql',sha256:'48237d5c933f2f404f047c58253ac13b131a8e5ca346e97b7296f33cd5358701'},
] as const).map(pin=>Object.freeze(pin)));
const schemas=['ls_fishing_payments','ls_fishing_stage'] as const,hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
function stable(value:unknown):string{if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';return JSON.stringify(value);}
function same(a:unknown,b:unknown){return stable(a)===stable(b);}
type Baseline={name:string;checksum:string};
export type AcademySchemaSources=Readonly<{bundleSha256:string;baseline:readonly Baseline[];tables:readonly string[]}>;
export function verifyAcademySchemaSources(entries:readonly {path:string;bytes:Uint8Array}[]):AcademySchemaSources{
 if(entries.length!==academySchemaSourcePins.length||new Set(entries.map(e=>e.path)).size!==entries.length)throw Error('ACADEMY_SCHEMA_SOURCE_SET');
 const tables:string[]=[],baseline:Baseline[]=[];
 for(const pin of academySchemaSourcePins){const entry=entries.find(e=>e.path===pin.path);if(!entry||hash(entry.bytes)!==pin.sha256)throw Error('ACADEMY_SCHEMA_SOURCE_HASH');const text=Buffer.from(entry.bytes).toString('utf8');
  if(pin.path==='migrations/manifest.json'){const rows=JSON.parse(text) as {name:string;sha256:string}[];if(rows.length!==55)throw Error('ACADEMY_SCHEMA_BASELINE_COUNT');baseline.push(...rows.map(r=>({name:r.name,checksum:r.sha256})));}
  else for(const match of text.matchAll(/CREATE TABLE (ls_fishing_(?:payments|stage)\.[a-z_]+)/g))tables.push(match[1]!);
 }
 baseline.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);tables.sort();if(new Set(tables).size!==tables.length||tables.length<10)throw Error('ACADEMY_SCHEMA_TABLE_SET');
 return {bundleSha256:hash(stable(academySchemaSourcePins)),baseline,tables};
}
export async function loadAcademySchemaSources(appRoot:URL):Promise<AcademySchemaSources>{
 const entries=[];for(const pin of academySchemaSourcePins){const file=new URL(pin.path,appRoot),node=await lstat(file);if(!node.isFile()||node.isSymbolicLink())throw Error('ACADEMY_SCHEMA_SOURCE_TYPE');entries.push({path:pin.path,bytes:await readFile(file)});}return verifyAcademySchemaSources(entries);
}
export interface AcademySchemaConnection{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}
export type AcademySchemaCatalog=Readonly<{serverMajor:number;namespaces:readonly Record<string,unknown>[];relations:readonly Record<string,unknown>[];columns:readonly Record<string,unknown>[];constraints:readonly Record<string,unknown>[];indexes:readonly Record<string,unknown>[];triggers:readonly Record<string,unknown>[];functions:readonly Record<string,unknown>[];types:readonly Record<string,unknown>[];policies:readonly Record<string,unknown>[];defaults:readonly Record<string,unknown>[]} >;
/** Expand default ACLs as well as explicit ACLs. ACL owner entries use a stable
 * symbol; actual schema/object owner names remain in the catalog digest. A
 * different serving owner requires an independently reviewed target reference. */
function acl(kind:string,value:string,owner:string){const role=(field:string)=>`CASE WHEN ${field}=0 THEN 'PUBLIC' WHEN ${field}=${owner} THEN '$OWNER' ELSE pg_get_userbyid(${field}) END`;return `(SELECT COALESCE(jsonb_agg(jsonb_build_object('grantee',${role('x.grantee')},'grantor',${role('x.grantor')},'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY ${role('x.grantee')},${role('x.grantor')},x.privilege_type,x.is_grantable),'[]'::jsonb) FROM aclexplode(COALESCE(${value},acldefault(${kind},${owner}))) x)`;}
const scope='n.nspname=ANY($1::text[])';
const queries={
 namespaces:`SELECT jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',${acl("'n'::\"char\"",'n.nspacl','n.nspowner')}) AS item FROM pg_namespace n WHERE ${scope}`,
 relations:`SELECT jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,'rowSecurity',c.relrowsecurity,'forcedRowSecurity',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'ownerMatchesSchema',c.relowner=n.nspowner,'options',c.reloptions,'replicaIdentity',c.relreplident,'acl',${acl("CASE WHEN c.relkind='S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END",'c.relacl','c.relowner')}) AS item FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${scope}`,
 columns:`SELECT jsonb_build_object('schema',n.nspname,'table',c.relname,'position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE co.collname END,'acl',a.attacl::text,'dropped',a.attisdropped) AS item FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation WHERE ${scope} AND c.relkind IN('r','p','v','m','f','c') AND a.attnum>0`,
 constraints:`SELECT jsonb_build_object('schema',n.nspname,'table',r.relname,'name',c.conname,'kind',c.contype,'definition',pg_get_constraintdef(c.oid,false),'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,'noInherit',c.connoinherit,'enforced',to_jsonb(c)->>'conenforced','period',to_jsonb(c)->>'conperiod') AS item FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE ${scope}`,
 indexes:`SELECT jsonb_build_object('schema',n.nspname,'name',c.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'primary',i.indisprimary,'unique',i.indisunique,'nullsNotDistinct',i.indnullsnotdistinct,'immediate',i.indimmediate,'replicaIdentity',i.indisreplident,'clustered',i.indisclustered) AS item FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${scope}`,
 triggers:`SELECT jsonb_build_object('schema',n.nspname,'table',c.relname,'name',CASE WHEN t.tgisinternal THEN tc.conname||':'||t.tgtype||':'||p.proname ELSE t.tgname END,'definition',CASE WHEN t.tgisinternal THEN NULL ELSE pg_get_triggerdef(t.oid,false) END,'enabled',t.tgenabled,'internal',t.tgisinternal,'functionSchema',pn.nspname,'function',p.proname,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred) AS item FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace LEFT JOIN pg_constraint tc ON tc.oid=t.tgconstraint WHERE ${scope}`,
 functions:`SELECT jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'ownerMatchesSchema',p.proowner=n.nspowner,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'volatility',p.provolatile,'parallel',p.proparallel,'config',p.proconfig,'acl',${acl("'f'::\"char\"",'p.proacl','p.proowner')}) AS item FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${scope}`,
 types:`SELECT jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype,'category',t.typcategory,'base',format_type(t.typbasetype,t.typtypmod),'element',format_type(t.typelem,NULL),'notNull',t.typnotnull,'default',t.typdefault,'owner',pg_get_userbyid(t.typowner),'ownerMatchesSchema',t.typowner=n.nspowner,'labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid),'checks',(SELECT jsonb_agg(pg_get_constraintdef(c.oid,false) ORDER BY c.conname) FROM pg_constraint c WHERE c.contypid=t.oid),'acl',${acl("'T'::\"char\"",'t.typacl','t.typowner')}) AS item FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE ${scope}`,
 policies:`SELECT jsonb_build_object('schema',n.nspname,'table',c.relname,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN role_id=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_id) END ORDER BY CASE WHEN role_id=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_id) END) FROM unnest(p.polroles) role_id),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) AS item FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${scope}`,
 defaults:`SELECT jsonb_build_object('schema',COALESCE(n.nspname,'$GLOBAL'),'kind',d.defaclobjtype,'creator',pg_get_userbyid(d.defaclrole),'acl',${acl('d.defaclobjtype','d.defaclacl','d.defaclrole')}) AS item FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR ${scope}`,
} as const;
/** Read-only catalog definitions shared with separately versioned additive
 * inspectors. The original two-namespace assessment/admission is unchanged. */
export const academySchemaCatalogQueries=Object.freeze(queries);
export function assessAcademySchema(catalog:AcademySchemaCatalog,history:readonly Baseline[],sources:AcademySchemaSources,reviewedCatalogSha256:string|null){
 if(reviewedCatalogSha256!==null&&!/^[a-f0-9]{64}$/.test(reviewedCatalogSha256))throw Error('ACADEMY_SCHEMA_REFERENCE_INVALID');
 const catalogSha256=hash(stable(catalog)),names=catalog.namespaces.map(r=>r.name),tables=catalog.relations.filter(r=>r.kind==='r'||r.kind==='p').map(r=>r.schema+'.'+r.name).sort(),baseline=same([...history].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),sources.baseline);
 const state=!baseline?'baseline_mismatch':names.length===0?'absent':!same([...names].sort(),[...schemas].sort())||sources.tables.some(t=>!tables.includes(t))?'partial':reviewedCatalogSha256===null?'unreviewed':catalogSha256===reviewedCatalogSha256?'match':'drift';
 return {state,catalogSha256,sourceBundleSha256:sources.bundleSha256,baselineMatches:baseline,mutationAllowed:false as const};
}
/** Caller owns an exclusively checked-out connection. Always roll back this
 * read transaction, including on inspection failure. Never receives a URL. */
export async function readAcademySchemaPreflight(connection:AcademySchemaConnection,sources:AcademySchemaSources,reviewedCatalogSha256:string|null){
 if(reviewedCatalogSha256!==null&&!/^[a-f0-9]{64}$/.test(reviewedCatalogSha256))throw Error('ACADEMY_SCHEMA_REFERENCE_INVALID');
 let started=false;try{
  await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');started=true;await connection.query("SET LOCAL search_path=pg_catalog");await connection.query("SET LOCAL statement_timeout='5s'");await connection.query("SET LOCAL lock_timeout='1s'");
  const identity=(await connection.query<{database:string;host:string|null;port:number|null;version:string;readonly:string;isolation:string}>("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num') AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation")).rows[0];if(!identity||!/^\d{6}$/.test(identity.version)||Number(identity.version)<140000||identity.readonly!=='on'||identity.isolation!=='repeatable read')throw Error('ACADEMY_SCHEMA_READ_ONLY_REQUIRED');
  const owners=(await connection.query<{schema:string;owner:string}>('SELECT n.nspname AS schema,pg_get_userbyid(n.nspowner) AS owner FROM pg_namespace n WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname',[schemas])).rows,history=(await connection.query<Baseline>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;
  const groups:Record<string,Record<string,unknown>[] >={};for(const [name,sql]of Object.entries(queries))groups[name]=(await connection.query<{item:Record<string,unknown>}>(sql,[schemas])).rows.map(r=>r.item).sort((a,b)=>stable(a)<stable(b)?-1:stable(a)>stable(b)?1:0);
  const catalog={serverMajor:Math.floor(Number(identity.version)/10000),...groups} as AcademySchemaCatalog;
  return {...assessAcademySchema(catalog,history,sources,reviewedCatalogSha256),identity,owners,catalog};
 }finally{if(started)await connection.query('ROLLBACK');}
}
