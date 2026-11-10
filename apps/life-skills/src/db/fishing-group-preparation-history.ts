import { createHash } from 'node:crypto';
import { INQUIRY_EMAIL_CONTROL_MIGRATIONS } from './inquiry-email-control-history.ts';
import type { AppliedMigration, Migration } from './migration-plan.ts';

const preparation = {
  name: '0153_ls_fishing_group_preparations.sql',
  sha256: '8e7613ef09f06228dcb49dd89d806fc3947abce298ce1bc1263bbaf4d15f3079',
} as const;
const prior72Sha256 = 'e09c4a9d43608609aaf83ca391168b60d4d7604a816c9744e50d73371134d3af';
const tail = Object.freeze([...INQUIRY_EMAIL_CONTROL_MIGRATIONS, preparation]);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Called after generic inventory validation. Recognize this exact selective successor only.
 * Held BNA files remain pending. Planning never authorizes their application or activation. */
export function planAfterFishingGroupPreparation(
  sorted: readonly Migration[], applied: readonly AppliedMigration[],
): readonly Migration[] | undefined {
  const previous = sorted.slice(0, 72), source = sorted[72];
  if (previous.length !== 72 || hash(JSON.stringify(previous.map(file => ({ name: file.name, sha256: file.checksum })))) !== prior72Sha256 ||
      previous.some(file => hash(file.sql) !== file.checksum)) return;
  if (!source || source.name !== preparation.name || source.checksum !== preparation.sha256 || hash(source.sql) !== preparation.sha256) return;

  const prefixLength = applied.length - tail.length;
  if (prefixLength < 67 || prefixLength > 70) return;
  if (applied.slice(0, prefixLength).some((item, index) =>
    item.name !== sorted[index]!.name || item.checksum !== sorted[index]!.checksum)) return;
  if (applied.slice(prefixLength).some((item, index) =>
    item.name !== tail[index]!.name || item.checksum !== tail[index]!.sha256)) return;

  const installed = new Set(applied.map(item => item.name));
  return sorted.filter(file => !installed.has(file.name));
}
