import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { individualTripUpgradePlan } from '../../src/db/individual-trip-migration.ts';

const root = new URL('../../migrations/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')) as {name:string;sha256:string}[];
const files = manifest.map(f => ({name:f.name,checksum:f.sha256,sql:readFileSync(new URL(f.name,root),'utf8')}));
const previous = files.slice(0,-1);
const trip = files.at(-1)!;
const selective = [...previous.slice(0,67), ...previous.slice(70)];

it.each([['complete',previous],['selective',selective]] as const)('adds only the trip schema to the %s predecessor',(_,rows) => {
  expect(individualTripUpgradePlan(files,rows)).toEqual({installed:false,trip});
  expect(individualTripUpgradePlan(files,[...rows,trip])).toEqual({installed:true,trip});
});
it('rejects alternate source, partial ledgers, repeated or altered migration records',() => {
  for (const rows of [previous.slice(1),selective.slice(0,-1),[...selective,trip,trip],[...previous,{...trip,checksum:'0'.repeat(64)}]]) {
    expect(()=>individualTripUpgradePlan(files,rows)).toThrow('TRIP_SCHEMA_HISTORY_MISMATCH');
  }
  for (const index of [0,67,69,71,72]) {
    const sql = files[index]!.sql+'\n-- changed';
    for (const checksum of [files[index]!.checksum,createHash('sha256').update(sql).digest('hex')]) {
      expect(()=>individualTripUpgradePlan(files.map((f,i)=>i===index?{...f,sql,checksum}:f),previous)).toThrow('TRIP_SCHEMA_SOURCE_MISMATCH');
    }
  }
  expect(()=>individualTripUpgradePlan(previous,previous)).toThrow('TRIP_SCHEMA_SOURCE_MISMATCH');
});
