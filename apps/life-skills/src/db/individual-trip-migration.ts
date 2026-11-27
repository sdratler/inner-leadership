import { createHash } from 'node:crypto';
import type { AppliedMigration, Migration } from './migration-plan.ts';

export const INDIVIDUAL_TRIP_MIGRATION = Object.freeze({
  name: '0153_ls_individual_fishing_trips.sql',
  sha256: '9b2f2275ef99791c1fd6a24a617f8cc252208016ca0f6d001e9c30d423257a1d',
});
const predecessorDigest = 'e09c4a9d43608609aaf83ca391168b60d4d7604a816c9744e50d73371134d3af';
const hash = (value:string) => createHash('sha256').update(value).digest('hex');

export function isIndividualTripMigration(file:Migration|undefined):boolean {
  return !!file && file.name === INDIVIDUAL_TRIP_MIGRATION.name
    && file.checksum === INDIVIDUAL_TRIP_MIGRATION.sha256 && hash(file.sql) === file.checksum;
}

/** The production Fishing ledger may omit three separately owned school
 * migrations. Accept only the exact prior ledger and this checked addition. */
export function individualTripUpgradePlan(files:readonly Migration[],history:readonly AppliedMigration[]) {
  const previous = files.slice(0,72), trip = files[72];
  const source = previous.map(f=>({name:f.name,sha256:f.checksum}));
  if (files.length !== 73 || hash(JSON.stringify(source)) !== predecessorDigest
      || previous.some(f=>hash(f.sql)!==f.checksum) || !trip || !isIndividualTripMigration(trip)) {
    throw new Error('TRIP_SCHEMA_SOURCE_MISMATCH');
  }
  const installed = history.at(-1)?.name === trip.name;
  const before = installed ? history.slice(0,-1) : history;
  const expected = before.length === 69 ? [...previous.slice(0,67), ...previous.slice(70)] : previous;
  if (before.length !== expected.length || before.some((row,i)=>row.name!==expected[i]?.name || row.checksum!==expected[i]?.checksum)
      || (installed && history.at(-1)?.checksum !== trip.checksum)) {
    throw new Error('TRIP_SCHEMA_HISTORY_MISMATCH');
  }
  return {installed,trip};
}
