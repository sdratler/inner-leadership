import type { Channel, CreativeVersion, Publication } from "./contracts.ts";
import { publicationLabel } from "./read-model.ts";
import { validDate, validIso } from "../session-workflow/policy.ts";

export const CONTENT_TIMEZONE = "Asia/Jerusalem";
const hebrewPublicationLabels: Readonly<Record<string, string>> = {
  "Creative revision unavailable": "גרסת הקריאייטיב אינה זמינה",
  "Manually marked as posted — not provider-verified": "סומן ידנית כפורסם — ללא אימות מהספק",
  "Unknown": "לא ידוע",
  "Manual channel — publication not independently verified": "ערוץ ידני — הפרסום לא אומת באופן עצמאי",
  "Published — provider receipt recorded": "פורסם — נשמרה אסמכתה מהספק",
  "Unknown — publication not verified": "לא ידוע — הפרסום לא אומת",
  "Reminder scheduled — manual posting required": "תזכורת תוזמנה — נדרש פרסום ידני",
  "Manual posting planned": "פרסום ידני מתוכנן",
  "Scheduled — provider confirmed": "תוזמן — הספק אישר",
  "Planned — not provider-confirmed": "מתוכנן — ללא אישור מהספק",
  "Approved, not scheduled": "אושר, אך לא תוזמן",
  "Not approved for this revision": "גרסה זו אינה מאושרת",
  "Draft": "טיוטה",
  "Sending — awaiting result": "בשליחה — ממתין לתוצאה",
  "Failed": "נכשל",
  "Unknown — check provider": "לא ידוע — יש לבדוק אצל הספק",
  "Skipped — no backfill": "דולג — ללא השלמהย้อนหลัง",
};
export function publicationStatusText(item: Publication, creatives: readonly CreativeVersion[], locale: "en" | "he"): string {
  if (item.state === "skipped") return locale === "he" ? "דולג לפי כלל יום המנוחה הרשום; ללא השלמהย้อนหลัง" : "Skipped by the recorded quiet-day rule; no backfill";
  const label = publicationLabel(item, creatives);
  return locale === "he" ? hebrewPublicationLabels[label] ?? label : label;
}
const MONTH = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const queuedStates = new Set<Publication["state"]>(["ready", "scheduled", "sending"]);
const instant = (value: string | null): number => validIso(value) ? Date.parse(value) : Number.POSITIVE_INFINITY;
export type ContentView = "all" | "queued" | "drafts" | "published" | "history";
export function contentView(value: string | undefined): ContentView {
  return value === "queued" || value === "drafts" || value === "published" || value === "history" ? value : "all";
}
export function contentViewPublications(publications: readonly Publication[], view: ContentView): readonly Publication[] {
  return publications.filter(item => view === "all" ||
    view === "queued" && queuedStates.has(item.state) ||
    view === "drafts" && item.state === "draft" ||
    view === "published" && item.state === "published" ||
    view === "history" && ["published", "manually_reported", "skipped", "failed", "unknown"].includes(item.state));
}
export function publicationDisplayTime(item: Publication): string | null {
  if (item.state === "manually_reported" && item.manualReportedAt !== null && !validIso(item.manualReportedAt)) return null;
  if (item.state === "manually_reported" && validIso(item.manualReportedAt)) return item.manualReportedAt;
  return validIso(item.scheduledFor) ? item.scheduledFor : null;
}
export function publicationTimeIssue(item: Publication): "manual" | "scheduled" | null {
  if (item.state === "manually_reported" && item.manualReportedAt !== null && !validIso(item.manualReportedAt)) return "manual";
  return item.scheduledFor !== null && !validIso(item.scheduledFor) ? "scheduled" : null;
}

export function contentDayKey(instant: string, timezone = CONTENT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function contentMonth(value: string | undefined, now: Date): string {
  return value && MONTH.test(value) ? value : contentDayKey(now.toISOString()).slice(0, 7);
}
export function adjacentMonth(value: string, offset: -1 | 1): string {
  if (!MONTH.test(value)) throw Error("INVALID_MONTH");
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function calendarDates(month: string): readonly (string | null)[] {
  if (!MONTH.test(month)) throw Error("INVALID_MONTH");
  const [year, number] = month.split("-").map(Number);
  const prefix = new Date(Date.UTC(year!, number! - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year!, number!, 0)).getUTCDate();
  return [...Array<null>(prefix).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
}
export function orderedPublicationQueue(publications: readonly Publication[]): readonly Publication[] {
  return publications.filter(item => queuedStates.has(item.state)).slice().sort((a, b) =>
    instant(a.scheduledFor) - instant(b.scheduledFor) || a.id.localeCompare(b.id));
}
export function nextHebrewStatus(publications: readonly Publication[], creatives: readonly CreativeVersion[], now: Date): Publication | null {
  return orderedPublicationQueue(publications).find(item => item.channel === "whatsapp_status" &&
    validIso(item.scheduledFor) && Date.parse(item.scheduledFor) >= now.getTime() &&
    creatives.some(asset => asset.assetId === item.assetId && asset.revision === item.creativeRevision && asset.contentDigest === item.creativeDigest && asset.locale === "he")) ?? null;
}
export function monthPublications(publications: readonly Publication[], month: string): ReadonlyMap<string, readonly Publication[]> {
  if (!MONTH.test(month)) throw Error("INVALID_MONTH");
  const days = new Map<string, Publication[]>();
  for (const item of publications) {
    const recordedAt = publicationDisplayTime(item);
    if (!recordedAt) continue;
    const key = contentDayKey(recordedAt);
    if (!key.startsWith(`${month}-`)) continue;
    const list = days.get(key) ?? [];
    list.push(item); days.set(key, list);
  }
  for (const list of days.values()) list.sort((a, b) => instant(publicationDisplayTime(a)) - instant(publicationDisplayTime(b)) || a.id.localeCompare(b.id));
  return days;
}

export type ContentLayout = "month" | "week" | "agenda";
export const CONTENT_CHANNELS: readonly Channel[] = ["whatsapp_status", "facebook_page", "instagram", "facebook_group_manual", "whatsapp_group_manual"];
export const CONTENT_STATES: readonly Publication["state"][] = ["draft", "ready", "scheduled", "sending", "published", "failed", "unknown", "skipped", "manually_reported"];
export function contentLayout(value: string | undefined): ContentLayout { return value === "week" || value === "agenda" ? value : "month"; }
export function contentChannel(value: string | undefined): Channel | null { return CONTENT_CHANNELS.find(channel => channel === value) ?? null; }
export function contentState(value: string | undefined): Publication["state"] | null { return CONTENT_STATES.find(state => state === value) ?? null; }
export function contentDate(value: string | undefined): string | null { return value && validDate(value) && MONTH.test(value.slice(0, 7)) ? value : null; }
export function shiftContentDate(value: string, days: number): string {
  if (!contentDate(value) || !Number.isInteger(days) || Math.abs(days) > 31) throw Error("INVALID_DATE");
  const date = new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate() + days);return date.toISOString().slice(0, 10);
}
export function contentWeekDates(value: string): readonly string[] {
  if (!contentDate(value)) throw Error("INVALID_DATE");
  const start = shiftContentDate(value, -new Date(`${value}T12:00:00Z`).getUTCDay());
  return Array.from({length:7}, (_, index) => {const date=new Date(`${start}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+index);return date.toISOString().slice(0,10);});
}
export function orderedContentRecords(items: readonly Publication[]): readonly Publication[] {
  return items.slice().sort((a, b) => instant(publicationDisplayTime(a)) - instant(publicationDisplayTime(b)) || a.id.localeCompare(b.id));
}
export function dateFilteredContent(items: readonly Publication[], from: string | null, to: string | null): readonly Publication[] {
  return items.filter(item => {
    const instant = publicationDisplayTime(item);
    // Undated/malformed records are rendered separately, never assigned a guessed day.
    if (!instant) return !from && !to;
    const day = contentDayKey(instant);return (!from || day >= from) && (!to || day <= to);
  });
}
