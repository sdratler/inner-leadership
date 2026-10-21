import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {loadTravelCreditSchemaSources} from './academy-travel-credit-preflight.ts';
import {academySchemaCatalogQueries,loadAcademySchemaSources,type AcademySchemaSources,type AcademySchemaCatalog,type AcademySchemaConnection} from './academy-schema-preflight.ts';

/** Versioned local candidate inspection, never a migration, source importer,
 * runtime admission or provider operation. Original32/41 inspection is intact. */
export const academyGroupCalendarSchemaVersion='JLFA-GROUP-CALENDAR-SCHEMA-20261021-01' as const;
export const academyGroupCalendarSchemaPin=Object.freeze({path:'src/features/fishing/academy-group-calendar.sql',sha256:'811ea06819068a75d878795bef5822b9cc30a1f88ab0b70bd5e83ef6231a5184'});
const namespaces=Object.freeze(['ls_academy_calendar','ls_fishing_payments','ls_fishing_stage']);
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
function stable(v:unknown):string{return Array.isArray(v)?'['+v.map(stable).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+stable(x)).join(',')+'}':JSON.stringify(v);}
export type AcademyGroupCalendarSchemaSources=AcademySchemaSources&{version:typeof academyGroupCalendarSchemaVersion;namespaces:readonly string[]};
export function verifyAcademyGroupCalendarSchemaSources(base:AcademySchemaSources,entry:{path:string;bytes:Uint8Array}):AcademyGroupCalendarSchemaSources{
 if(base.baseline.length!==55||![32,41].includes(base.tables.length)||new Set(base.tables).size!==base.tables.length||base.tables.some(n=>!/^ls_fishing_(payments|stage)\.[a-z_]+$/.test(n)))throw Error('ACADEMY_GROUP_BASE_SOURCE_SET');
 if(entry.path!==academyGroupCalendarSchemaPin.path||hash(entry.bytes)!==academyGroupCalendarSchemaPin.sha256)throw Error('ACADEMY_GROUP_SOURCE_HASH');
 const added=[...Buffer.from(entry.bytes).toString('utf8').matchAll(/CREATE TABLE\s+(ls_academy_calendar\.[a-z_]+)/g)].map(m=>m[1]!);
 if(added.length!==4||new Set(added).size!==4)throw Error('ACADEMY_GROUP_SOURCE_TABLE_SET');
 return Object.freeze({version:academyGroupCalendarSchemaVersion,namespaces,bundleSha256:hash(stable({base:base.bundleSha256,overlay:academyGroupCalendarSchemaPin})),baseline:base.baseline,tables:Object.freeze([...base.tables,...added].sort())});
}
export async function loadAcademyGroupCalendarSchemaSources(appRoot:URL,base?:AcademySchemaSources){const file=new URL(academyGroupCalendarSchemaPin.path,appRoot),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('ACADEMY_GROUP_SOURCE_TYPE');return verifyAcademyGroupCalendarSchemaSources(base??await loadAcademySchemaSources(appRoot),{path:academyGroupCalendarSchemaPin.path,bytes:await readFile(file)});}
function assessAcademyGroupSchema(catalog:AcademySchemaCatalog,history:readonly {name:string;checksum:string}[],sources:AcademyGroupCalendarSchemaSources|AcademyGroupPublicationSchemaSources,reference:string|null){
 if(reference!==null&&!/^[a-f0-9]{64}$/.test(reference))throw Error('ACADEMY_GROUP_REFERENCE_INVALID');
 const baselineMatches=stable([...history].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0))===stable(sources.baseline),names=catalog.namespaces.map(n=>n.name).sort(),tables=catalog.relations.filter(r=>r.kind==='r'||r.kind==='p').map(r=>r.schema+'.'+r.name).sort(),catalogSha256=hash(stable(catalog));
 const state=!baselineMatches?'baseline_mismatch':!names.length?'absent':stable(names)!==stable(sources.namespaces)||stable(tables)!==stable(sources.tables)?'partial':reference===null?'unreviewed':reference===catalogSha256?'match':'drift';
 return {version:sources.version,state,catalogSha256,sourceBundleSha256:sources.bundleSha256,baselineMatches,mutationAllowed:false as const,runtimeAdmission:false as const};
}
/** One exclusively checked-out connection, one repeatable-read READ ONLY
 * snapshot across all three namespaces and unchanged55 history. Always rollback. */
async function readAcademyGroupSchemaPreflight(connection:AcademySchemaConnection,sources:AcademyGroupCalendarSchemaSources|AcademyGroupPublicationSchemaSources,reference:string|null){
 if(reference!==null&&!/^[a-f0-9]{64}$/.test(reference))throw Error('ACADEMY_GROUP_REFERENCE_INVALID');
 let started=false;try{
  await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');started=true;await connection.query('SET LOCAL search_path=pg_catalog');await connection.query("SET LOCAL statement_timeout='5s'");await connection.query("SET LOCAL lock_timeout='1s'");
  const identity=(await connection.query<{database:string;host:string|null;port:number|null;version:string;readonly:string;isolation:string}>("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num') AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation")).rows[0];
  if(!identity||!/^\d{6}$/.test(identity.version)||Number(identity.version)<140000||identity.readonly!=='on'||identity.isolation!=='repeatable read')throw Error('ACADEMY_GROUP_READ_ONLY_REQUIRED');
  const history=(await connection.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows,groups:Record<string,Record<string,unknown>[] >={};
  for(const [name,sql]of Object.entries(academySchemaCatalogQueries))groups[name]=(await connection.query<{item:Record<string,unknown>}>(sql,[sources.namespaces])).rows.map(r=>r.item).sort((a,b)=>stable(a)<stable(b)?-1:stable(a)>stable(b)?1:0);
  const catalog={serverMajor:Math.floor(Number(identity.version)/10000),...groups} as AcademySchemaCatalog;
  return {...assessAcademyGroupSchema(catalog,history,sources,reference),identity,catalog};
 }finally{if(started)await connection.query('ROLLBACK');}
}

/** Preserve the original source version and assessment behavior. */
export function assessAcademyGroupCalendarSchema(catalog:AcademySchemaCatalog,history:readonly {name:string;checksum:string}[],sources:AcademyGroupCalendarSchemaSources,reference:string|null){return {...assessAcademyGroupSchema(catalog,history,sources,reference),version:academyGroupCalendarSchemaVersion};}
export async function readAcademyGroupCalendarSchemaPreflight(connection:AcademySchemaConnection,sources:AcademyGroupCalendarSchemaSources,reference:string|null){return {...await readAcademyGroupSchemaPreflight(connection,sources,reference),version:academyGroupCalendarSchemaVersion};}

/** Separately versioned nine-table overlay. This proves candidate bytes and
 * catalog identity only; it grants no DDL, source, merchant or runtime effect. */
export const academyGroupPublicationSchemaVersion='JLFA-GROUP-PUBLICATION-SCHEMA-20261021-01' as const;
export const academyGroupPublicationSchemaPin=Object.freeze({path:'src/features/fishing/academy-group-calendar-publication.sql',sha256:'45e6c35cca4122c322980e1363c65a96431ceb153e1b1378c4fdf5bfd056d65c'});
export type AcademyGroupPublicationSchemaSources=Omit<AcademyGroupCalendarSchemaSources,'version'>&{version:typeof academyGroupPublicationSchemaVersion};
export function verifyAcademyGroupPublicationSchemaSources(base:AcademyGroupCalendarSchemaSources,entry:{path:string;bytes:Uint8Array}):AcademyGroupPublicationSchemaSources{
 if(base.version!==academyGroupCalendarSchemaVersion||base.baseline.length!==55||base.tables.length!==45||new Set(base.tables).size!==45||stable(base.namespaces)!==stable(namespaces)||base.tables.filter(n=>n.startsWith('ls_academy_calendar.')).length!==4||base.tables.some(n=>!/^ls_(fishing_(payments|stage)|academy_calendar)\.[a-z_]+$/.test(n)))throw Error('ACADEMY_PUBLICATION_BASE_SOURCE_SET');
 if(entry.path!==academyGroupPublicationSchemaPin.path||hash(entry.bytes)!==academyGroupPublicationSchemaPin.sha256)throw Error('ACADEMY_PUBLICATION_SOURCE_HASH');
 const added=[...Buffer.from(entry.bytes).toString('utf8').matchAll(/CREATE TABLE\s+(ls_academy_calendar\.[a-z_]+)/g)].map(m=>m[1]!);
 if(added.length!==9||new Set(added).size!==9||added.some(n=>base.tables.includes(n)))throw Error('ACADEMY_PUBLICATION_SOURCE_TABLE_SET');
 return Object.freeze({version:academyGroupPublicationSchemaVersion,namespaces,bundleSha256:hash(stable({base:base.bundleSha256,overlay:academyGroupPublicationSchemaPin})),baseline:base.baseline,tables:Object.freeze([...base.tables,...added].sort())});
}
export async function loadAcademyGroupPublicationSchemaSources(appRoot:URL,base?:AcademyGroupCalendarSchemaSources){
 const file=new URL(academyGroupPublicationSchemaPin.path,appRoot),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('ACADEMY_PUBLICATION_SOURCE_TYPE');
 return verifyAcademyGroupPublicationSchemaSources(base??await loadAcademyGroupCalendarSchemaSources(appRoot,await loadTravelCreditSchemaSources(appRoot)),{path:academyGroupPublicationSchemaPin.path,bytes:await readFile(file)});
}
function requirePublicationSources(sources:AcademyGroupPublicationSchemaSources){if(sources.version!==academyGroupPublicationSchemaVersion||sources.tables.length!==54||new Set(sources.tables).size!==54||stable(sources.namespaces)!==stable(namespaces))throw Error('ACADEMY_PUBLICATION_SOURCE_SET');}
export function assessAcademyGroupPublicationSchema(catalog:AcademySchemaCatalog,history:readonly {name:string;checksum:string}[],sources:AcademyGroupPublicationSchemaSources,reference:string|null){requirePublicationSources(sources);return {...assessAcademyGroupSchema(catalog,history,sources,reference),version:academyGroupPublicationSchemaVersion};}
export async function readAcademyGroupPublicationSchemaPreflight(connection:AcademySchemaConnection,sources:AcademyGroupPublicationSchemaSources,reference:string|null){requirePublicationSources(sources);return {...await readAcademyGroupSchemaPreflight(connection,sources,reference),version:academyGroupPublicationSchemaVersion};}
