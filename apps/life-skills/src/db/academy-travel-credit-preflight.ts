import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {loadAcademySchemaSources,readAcademySchemaPreflight,type AcademySchemaSources,type AcademySchemaConnection} from './academy-schema-preflight.ts';

/** Explicit candidate overlay. Baseline55 and the accepted four native source
 * pins remain unchanged. This performs no migration, connection or admission. */
export const travelCreditSchemaPins=Object.freeze([
 {path:'src/features/fishing-stage/academy-session-credit-schema.sql',sha256:'1a2ba8cc2c7a39343c37283348aaa6d0d66c0ded8ce1bf8ec39d9f0a824871ad'},
 {path:'src/features/fishing/academy-travel-credit.sql',sha256:'4f52d1430f4b7232202aad6bb481c2d50a15d824ee0d6ca6c46babd13d6d841a'},
].map(v=>Object.freeze(v)));
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export function verifyTravelCreditSchemaSources(base:AcademySchemaSources,entries:readonly {path:string;bytes:Uint8Array}[]):AcademySchemaSources{
 if(base.baseline.length!==55||base.tables.length!==32||entries.length!==2||new Set(entries.map(e=>e.path)).size!==2)throw Error('ACADEMY_TRAVEL_SOURCE_SET');
 const tables=[...base.tables];for(const pin of travelCreditSchemaPins){const entry=entries.find(e=>e.path===pin.path);if(!entry||hash(entry.bytes)!==pin.sha256)throw Error('ACADEMY_TRAVEL_SOURCE_HASH');for(const match of Buffer.from(entry.bytes).toString('utf8').matchAll(/CREATE TABLE\s+(ls_fishing_stage\.[a-z_]+)/g))tables.push(match[1]!);}
 if(tables.length!==41||new Set(tables).size!==41)throw Error('ACADEMY_TRAVEL_TABLE_SET');
 return Object.freeze({bundleSha256:hash(JSON.stringify({base:base.bundleSha256,overlay:travelCreditSchemaPins})),baseline:base.baseline,tables:Object.freeze(tables.sort())});
}
export async function loadTravelCreditSchemaSources(appRoot:URL){const base=await loadAcademySchemaSources(appRoot),entries=[];for(const pin of travelCreditSchemaPins){const file=new URL(pin.path,appRoot),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('ACADEMY_TRAVEL_SOURCE_TYPE');entries.push({path:pin.path,bytes:await readFile(file)});}return verifyTravelCreditSchemaSources(base,entries);}
/** Actual serving catalog comparison still requires independent reference
 * review. A local fixture's digest is never production adoption authority. */
export async function readTravelCreditSchemaPreflight(connection:AcademySchemaConnection,sources:AcademySchemaSources,reviewedCatalogSha256:string|null){return readAcademySchemaPreflight(connection,sources,reviewedCatalogSha256);}
