import { z } from 'zod';
/** Explicit Florida wall time for owner scheduling; never use the browser's zone. */
export const FLORIDA_TIME_ZONE = 'America/New_York' as const;
const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: FLORIDA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };
function utc(w: Wall) {
  const date = new Date(0); date.setUTCFullYear(w.year, w.month - 1, w.day); date.setUTCHours(w.hour, w.minute, w.second, w.millisecond); return date.valueOf();
}
function wall(at: number): Wall {
  const parts = formatter.formatToParts(new Date(at)), get = (key: string) => Number(parts.find(part => part.type === key)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second'), millisecond: new Date(at).getUTCMilliseconds() };
}
export type FloridaLocalTimeResult = { state: 'ready'; instant: string } | { state: 'invalid' | 'nonexistent' | 'ambiguous' };
export function resolveFloridaLocalTime(value: string): FloridaLocalTimeResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return { state: 'invalid' };
  const w: Wall = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0), millisecond: Number((match[7] ?? '').padEnd(3, '0')) };
  if (w.year < 1 || w.month < 1 || w.month > 12 || w.day < 1 || w.day > 31 || w.hour > 23 || w.minute > 59 || w.second > 59) return { state: 'invalid' };
  const target = utc(w), date = new Date(target);
  if (date.getUTCFullYear() !== w.year || date.getUTCMonth() + 1 !== w.month || date.getUTCDate() !== w.day) return { state: 'invalid' };
  const offsets = new Set<number>();
  for (const hours of [-36, 0, 36]) { const sample = target + hours * 3_600_000; offsets.add(utc(wall(sample)) - sample); }
  const candidates = [...offsets].map(offset => target - offset).filter(at => utc(wall(at)) === target);
  if (candidates.length === 0) return { state: 'nonexistent' };
  if (candidates.length !== 1) return { state: 'ambiguous' };
  return { state: 'ready', instant: new Date(candidates[0]!).toISOString() };
}
export function formatFloridaLocalTime(instant: string): string {
  // Only actual offset-bearing instants may be displayed as saved times.
  if (!z.iso.datetime({ offset: true }).safeParse(instant).success || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(instant) || !Number.isFinite(Date.parse(instant))) throw new RangeError('INVALID_SAVED_INSTANT');
  const w = wall(Date.parse(instant)), pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}` + (w.second || w.millisecond ? `:${pad(w.second)}` : '') + (w.millisecond ? `.${pad(w.millisecond, 3)}` : '');
}
