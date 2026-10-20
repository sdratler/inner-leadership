import {readFile} from 'node:fs/promises';
import {expect,test} from 'vitest';
import {academySchemaSourcePins,verifyAcademySchemaSources,loadAcademySchemaSources,assessAcademySchema,readAcademySchemaPreflight,type AcademySchemaCatalog} from '../../src/db/academy-schema-preflight.ts';
const root=new URL('../../',import.meta.url);
const empty:AcademySchemaCatalog={serverMajor:18,namespaces:[],relations:[],columns:[],constraints:[],indexes:[],triggers:[],functions:[],types:[],policies:[],defaults:[]};
test('Academy schema inventory pins all four proposals and the unchanged 55-migration baseline',async()=>{
 const sources=await loadAcademySchemaSources(root);expect(sources.baseline).toHaveLength(55);expect(sources.tables).toContain('ls_fishing_stage.cohorts');expect(sources.tables).toContain('ls_fishing_payments.object_bindings');expect(new Set(sources.tables).size).toBe(sources.tables.length);expect(sources.bundleSha256).toMatch(/^[a-f0-9]{64}$/);expect(Object.isFrozen(academySchemaSourcePins[0])).toBe(true);
});
test('missing, duplicate, unexpected or changed schema bytes are rejected before any database access',async()=>{
 const entries=await Promise.all(academySchemaSourcePins.map(async pin=>({path:pin.path,bytes:await readFile(new URL(pin.path,root))})));expect(()=>verifyAcademySchemaSources(entries.slice(1))).toThrow('SOURCE_SET');expect(()=>verifyAcademySchemaSources([entries[0]!,...entries.slice(0,-1)])).toThrow('SOURCE_SET');expect(()=>verifyAcademySchemaSources(entries.map((e,i)=>i===1?{...e,bytes:Buffer.concat([e.bytes,Buffer.from('\n')])}:e))).toThrow('SOURCE_HASH');expect(()=>verifyAcademySchemaSources(entries.map((e,i)=>i===1?{...e,path:'unexpected.sql'}:e))).toThrow('SOURCE_HASH');
});
test('absent, partial, unreviewed, match, drift and baseline mismatch stay distinct and never authorize mutation',async()=>{
 const sources=await loadAcademySchemaSources(root),history=sources.baseline,full={...empty,namespaces:[{name:'ls_fishing_payments'},{name:'ls_fishing_stage'}],relations:sources.tables.map(t=>({schema:t.split('.')[0],name:t.split('.')[1],kind:'r'}))};
 expect(assessAcademySchema(empty,history,sources,null)).toMatchObject({state:'absent',mutationAllowed:false});expect(assessAcademySchema({...full,relations:full.relations.slice(1)},history,sources,null).state).toBe('partial');expect(assessAcademySchema({...full,namespaces:full.namespaces.slice(1)},history,sources,null).state).toBe('partial');const unreviewed=assessAcademySchema(full,history,sources,null);expect(unreviewed.state).toBe('unreviewed');expect(assessAcademySchema(full,history,sources,unreviewed.catalogSha256)).toMatchObject({state:'match',mutationAllowed:false});expect(assessAcademySchema({...full,functions:[{definition:'changed'}]},history,sources,unreviewed.catalogSha256).state).toBe('drift');expect(assessAcademySchema(full,history.slice(1),sources,unreviewed.catalogSha256).state).toBe('baseline_mismatch');
});
test('invalid reviewed reference fails before opening a transaction',async()=>{
 const sources=await loadAcademySchemaSources(root);let calls=0;await expect(readAcademySchemaPreflight({query:async()=>{calls++;throw Error('UNEXPECTED_CONNECTION');}},sources,'unreviewed')).rejects.toThrow('REFERENCE_INVALID');expect(calls).toBe(0);
});
test('an inspection error always rolls back and never falls back to mutation or an absent claim',async()=>{
 const sources=await loadAcademySchemaSources(root),calls:string[]=[];await expect(readAcademySchemaPreflight({query:async sql=>{calls.push(sql);if(sql.startsWith('SET LOCAL search_path'))throw Error('SYNTHETIC_CATALOG_FAILURE');return {rows:[]};}},sources,null)).rejects.toThrow('SYNTHETIC_CATALOG_FAILURE');expect(calls[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');expect(calls.at(-1)).toBe('ROLLBACK');expect(calls).toHaveLength(3);
});
