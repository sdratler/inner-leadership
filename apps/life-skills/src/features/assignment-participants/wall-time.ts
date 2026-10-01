import { invariant, validDate, validTimezone } from "../session-workflow/policy.ts";
export const validClock = (s: unknown): s is string => typeof s === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
function wallParts(instant: number, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
/** Shared, browser-safe conversion. Zero=gap; two=fold, never normalize a nonexistent time. */
export function wallTimeCandidates(date: string, time: string, timezone: string): readonly string[] {
  invariant(validDate(date) && validClock(time) && validTimezone(timezone), "LOCAL_TIME_INVALID");
  const wall = Date.parse(`${date}T${time}:00Z`), offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = wall + hours * 3600000, p = wallParts(probe, timezone);
    offsets.add(Date.parse(`${p.date}T${p.time}:00Z`) - probe);
  }
  const results = new Set<string>();
  for (const offset of offsets) {
    const candidate = wall - offset, p = wallParts(candidate, timezone);
    if (p.date === date && p.time === time) results.add(new Date(candidate).toISOString());
  }
  return [...results].sort();
}
