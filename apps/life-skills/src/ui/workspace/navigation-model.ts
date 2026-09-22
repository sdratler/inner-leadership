import type { Locale } from "../../lib/locale.ts";
export type WorkspaceRole = "parent" | "client" | "practitioner";
export type NavItem = { key: string; path: string; en: string; he: string };
export type NavGroup = { key: string; en: string; he: string; items: readonly NavItem[] };
const item = (key: string, path: string, en: string, he: string): NavItem => ({ key, path, en, he });
export const primaryNavigation: Record<WorkspaceRole, readonly NavItem[]> = {
  parent: [item("home", "family", "Home", "בית"), item("schedule", "family/schedule", "Calendar", "יומן"), item("practice", "family/practice", "Practice", "תרגול"), item("feedback", "family/feedback", "Messages", "הודעות")],
  client: [item("home", "client", "Home", "בית"), item("schedule", "client/calendar", "Calendar", "יומן"), item("practice", "client/practice", "Practice", "תרגול"), item("feedback", "client/messages", "Messages", "הודעות")],
  practitioner: [item("calendar", "app/calendar", "Calendar", "יומן"), item("clients", "app/clients", "Clients", "לקוחות"), item("feedback", "app/feedback", "Communications", "תקשורת"), item("reports", "app/reports", "Reports", "דוחות"), item("marketing", "app/marketing", "Marketing", "שיווק")],
};
export const navigationGroups: Record<WorkspaceRole, readonly NavGroup[]> = {
  parent: [{ key: "materials", en: "Shared with you", he: "שותף איתכם", items: [item("forms", "family/forms", "Forms to complete", "טפסים למילוי"), item("resources", "family/resources", "Shared resources", "משאבים משותפים"), item("reports", "family/reports", "Shared reports", "דוחות משותפים")] }],
  client: [],
  practitioner: [{ key: "tools", en: "Tools", he: "כלים", items: [item("practice", "app/practice", "Assignments", "משימות"), item("forms", "app/forms", "Forms", "טפסים"), item("resources", "app/resources", "Resources", "משאבים"), item("payments", "app/payments", "Payments", "תשלומים")] }],
};
export function isCaseId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
/** Navigation preserves context; this is not an authorization decision. */
export function selectedCaseId(pathname: string, queryCaseId: string | null): string | null {
  if (isCaseId(queryCaseId)) return queryCaseId;
  const pathCase = pathname.match(/\/app\/cases\/([^/]+)/i)?.[1];
  if (isCaseId(pathCase)) return pathCase;
  return null;
}
export function workspaceHref(locale: Locale, path: string, caseId?: string | null): string {
  if (!/^(app|family|client)(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) throw new Error("INVALID_WORKSPACE_PATH");
  return `/${locale}/${path}` + (isCaseId(caseId) ? `?caseId=${encodeURIComponent(caseId)}` : "");
}
export function settingsItems(role: WorkspaceRole): readonly NavItem[] {
  const base = role === "parent" ? "family/settings" : role === "client" ? "client/settings" : "app/settings";
  return [item("account", `${base}/account`, "Account & language", "חשבון ושפה"), item("notifications", `${base}/notifications`, "Notifications", "התראות"), ...(role === "parent" ? [item("coordination", `${base}/coordination`, "Task coordination", "תיאום משימות"), item("credits", `${base}/credits`, "Appointment credits", "יתרת מפגשים")] : role === "practitioner" ? [item("availability", `${base}/availability`, "Availability", "זמינות")] : [])];
}
export function activeItem(pathname: string, locale: Locale, role: WorkspaceRole): NavItem | undefined {
  const path = pathname.replace(new RegExp(`^/${locale}/`), "").replace(/\/$/, "");
  if (/^app\/cases\//.test(path)) return primaryNavigation.practitioner.find(x => x.key === "clients");
  return [...primaryNavigation[role], ...navigationGroups[role].flatMap(g => g.items), ...settingsItems(role), ...(role === "practitioner" ? [item("private-notes","app/private-notes","Private case notes","רשימות פרטיות בתיק")] : [])].find(x => x.path === path);
}
export type Crumb = { label: string; path?: string };
export function breadcrumbItems(locale: Locale, role: WorkspaceRole, pathname: string): Crumb[] {
  const base = role === "parent" ? "family" : role === "client" ? "client" : "app";
  const home = { label: locale === "he" ? "בית" : "Home", path: role === "parent" ? "family" : role === "client" ? "client" : "app/calendar" };
  const settings = `${base}/settings`;
  if (pathname === `/${locale}/${settings}`) return [home, { label: locale === "he" ? "הגדרות" : "Settings" }];
  if (pathname.startsWith(`/${locale}/${settings}/`)) {
    const found = settingsItems(role).find(x => `/${locale}/${x.path}` === pathname);
    return [home, { label: locale === "he" ? "הגדרות" : "Settings", path: settings }, { label: found ? found[locale] : (locale === "he" ? "פרטי ההגדרה" : "Setting details") }];
  }
  if (pathname.includes("/app/cases/")) {
    const id=pathname.match(/\/app\/cases\/([^/]+)/)?.[1];
    if(pathname.endsWith("/settings")&&isCaseId(id))return [home,{label:locale==="he"?"תיקים":"Clients",path:"app/clients"},{label:locale==="he"?"התיק הנבחר":"Selected case",path:`app/cases/${id}`},{label:locale==="he"?"גישה ומשתתפים":"Access & participants"}];
    return [home, { label: locale === "he" ? "תיקים" : "Clients", path: "app/clients" }, { label: locale === "he" ? "התיק הנבחר" : "Selected case" }];
  }
  const found = activeItem(pathname, locale, role);
  return found && found.path !== home.path ? [home, { label: found[locale] }] : [{ label: found ? found[locale] : home.label }];
}
