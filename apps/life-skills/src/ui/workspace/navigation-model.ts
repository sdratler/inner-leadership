import type { Locale } from "../../lib/locale.ts";
export type WorkspaceRole = "parent" | "client" | "practitioner";
export type NavItem = { key: string; path: string; en: string; he: string };
export type ContextItem = NavItem & { query?: Readonly<Record<string, string>> };
export type NavGroup = { key: string; en: string; he: string; items: readonly NavItem[] };
const item = (key: string, path: string, en: string, he: string): NavItem => ({ key, path, en, he });
export const primaryNavigation: Record<WorkspaceRole, readonly NavItem[]> = {
  parent: [item("schedule", "family/schedule", "Calendar", "יומן"), item("home", "family", "Home", "בית"), item("practice", "family/practice", "Practice", "תרגול"), item("feedback", "family/feedback", "Messages", "הודעות")],
  client: [item("home", "client", "Home", "בית"), item("schedule", "client/calendar", "Calendar", "יומן"), item("practice", "client/practice", "Practice", "תרגול"), item("feedback", "client/messages", "Messages", "הודעות")],
  practitioner: [item("calendar", "app/calendar", "Calendar", "יומן"), item("clients", "app/clients", "People", "אנשים"), item("feedback", "app/feedback", "Communications", "תקשורת"), item("reports", "app/reports", "Reports", "דוחות"), item("marketing", "app/marketing", "Marketing", "שיווק"), item("payments", "app/payments", "Payments", "תשלומים")],
};
export const navigationGroups: Record<WorkspaceRole, readonly NavGroup[]> = {
  parent: [{ key: "materials", en: "Shared with you", he: "שותף איתכם", items: [item("forms", "family/forms", "Forms to complete", "טפסים למילוי"), item("resources", "family/resources", "Materials & exercises", "חומרים ותרגילים"), item("reports", "family/reports", "Shared reports", "דוחות משותפים")] }],
  client: [{key:'materials',en:'Shared with you',he:'שותף איתכם',items:[item('forms','client/forms','Forms to complete','טפסים למילוי'),item('resources','client/resources','Materials & exercises','חומרים ותרגילים')]}],
  practitioner: [],
};
/** The server supplies the actual subject role. Unknown/child clients get no adult-form shortcuts. */
export function workspaceGroups(role:WorkspaceRole,clientRole?:'adult_client'|'child'):readonly NavGroup[]{return role==='client'&&clientRole!=='adult_client'?[]:navigationGroups[role]}
const context = (key: string, path: string, en: string, he: string, query?: Record<string,string>): ContextItem => ({ key, path, en, he, ...(query ? { query } : {}) });
/** Context links are views within the selected workspace section, never a second global menu. */
export function practitionerContext(pathname: string, caseId: string | null, selectedClient=false): readonly ContextItem[] {
  if (pathname.endsWith("/app/practice")) return [context("practice","app/practice","Instructions","הנחיות"),context("goals","app/practice","Goals","מטרות",{section:"goals"}),context("commitments","app/practice","Commitments","מחויבויות",{section:"commitments"}),context("checkins","app/practice","Check-ins","דיווחים",{section:"checkins"})];
  if (caseId && (selectedClient || /\/app\/cases\/[0-9a-f-]{36}(?:\/|$)/i.test(pathname))) {
    const base = `app/cases/${caseId}`;
    const query={caseId,context:"client"};
    return [context("overview",base,"Overview","סקירה"),context("calendar","app/calendar","Calendar","יומן",query),context("practice","app/practice","Home practice","תרגול ביתי",query),context("communications","app/feedback","Communications","תקשורת",query),context("sessions",`${base}/sessions`,"Sessions","מפגשים"),context("reports","app/reports","Reports","דוחות",query),context("forms","app/forms","Forms & consent","טפסים והסכמות",query),context('resources','app/resources','Materials & exercises','חומרים ותרגילים',query),context("access",`${base}/settings`,"Access","גישה")];
  }
  if (pathname.includes("/app/feedback")) return [context("app_updates","app/feedback","App feedback","משוב באפליקציה",{section:"app_updates"}),context("whatsapp","app/feedback","Business WhatsApp","WhatsApp עסקי",{section:"whatsapp"})];
  if (pathname.includes("/app/reports")) return [context("due","app/reports","Due","להשלמה",{section:"due"}),context("drafts","app/reports","Drafts","טיוטות",{section:"drafts"}),context("published","app/reports","Published","פורסמו",{section:"published"}),context("history","app/reports","History","היסטוריה",{section:"history"})];
  if (pathname.includes("/app/calendar")) return [context("day","app/calendar","Day","יום",{view:"day"}),context("week","app/calendar","Week","שבוע",{view:"week"}),context("month","app/calendar","Month","חודש",{view:"month"}),context("agenda","app/calendar","Agenda","סדר יום",{view:"agenda"})];
  if (pathname.includes("/app/clients") || pathname.includes("/app/prospects")) return [context("all","app/clients","All","הכול",{section:"all"}),context("prospects","app/clients","Prospects","מתעניינים",{section:"prospects"}),context("needs_review","app/clients","Needs review","לבדיקה",{section:"needs_review"}),context("paid","app/clients","Paid awaiting booking","שולם, ממתינים למועד",{section:"paid"}),context("active","app/clients","Active","פעילים",{section:"active"}),context("archived","app/clients","Archived","בארכיון",{section:"archived"})];
  if (pathname.includes("/app/marketing")) return [context("overview","app/marketing","Overview","סקירה",{section:"overview"}),context("content_calendar","app/marketing","Content Calendar","יומן תוכן",{section:"content_calendar"}),context("creatives","app/marketing","Creatives","קריאייטיב",{section:"creatives"}),context("community","app/marketing","Community","קהילה",{section:"community"}),context("ads","app/marketing","Ads","מודעות",{section:"ads"})];
  if (pathname.includes("/app/payments")) return [context("overview","app/payments","Overview","סקירה",{section:"overview"}),context("awaiting","app/payments","Awaiting","ממתינים",{section:"awaiting"}),context("paid","app/payments","Paid","שולמו",{section:"paid"}),context("credits","app/payments","Credits","יתרות",{section:"credits"}),context("refunds","app/payments","Refunds","החזרים",{section:"refunds"})];
  return [];
}
export function isCaseId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
/** Navigation preserves context; this is not an authorization decision. */
export function selectedCaseId(pathname: string, queryCaseId: string | null): string | null {
  if (isCaseId(queryCaseId)) return queryCaseId;
  const pathCase = pathname.match(/\/app\/cases\/([^/]+)/i)?.[1];
  if (isCaseId(pathCase)) return pathCase;
  return null;
}
export type WorkspaceContext = {mode?: 'live'|'demo';date?:string;view?:'day'|'week'|'month'|'agenda';context?:'client'};
/** Global destinations keep their own toolbar; Payments may still retain a case filter. */
export function isClientWorkspacePath(path:string):boolean {
  return ['app/calendar','app/practice','app/feedback','app/forms','app/resources','app/reports'].includes(path)||path.startsWith('app/cases/')&&isCaseId(path.split('/')[2]);
}
/** Presentation hints only. Every destination still rechecks account/case authorization. */
export function workspaceContext(query:Record<string,unknown>,strict=false):WorkspaceContext {
  const result:WorkspaceContext={};
  for(const key of ['mode','date','view','context'] as const){
    const value=query[key];if(value===undefined||value===null)continue;
    const valid=typeof value==='string'&&(key==='mode'?value==='live'||value==='demo':key==='view'?['day','week','month','agenda'].includes(value):key==='context'?value==='client':/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(value+'T00:00:00Z').getTime())&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value);
    if(!valid){if(strict)throw new Error('INVALID_WORKSPACE_CONTEXT');continue;}
    if(key==='mode')result.mode=value as 'live'|'demo';else if(key==='view')result.view=value as 'day'|'week'|'month'|'agenda';else if(key==='context')result.context='client';else result.date=value as string;
  }
  return result;
}
export function workspaceHref(locale: Locale, path: string, caseId?: string | null, context:WorkspaceContext={}, audienceId?: string | null): string {
  if (!/^(app|family|client)(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) throw new Error("INVALID_WORKSPACE_PATH");
  const query=new URLSearchParams();if(isCaseId(caseId))query.set('caseId',caseId);
  if(path==='app'||path.startsWith('app/'))for(const [key,value] of Object.entries(workspaceContext(context)))if(key!=='context'||isClientWorkspacePath(path))query.set(key,value);
  // The same audience hint belongs on section tabs and their breadcrumbs, not
  // on unrelated global destinations. Actual access is rechecked server-side.
  if (isCaseId(caseId) && isCaseId(audienceId) && ['app/practice','app/reports'].includes(path)) query.set('audienceId',audienceId);
  return `/${locale}/${path}`+(query.size?'?'+query.toString():'');
}
export function caseDestinationHref(locale: Locale, path: string, caseId: string): string {
  if (!isCaseId(caseId)) throw new Error("INVALID_CASE_CONTEXT");
  const url = new URL(workspaceHref(locale, path, caseId), "https://private.invalid");
  url.searchParams.set("context", "client");
  return url.pathname + url.search;
}
export function settingsItems(role: WorkspaceRole): readonly NavItem[] {
  const base = role === "parent" ? "family/settings" : role === "client" ? "client/settings" : "app/settings";
  return [item("account", `${base}/account`, "Account & language", "חשבון ושפה"), item("notifications", `${base}/notifications`, "Notifications", "התראות"), ...(role === "parent" ? [item("coordination", `${base}/coordination`, "Task coordination", "תיאום משימות"), item("credits", `${base}/credits`, "Appointment credits", "יתרת מפגשים")] : role === "practitioner" ? [item("availability", `${base}/availability`, "Availability", "זמינות"), item("templates", `${base}/templates`, "Form templates", "תבניות טפסים"), item("content_voice", `${base}/content-voice`, "Content Voice", "קול התוכן"), item("community", `${base}/community`, "Community Scout", "Community Scout")] : [])];
}
export function activeItem(pathname: string, locale: Locale, role: WorkspaceRole): NavItem | undefined {
  const path = pathname.replace(new RegExp(`^/${locale}/`), "").replace(/\/$/, "");
  if (/^app\/cases\//.test(path) || role === "practitioner" && ['app/practice','app/forms','app/resources'].includes(path)) return primaryNavigation.practitioner.find(x => x.key === "clients");
  if (path === "app/prospects") return primaryNavigation.practitioner.find(x => x.key === "clients");
  return [...primaryNavigation[role], ...navigationGroups[role].flatMap(g => g.items), ...settingsItems(role), ...(role === "practitioner" ? [item("private-notes","app/private-notes","Private case notes","רשימות פרטיות בתיק")] : [])].find(x => x.path === path);
}
export type Crumb = { label: string; path?: string };
export function breadcrumbItems(locale: Locale, role: WorkspaceRole, pathname: string, section?: string | null, view?: string | null, selectedClient=false, caseId?: string | null): Crumb[] {
  const base = role === "parent" ? "family" : role === "client" ? "client" : "app";
  const messagesPath=role==='parent'?'family/feedback':role==='client'?'client/messages':'app/feedback',inMessages=pathname===`/${locale}/${messagesPath}`;
  const home = inMessages?{label:locale==='he'?'יומן':'Calendar',path:role==='parent'?'family/schedule':role==='client'?'client/calendar':'app/calendar'}:{ label: locale === "he" ? "בית" : "Home", path: role === "parent" ? "family" : role === "client" ? "client" : "app/calendar" };
  const settings = `${base}/settings`;
  if (pathname === `/${locale}/${settings}`) return [home, { label: locale === "he" ? "הגדרות" : "Settings" }];
  if (pathname.startsWith(`/${locale}/${settings}/`)) {
    const found = settingsItems(role).find(x => `/${locale}/${x.path}` === pathname);
    return [home, { label: locale === "he" ? "הגדרות" : "Settings", path: settings }, { label: found ? found[locale] : (locale === "he" ? "פרטי ההגדרה" : "Setting details") }];
  }
  if (pathname.includes("/app/cases/")) {
    const id=pathname.match(/\/app\/cases\/([^/]+)/)?.[1];
    if(pathname.endsWith("/settings")&&isCaseId(id))return [home,{label:locale==="he"?"אנשים":"People",path:"app/clients"},{label:locale==="he"?"התיק הנבחר":"Selected case",path:`app/cases/${id}`},{label:locale==="he"?"גישה ומשתתפים":"Access & participants"}];
    if(pathname.includes("/sessions")&&isCaseId(id)){
      const sessions={label:locale==='he'?'מפגשים':'Sessions',...(pathname.endsWith('/sessions')?{}:{path:`app/cases/${id}/sessions`})};
      return [home,{label:locale==="he"?"אנשים":"People",path:"app/clients"},{label:locale==="he"?"התיק הנבחר":"Selected case",path:`app/cases/${id}`},sessions,...(pathname.endsWith('/sessions')?[]:[{label:locale==='he'?'רשומת מפגש':'Session record'}])];
    }
    return [home, { label: locale === "he" ? "אנשים" : "People", path: "app/clients" }, { label: locale === "he" ? "התיק הנבחר" : "Selected case" }];
  }
  if(role==="practitioner"&&pathname.endsWith("/app/practice")){
    const child=practitionerContext(pathname,caseId??null).find(item=>item.key===(section??"practice"));
    return [home,{label:locale==="he"?"אנשים":"People",path:"app/clients"},...(isCaseId(caseId)?[{label:locale==="he"?"התיק הנבחר":"Selected case",path:`app/cases/${caseId}`}]:[]),{label:locale==="he"?"תרגול ביתי":"Home practice",path:"app/practice"},{label:child?.[locale]??(locale==="he"?"הנחיות":"Instructions")}];
  }
  if(role==="practitioner"&&selectedClient&&isCaseId(caseId)){
    const key=pathname.includes("/app/calendar")?"calendar":pathname.includes("/app/practice")?"practice":pathname.includes("/app/feedback")?"communications":pathname.includes("/app/reports")?"reports":pathname.includes("/app/forms")?"forms":pathname.includes('/app/resources')?'resources':"overview";
    const child=practitionerContext(pathname,caseId,true).find(item=>item.key===key);
    return [home,{label:locale==="he"?"אנשים":"People",path:"app/clients"},{label:locale==="he"?"התיק הנבחר":"Selected case",path:`app/cases/${caseId}`},{label:child?.[locale]??(locale==="he"?"סקירה":"Overview")}];
  }
  const found = activeItem(pathname, locale, role);
  if (role === "practitioner" && found) {
    const child = practitionerContext(pathname, null).find(x => x.key === (found.key === "calendar" ? view : found.key==='marketing'&&section==='needs_approval'?'creatives':section));
    if (child) return [home, { label: found[locale], path: found.path }, { label: child[locale] }];
  }
  return found && found.path !== home.path ? [home, { label: found[locale] }] : [{ label: found ? found[locale] : home.label }];
}
