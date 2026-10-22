import {readFile} from 'node:fs/promises';
import {expect,test} from 'vitest';
import {academySchemaSourcePins,academySchemaSourceVersion,historicalAcademySchemaSourcePins,historicalAcademySchemaBundleSha256,verifyAcademySchemaSources,loadAcademySchemaSources,assessAcademySchema,readAcademySchemaPreflight,type AcademySchemaCatalog} from '../../src/db/academy-schema-preflight.ts';
const root=new URL('../../',import.meta.url);
const empty:AcademySchemaCatalog={serverMajor:18,namespaces:[],relations:[],columns:[],constraints:[],indexes:[],triggers:[],functions:[],types:[],policies:[],defaults:[]};
const owner03Tables=['ls_fishing_stage.block_acceptances','ls_fishing_stage.refund_cancellations','ls_fishing_stage.refund_fee_reservations','ls_fishing_stage.refund_preparations','ls_fishing_stage.refund_preparation_members'] as const;
test('verifies the canonical Git LF source bytes independently of checkout conversion',async()=>{
 const entries=await Promise.all(academySchemaSourcePins.map(async pin=>({path:pin.path,bytes:Buffer.from((await readFile(new URL(pin.path,root),'utf8')).replace(/\r\n/g,'\n'))})));
 const sources=verifyAcademySchemaSources(entries);expect(sources.baseline).toHaveLength(55);expect(sources.tables).toHaveLength(32);
});

test('keeps historical mixed-ending source identity separate from the current Git LF version',async()=>{
 expect(academySchemaSourceVersion).toBe('JLFA-ACADEMY-SCHEMA-GIT-LF-20261022-01');
 expect(historicalAcademySchemaSourcePins[0]!.sha256).toBe('602bbc5dc51a24060eaaa82db76a529ddf2c10b7615ea4a98c7ef09cc5ee4252');
 expect(historicalAcademySchemaSourcePins[1]!.sha256).toBe('af08db497a42722fffa815e583b65953d2a04107a52f2b18055da5467bf3e35c');
 expect(academySchemaSourcePins[0]!.sha256).toBe('938c73e04fdc28c811a9d08f76f91c27240ce3685e0b501ec632b6304b53d897');
 expect(academySchemaSourcePins[1]!.sha256).toBe('38a77b1f42b52dc2952e0d89861008ba5c6306654535bce2fc7588ca2fadcd98');
 expect(academySchemaSourcePins.slice(2)).toEqual(historicalAcademySchemaSourcePins.slice(2));expect(Object.isFrozen(historicalAcademySchemaSourcePins[0])).toBe(true);
 expect((await loadAcademySchemaSources(root)).bundleSha256).not.toBe(historicalAcademySchemaBundleSha256);
});

test('rejects CRLF and extra-newline variants rather than normalizing or accepting old source bytes',async()=>{
 const entries=await Promise.all(academySchemaSourcePins.map(async pin=>({path:pin.path,bytes:await readFile(new URL(pin.path,root))})));
 for(const [i,entry]of entries.entries()){
  expect(entry.bytes.includes(13)).toBe(false);
  for(const bytes of [Buffer.from(entry.bytes.toString('utf8').replace(/\n/g,'\r\n')),Buffer.concat([entry.bytes,Buffer.from('\n')])]){
   expect(()=>verifyAcademySchemaSources(entries.map((e,j)=>j===i?{...e,bytes}:e))).toThrow('SOURCE_HASH');
  }
 }
});

test('Academy schema inventory pins all four proposals and the unchanged 55-migration baseline',async()=>{
 const sources=await loadAcademySchemaSources(root);expect(sources.baseline).toHaveLength(55);expect(sources.tables).toHaveLength(32);expect(sources.tables.filter(t=>t.startsWith('ls_fishing_stage.'))).toHaveLength(20);expect(sources.tables.filter(t=>t.startsWith('ls_fishing_payments.'))).toHaveLength(12);for(const table of owner03Tables)expect(sources.tables).toContain(table);expect(sources.tables).toContain('ls_fishing_stage.cohorts');expect(sources.tables).toContain('ls_fishing_payments.object_bindings');expect(new Set(sources.tables).size).toBe(sources.tables.length);expect(sources.bundleSha256).toMatch(/^[a-f0-9]{64}$/);expect(Object.isFrozen(academySchemaSourcePins[0])).toBe(true);
});

test.each(owner03Tables)('missing current Owner03 table %s remains partial even with a previously matching reference',async missing=>{
 const sources=await loadAcademySchemaSources(root),full={...empty,namespaces:[{name:'ls_fishing_payments'},{name:'ls_fishing_stage'}],relations:sources.tables.map(t=>({schema:t.split('.')[0],name:t.split('.')[1],kind:'r'}))},reference=assessAcademySchema(full,sources.baseline,sources,null).catalogSha256,partial={...full,relations:full.relations.filter(t=>t.schema+'.'+t.name!==missing)};
 expect(assessAcademySchema(full,sources.baseline,sources,null)).toMatchObject({state:'unreviewed',mutationAllowed:false});expect(assessAcademySchema(full,sources.baseline,sources,reference)).toMatchObject({state:'match',mutationAllowed:false});for(const reviewed of [null,reference])expect(assessAcademySchema(partial,sources.baseline,sources,reviewed)).toMatchObject({state:'partial',baselineMatches:true,mutationAllowed:false});
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
