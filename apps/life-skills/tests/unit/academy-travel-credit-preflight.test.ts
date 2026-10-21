import {readFile} from 'node:fs/promises';
import {expect,test} from 'vitest';
import {loadAcademySchemaSources} from '../../src/db/academy-schema-preflight.ts';
import {loadTravelCreditSchemaSources,verifyTravelCreditSchemaSources,travelCreditSchemaPins} from '../../src/db/academy-travel-credit-preflight.ts';
const root=new URL('../../',import.meta.url);
test('explicit nine-table overlay preserves the entire baseline55 and original32-table native source bundle',async()=>{
 const before=await readFile(new URL('migrations/manifest.json',root)),base=await loadAcademySchemaSources(root),overlay=await loadTravelCreditSchemaSources(root);
 expect(overlay.baseline).toEqual(base.baseline);expect(base.baseline).toHaveLength(55);expect(base.tables).toHaveLength(32);expect(overlay.tables).toHaveLength(41);expect(overlay.tables).toEqual(expect.arrayContaining([...base.tables]));expect(await readFile(new URL('migrations/manifest.json',root))).toEqual(before);expect(overlay.bundleSha256).not.toBe(base.bundleSha256);
});
test('missing, duplicate or changed SQL is not an admitted equivalent overlay',async()=>{
 const base=await loadAcademySchemaSources(root),entries=await Promise.all(travelCreditSchemaPins.map(async pin=>({path:pin.path,bytes:await readFile(new URL(pin.path,root))})));
 expect(()=>verifyTravelCreditSchemaSources(base,entries.slice(0,1))).toThrow('SOURCE_SET');expect(()=>verifyTravelCreditSchemaSources(base,[entries[0]!,entries[0]!])).toThrow('SOURCE_SET');expect(()=>verifyTravelCreditSchemaSources(base,[entries[0]!,{...entries[1]!,bytes:Buffer.from('changed')}])).toThrow('SOURCE_HASH');
});
