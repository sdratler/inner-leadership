import type { Locale } from "./locale.ts";
export const PRACTICE_TIME_ZONE = "Asia/Jerusalem";
declare const instantBrand: unique symbol;
export type Instant = string & { readonly [instantBrand]: "UTC" };
/** Offset-qualified timestamps only. Naive wall-clock parsing is deliberately absent. */
export function instant(value: string): Instant {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_INSTANT");
  const y=Number(match[1]), m=Number(match[2]), d=Number(match[3]);
  const h=Number(match[4]), min=Number(match[5]), s=Number(match[6]);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > days || h > 23 || min > 59 || s > 59) throw new Error("INVALID_INSTANT");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_INSTANT");
  return date.toISOString() as Instant;
}
export function elapsedMilliseconds(from: Instant, to: Instant): number {
  return Date.parse(instant(to)) - Date.parse(instant(from));
}
export function formatInstant(value: Instant, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    timeZone: PRACTICE_TIME_ZONE, dateStyle: "medium", timeStyle: "short", hourCycle: "h23",
  }).format(new Date(instant(value)));
}
export function practiceCalendarDate(value: Instant): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PRACTICE_TIME_ZONE, year:"numeric",month:"2-digit",day:"2-digit" }).formatToParts(new Date(instant(value)));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
