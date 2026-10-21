import {readFile} from 'node:fs/promises';
import {expect,test} from 'vitest';
import {loadAcademySchemaSources,type AcademySchemaCatalog,type AcademySchemaConnection} from '../../../src/db/academy-schema-preflight.ts';
import {loadTravelCreditSchemaSources} from '../../../src/db/academy-travel-credit-preflight.ts';
import {academyGroupCalendarSchemaVersion,academyGroupPublicationSchemaVersion,academyGroupPublicationSchemaPin,loadAcademyGroupCalendarSchemaSources,loadAcademyGroupPublicationSchemaSources,verifyAcademyGroupPublicationSchemaSources,assessAcademyGroupCalendarSchema,assessAcademyGroupPublicationSchema,readAcademyGroupPublicationSchemaPreflight} from '../../../src/db/academy-group-calendar-preflight.ts';
import {academyKeysPublicationTables} from '../../../src/features/fishing/academy-group-calendar-publication-contract.ts';

const root=new URL('../../../',import.meta.url);
async function sources(){const base=await loadAcademySchemaSources(root),travel=await loadTravelCreditSchemaSources(root),draft=await loadAcademyGroupCalendarSchemaSources(root,travel),publication=await loadAcademyGroupPublicationSchemaSources(root,draft);return {base,travel,draft,publication};}
function catalog(tables:readonly string[]):AcademySchemaCatalog{return {serverMajor:18,namespaces:['ls_academy_calendar','ls_fishing_payments','ls_fishing_stage'].map(name=>({name})),relations:tables.map(name=>({schema:name.split('.')[0],name:name.split('.')[1],kind:'r'})),columns:[],constraints:[],indexes:[],triggers:[],functions:[],types:[],policies:[],defaults:[]};}

test('separate publication source overlay pins exact nine tables over45 without replacing older source versions or baseline55',async()=>{
 const {base,travel,draft,publication}=await sources();expect([base.tables.length,travel.tables.length,draft.tables.length,publication.tables.length]).toEqual([32,41,45,54]);expect(draft.version).toBe(academyGroupCalendarSchemaVersion);expect(publication.version).toBe(academyGroupPublicationSchemaVersion);expect(publication.baseline).toEqual(base.baseline);expect(publication.baseline).toHaveLength(55);expect(publication.tables.filter(t=>!draft.tables.includes(t))).toEqual(academyKeysPublicationTables.map(t=>'ls_academy_calendar.'+t).sort());expect(publication.bundleSha256).not.toBe(draft.bundleSha256);expect(Object.isFrozen(publication.tables)).toBe(true);
});

test('wrong source bytes/path, incomplete/duplicate/foreign base and wrong baseline cannot become a publication source receipt',async()=>{
 const {draft}=await sources(),bytes=await readFile(new URL(academyGroupPublicationSchemaPin.path,root)),entry={path:academyGroupPublicationSchemaPin.path,bytes};expect(()=>verifyAcademyGroupPublicationSchemaSources(draft,{...entry,bytes:Buffer.concat([bytes,Buffer.from('\n')])})).toThrow('SOURCE_HASH');expect(()=>verifyAcademyGroupPublicationSchemaSources(draft,{...entry,path:'other.sql'})).toThrow('SOURCE_HASH');
 for(const base of [{...draft,tables:draft.tables.slice(1)},{...draft,tables:[...draft.tables.slice(1),draft.tables[1]!]},{...draft,tables:[...draft.tables.slice(1),'foreign.unowned']},{...draft,baseline:draft.baseline.slice(1)}])expect(()=>verifyAcademyGroupPublicationSchemaSources(base,entry)).toThrow('BASE_SOURCE_SET');
});

test('catalog identity detects missing/extra tables and privilege/function/trigger drift but never grants migration or runtime admission',async()=>{
 const {draft,publication}=await sources(),c=catalog(publication.tables),first=assessAcademyGroupPublicationSchema(c,publication.baseline,publication,null);expect(first).toMatchObject({state:'unreviewed',mutationAllowed:false,runtimeAdmission:false});const reference=first.catalogSha256;expect(assessAcademyGroupPublicationSchema(c,publication.baseline,publication,reference)).toMatchObject({state:'match',mutationAllowed:false,runtimeAdmission:false});
 for(const relations of [c.relations.slice(1),[...c.relations,{schema:'ls_academy_calendar',name:'unexpected',kind:'r'}]])expect(assessAcademyGroupPublicationSchema({...c,relations},publication.baseline,publication,reference).state).toBe('partial');
 for(const changed of [{...c,functions:[{name:'unreviewed',securityDefiner:true}]},{...c,triggers:[{name:'immutable_publication',enabled:'D'}]},{...c,relations:c.relations.map((r,i)=>i===0?{...r,acl:['PUBLIC SELECT']}:r)}])expect(assessAcademyGroupPublicationSchema(changed,publication.baseline,publication,reference).state).toBe('drift');
 expect(assessAcademyGroupPublicationSchema(c,[...publication.baseline,{name:'synthetic56',checksum:'a'.repeat(64)}],publication,reference)).toMatchObject({state:'baseline_mismatch',baselineMatches:false,mutationAllowed:false,runtimeAdmission:false});expect(assessAcademyGroupCalendarSchema(c,draft.baseline,draft,null)).toMatchObject({version:academyGroupCalendarSchemaVersion,state:'partial',runtimeAdmission:false});
});

test('read-only snapshot rolls back on success and catalog failure, without receiving credentials or making data/schema mutations',async()=>{
 const {publication}=await sources();for(const fail of [false,true]){const statements:string[]=[];const connection:AcademySchemaConnection={query:async<R extends object>(sql:string,values?:readonly unknown[])=>{statements.push(sql);if(sql.startsWith('SELECT current_database'))return {rows:[{database:'synthetic_test',host:'127.0.0.1',port:1,version:'180000',readonly:'on',isolation:'repeatable read'}] as unknown as R[]};if(sql.includes('FROM ls_control.migrations'))return {rows:[...publication.baseline] as unknown as R[]};if(sql.startsWith('SELECT jsonb_build_object')){expect(values).toEqual([publication.namespaces]);if(fail)throw Error('SYNTHETIC_CATALOG_FAILURE');}return {rows:[] as R[]};}};
  if(fail)await expect(readAcademyGroupPublicationSchemaPreflight(connection,publication,null)).rejects.toThrow('SYNTHETIC_CATALOG_FAILURE');else expect(await readAcademyGroupPublicationSchemaPreflight(connection,publication,null)).toMatchObject({state:'absent',mutationAllowed:false,runtimeAdmission:false});expect(statements[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');expect(statements.at(-1)).toBe('ROLLBACK');expect(statements.some(s=>/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT)\b/i.test(s))).toBe(false);
 }
});
