import type { Locale } from "../../lib/locale.ts";
export type WorkspaceRole = "parent" | "client" | "practitioner";
export type NavItem = { key: string; path: string; en: string; he: string };
export type ContextItem = NavItem & { query?: Readonly<Record<string, string>> };
export type NavGroup = { key: string; en: string; he: string; items: readonly NavItem[] };
const item = (key: string, path: string, en: string, he: string): NavItem => ({ key, path, en, he });
export const primaryNavigation: Record<WorkspaceRole, readonly NavItem[]> = {
  parent: [item("home", "family", "Home", "בית"), item("schedule", "family/schedule", "Calendar", "יומן"), item("practice", "family/practice", "Practice", "תרגול"), item("feedback", "family/feedback", "Messages", "הודעות")],
  client: [item("home", "client", "Home", "בית"), item("schedule", "client/calendar", "Calendar", "יומן"), item("practice", "client/practice", "Practice", "תרגול"), item("feedback", "client/messages", "Messages", "הודעות")],
  practitioner: [item("calendar", "app/calendar", "Calendar", "יומן"), item("clients", "app/clients", "Clients", "לקוחות"), item("feedback", "app/feedback", "Communications", "תקשורת"), item("reports", "app/reports", "Reports", "דוחות"), item("marketing", "app/marketing", "Marketing", "שיווק"), item("payments", "app/payments", "Payments", "תשלומים")],
};
export const navigationGroups: Record<WorkspaceRole, readonly NavGroup[]> = {
  parent: [{ key: "materials", en: "Shared with you", he: "שותף איתכם", items: [item("forms", "family/forms", "Forms to complete", "טפסים למילוי"), item("resources", "family/resources", "Materials & exercises", "חומרים ותרגילים"), item("reports", "family/reports", "Shared reports", "דוחות משותפים")] }],
  client: [],
  practitioner: [],
};
const context = (key: string, path: string, en: string, he: string, query?: Record<string,string>): ContextItem => ({ key, path, en, he, ...(query ? { query } : {}) });
/** Context links are views within the selected workspace section, never a second global menu. */
export function practitionerContext(pathname: string, caseId: string | null, selectedClient=false): readonly ContextItem[] {
  if (caseId && (selectedClient || /\/app\/cases\/[0-9a-f-]{36}(?:\/|$)/i.test(pathname))) {
    const base = `app/cases/${caseId}`;
    const query={caseId,context:"client"};
    return [context("overview",base,"Overview","סקירה"),context("calendar","app/calendar","Calendar","יומן",query),context("practice","app/practice","Home practice","תרגול ביתי",query),context("communications","app/feedback","Communications","תקשורת",query),context("sessions",`${base}/sessions`,"Sessions","מפגשים"),context("reports","app/reports","Reports","דוחות",query),context("forms","app/forms","Forms & consent","טפסים והסכמות",query),context("access",`${base}/settings`,"Access","גישה")];
  }
  if (pathname.includes("/app/calendar")) return [context("day","app/calendar","Day","יום",{view:"day"}),context("week","app/calendar","Week","שבוע",{view:"week"}),context("month","app/calendar","Month","חודש",{view:"month"}),context("agenda","app/calendar","Agenda","סדר יום",{view:"agenda"})];
  if (pathname.includes("/app/clients") || pathname.includes("/app/prospects")) return [context("all","app/clients","All","הכול",{section:"all"}),context("prospects","app/clients","Prospects","מתעניינים",{section:"prospects"}),context("paid","app/clients","Paid awaiting booking","שולם, ממתינים למועד",{section:"paid"}),context("active","app/clients","Active","פעילים",{section:"active"}),context("archived","app/clients","Archived","בארכיון",{section:"archived"})];
  if (pathname.includes("/app/marketing")) return [context("overview","app/marketing","Overview","סקירה",{section:"overview"}),context("content_calendar","app/marketing","Content Calendar","יומן תוכן",{section:"content_calendar"}),context("creatives","app/marketing","Creatives","חומרים",{section:"creatives"}),context("needs_approval","app/marketing","Needs approval","ממתינים לאישור",{section:"needs_approval"}),context("community","app/marketing","Community","קהילה",{section:"community"}),context("ads","app/marketing","Ads","מודעות",{section:"ads"})];
  return [];
}
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
export function caseDestinationHref(locale: Locale, path: string, caseId: string): string {
  if (!isCaseId(caseId)) throw new Error("INVALID_CASE_CONTEXT");
  const url = new URL(workspaceHref(locale, path, caseId), "https://private.invalid");
  url.searchParams.set("context", "client");
  return url.pathname + url.search;
}
export function settingsItems(role: WorkspaceRole): readonly NavItem[] {
  const base = role === "parent" ? "family/settings" : role === "client" ? "client/settings" : "app/settings";
  return [item("account", `${base}/account`, "Account & language", "חשבון ושפה"), item("notifications", `${base}/notifications`, "Notifications", "התראות"), ...(role === "parent" ? [item("coordination", `${base}/coordination`, "Task coordination", "תיאום משימות"), item("credits", `${base}/credits`, "Appointment credits", "יתרת מפגשים")] : role === "practitioner" ? [item("availability", `${base}/availability`, "Availability", "זמינות")] : [])];
}
export function activeItem(pathname: string, locale: Locale, role: WorkspaceRole): NavItem | undefined {
  const path = pathname.replace(new RegExp(`^/${locale}/`), "").replace(/\/$/, "");
  if (/^app\/cases\//.test(path)) return primaryNavigation.practitioner.find(x => x.key === "clients");
  if (path === "app/prospects") return primaryNavigation.practitioner.find(x => x.key === "clients");
  return [...primaryNavigation[role], ...navigationGroups[role].flatMap(g => g.items), ...settingsItems(role), ...(role === "practitioner" ? [item("private-notes","app/private-notes","Private case notes","רשימות פרטיות בתיק")] : [])].find(x => x.path === path);
}
export type Crumb = { label: string; path?: string };
export function breadcrumbItems(locale: Locale, role: WorkspaceRole, pathname: string, section?: string | null, view?: string | null, selectedClient=false, caseId?: string | null): Crumb[] {
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
    if(pathname.includes("/sessions")&&isCaseId(id))return [home,{label:locale==="he"?"לקוחות":"Clients",path:"app/clients"},{label:locale==="he"?"התיק הנבחר":"Selected case",path:`app/cases/${id}`},{label:locale==="he"?"מפגשים":"Sessions"}];
    return [home, { label: locale === "he" ? "לקוחות" : "Clients", path: "app/clients" }, { label: locale === "he" ? "התיק הנבחר" : "Selected case" }];
  }
  if(role==="practitioner"&&selectedClient&&isCaseId(caseId)){
    const key=pathname.includes("/app/calendar")?"calendar":pathname.includes("/app/practice")?"practice":pathname.includes("/app/feedback")?"communications":pathname.includes("/app/reports")?"reports":pathname.includes("/app/forms")?"forms":"overview";
    const child=practitionerContext(pathname,caseId,true).find(item=>item.key===key);
    return [home,{label:locale==="he"?"לקוחות":"Clients",path:"app/clients"},{label:locale==="he"?"התיק הנבחר":"Selected case",path:`app/cases/${caseId}`},{label:child?.[locale]??(locale==="he"?"סקירה":"Overview")}];
  }
  const found = activeItem(pathname, locale, role);
  if (role === "practitioner" && found) {
    const child = practitionerContext(pathname, null).find(x => x.key === (found.key === "calendar" ? view : section));
    if (child) return [home, { label: found[locale], path: found.path }, { label: child[locale] }];
  }
  return found && found.path !== home.path ? [home, { label: found[locale] }] : [{ label: found ? found[locale] : home.label }];
}
