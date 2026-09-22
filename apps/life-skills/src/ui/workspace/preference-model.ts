import type { Locale } from "../../lib/locale.ts";
export type EventType = "practice_due" | "appointment_changed" | "new_reply" | "summary_published";
export type Channel = "in_app" | "email" | "push" | "whatsapp";
export type Preference = { eventType: EventType; channel: Channel; enabled: boolean; locale: Locale; timezone: string; quietStart: string | null; quietEnd: string | null };
export const preferenceEvents: readonly EventType[] = ["practice_due", "appointment_changed", "new_reply", "summary_published"];
export const deliveryChannels: readonly Exclude<Channel, "in_app">[] = ["email", "push", "whatsapp"];
export function updatePreference(rows: Preference[], eventType: EventType, channel: Channel, enabled: boolean): Preference[] {
  // A missing preference is not permission to create one. Its control is disabled in the view.
  return rows.map(row => row.eventType === eventType && row.channel === channel ? { ...row, enabled } : row);
}
export function preferenceFingerprint(rows: readonly Preference[]): string {
  return JSON.stringify([...rows].sort((a,b) => `${a.eventType}:${a.channel}`.localeCompare(`${b.eventType}:${b.channel}`)).map(r => [r.eventType,r.channel,r.enabled,r.locale,r.timezone,r.quietStart,r.quietEnd]));
}
export function duplicatePreferences(rows: readonly Preference[]): boolean {
  return new Set(rows.map(r => `${r.eventType}:${r.channel}`)).size !== rows.length;
}
export function validQuietHours(start: string, end: string): boolean {
  return (!start && !end) || (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) && start !== end);
}
