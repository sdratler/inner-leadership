import type { Locale } from "../../lib/locale.ts";

// These are app-owned administrative labels. Unknown or practitioner-written text
// stays verbatim; presentation must never rewrite the CRM's stored values.
const hebrewStages = new Map<string, string>([
  ["New inquiry", "פנייה חדשה"],
  ["Contacted", "נוצר קשר"],
  ["Offer made", "ניתנה הצעה"],
  ["Prospect", "מתעניין/ת"],
]);

const hebrewActions = new Map<string, string>([
  ["Respond to inbound WhatsApp inquiry", "מענה לפניית WhatsApp נכנסת"],
  ["Review inbound inquiry", "בדיקת פנייה נכנסת"],
]);

export function administrativeStageLabel(value: string, locale: Locale): string {
  return locale === "he" ? hebrewStages.get(value) ?? value : value;
}

/** Choice labels are localized; their values remain the original stored keys. */
export function administrativeStageChoices(locale: Locale): {value: string; label: string}[] {
  return [...hebrewStages.keys()].map(value => ({value, label: administrativeStageLabel(value, locale)}));
}

/** Structured commands can select only these existing app-owned options.
 * Historical/custom stored statuses remain untouched and visible verbatim. */
export function approvedAdministrativeStage(value: string): boolean { return hebrewStages.has(value); }

export function administrativeActionLabel(value: string, locale: Locale): string {
  return locale === "he" ? hebrewActions.get(value) ?? value : value;
}

export function linkedInquiryTaskTitle(title: string, sourceKind: "crm_followup" | null, locale: Locale): string {
  if (locale !== "he" || sourceKind !== "crm_followup") return title;
  const separator = " · ", split = title.indexOf(separator);
  // An old linked title has no separate action field. Only a single boundary
  // can identify the complete app-owned phrase; never translate a fragment of
  // custom action text (or a name that itself contains the separator).
  if (split < 0 || split !== title.lastIndexOf(separator)) return title;
  const action = title.slice(split + separator.length);
  const label = administrativeActionLabel(action, locale);
  return label === action ? title : title.slice(0, split + separator.length) + label;
}
