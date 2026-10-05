import type { Locale } from "../../lib/locale.ts";
import {isCaseId,settingsItems,workspaceContext} from '../../ui/workspace/navigation-model.ts';
import {isReportSection} from '../progress/report-views.ts';
import {contentChannel,contentDate,contentState} from '../marketing-overview/calendar-model.ts';
import {creativeApprovals,creativePlacements} from '../marketing-overview/creative-filters.ts';

type Role = "practitioner" | "parent" | "adult_client" | "child";

/** A login return is a same-locale, same-role app path, never an arbitrary URL. */
export function loginReturnDestination(locale: Locale, role: Role, requested: string | null): string | null {
  const root = role === "practitioner" ? `/${locale}/app`
    : role === "parent" ? `/${locale}/family`
    : role === "adult_client" || role === "child" ? `/${locale}/client` : null;
  if (!root) return null;
  const defaultPath = role === "practitioner" ? `${root}/calendar` : role === "parent" ? `${root}/schedule` : root;
  if (!requested || requested.length > 2048 || !requested.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(requested)) return defaultPath;
  try {
    const url = new URL(requested, "https://life-skills.invalid");
    if (url.origin !== "https://life-skills.invalid" || url.hash || (url.pathname !== root && !url.pathname.startsWith(`${root}/`))) return defaultPath;
    return url.pathname + url.search;
  } catch { return defaultPath; }
}

export function practitionerReturnPath(locale: Locale, page: "calendar" | "clients" | "practice", query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  const one = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  if (page === "calendar") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(one("date"))) params.set("date", one("date"));
    if (["day", "week", "month", "agenda"].includes(one("view"))) params.set("view", one("view"));
    if (/^[0-9a-f-]{36}$/i.test(one("caseId"))) params.set("caseId", one("caseId"));
    if (one("context") === "client") params.set("context", "client");
    if (one("mode") === "demo") params.set("mode", "demo");
    if (isCaseId(one("taskId"))) params.set("taskId", one("taskId"));
  } else if (page === "practice") {
    for (const key of ["caseId", "audienceId", "assignmentId"]) if (isCaseId(one(key))) params.set(key, one(key));
    if (["goals", "commitments", "checkins"].includes(one("section"))) params.set("section", one("section"));
  } else {
    if (["all", "prospects", "needs_review", "paid", "active", "archived"].includes(one("section"))) params.set("section", one("section"));
    if (["all", "today", "new", "intake", "payment", "booking", "archived"].includes(one("filter"))) params.set("filter", one("filter"));
    if (/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/.test(one("leadId"))) params.set("leadId", one("leadId"));
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(one("personId"))) params.set("personId",one("personId"));
    if(one("mode")==="demo")params.set("mode","demo");
    if(/^[1-9]\d{0,4}$/.test(one("page")))params.set("page",one("page"));
    for(const [key,max] of [["search",200],["stage",120]] as const){const value=one(key);if(value&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value))params.set(key,value);}
    if(["he","en"].includes(one("language")))params.set("language",one("language"));
    if(["today","overdue"].includes(one("due")))params.set("due",one("due"));
  }
  const suffix = params.toString();
  return `/${locale}/app/${page}${suffix ? `?${suffix}` : ""}`;
}

/** Named practitioner deep links only; no arbitrary caller/header path is trusted. */
export function practitionerDetailReturnPath(locale:Locale,pathname:string,query:Record<string,string|string[]|undefined>):string {
 if(pathname===`/${locale}/app/marketing`){
  const params=new URLSearchParams(),one=(key:string)=>typeof query[key]==='string'?query[key] as string:'';
  if(['overview','content_calendar','creatives','needs_approval','community','ads'].includes(one('section')))params.set('section',one('section'));
  if(one('section')==='community'&&isCaseId(one('threadId')))params.set('threadId',one('threadId'));
  if(['all','queued','drafts','published','history','he_status','he_feed','en_feed','ad_eligible','in_live_ads'].includes(one('filter')))params.set('filter',one('filter'));
  if(/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(one('month')))params.set('month',one('month'));
  if(['month','week','agenda'].includes(one('layout')))params.set('layout',one('layout'));
  for(const key of ['date','from','to'])if(contentDate(one(key)))params.set(key,one(key));
  if(contentChannel(one('channel')))params.set('channel',one('channel'));
  if(contentState(one('state')))params.set('state',one('state'));
  if(/^[A-Za-z0-9_-]{1,160}$/.test(one('publication')))params.set('publication',one('publication'));
  if(['all','he','en'].includes(one('language')))params.set('language',one('language'));
  if(creativePlacements.some(value=>value===one('placement')))params.set('placement',one('placement'));
  if(creativeApprovals.some(value=>value===one('approval')))params.set('approval',one('approval'));
  if(one('search')&&one('search').length<=200&&!/[\u0000-\u001f\u007f]/.test(one('search')))params.set('search',one('search'));
  if(['creatives','needs_approval'].includes(one('section'))&&/^[1-9]\d{0,3}$/.test(one('page')))params.set('page',one('page'));
  return pathname+(params.size?'?'+params:'');
 }
 // Account destinations are global, not case-scoped. Preserve only the exact
 // maintained Settings routes; never forward caller-supplied role or query text.
 if(pathname===`/${locale}/app/settings`||settingsItems('practitioner').some(item=>pathname===`/${locale}/${item.path}`))return pathname;
  const reports=pathname===`/${locale}/app/reports`,communications=pathname===`/${locale}/app/feedback`,sharedItems=[`/${locale}/app/forms`,`/${locale}/app/resources`].includes(pathname),session=pathname.match(new RegExp(`^/${locale}/app/cases/([^/]+)/sessions(?:/([^/]+))?$`));
  if(!reports&&!communications&&!sharedItems&&(!session||!isCaseId(session[1])||session[2]!==undefined&&!isCaseId(session[2])))return `/${locale}/app/calendar`;
 const params=new URLSearchParams(workspaceContext(query) as Record<string,string>);
 const one=(key:string)=>typeof query[key]==='string'?query[key] as string:'';
  if(reports){for(const key of ['caseId','audienceId'])if(isCaseId(one(key)))params.set(key,one(key).toLowerCase());if(one('context')==='client')params.set('context','client');if(isReportSection(one('section')))params.set('section',one('section'));}
  else if(communications){if(isCaseId(one('caseId')))params.set('caseId',one('caseId').toLowerCase());if(['app_updates','whatsapp'].includes(one('section')))params.set('section',one('section'));}
 else if(sharedItems){if(isCaseId(one('caseId')))params.set('caseId',one('caseId').toLowerCase());}
 else if(!session?.[2]&&isCaseId(one('appointmentId')))params.set('appointmentId',one('appointmentId').toLowerCase());
 return pathname+(params.size?'?'+params.toString():'');
}

/** Preserve known parent destinations without forwarding arbitrary query text into login. */
export function parentReturnPath(locale: Locale, pathname: string, query: Record<string, string | undefined>): string {
  const root = `/${locale}/family`;
  const suffix = pathname.startsWith(`${root}/`) ? pathname.slice(root.length) : pathname === root ? "" : null;
  const allowed = new Set(["", "/schedule", "/practice", "/feedback", "/forms", "/resources", "/reports", "/settings", "/settings/account", "/settings/coordination", "/settings/credits", "/settings/notifications"]);
  if (suffix === null || !allowed.has(suffix)) return `${root}/schedule`;
  const params = new URLSearchParams();
  const uuid = (key: string) => { if (/^[0-9a-f-]{36}$/i.test(query[key] ?? "")) params.set(key, query[key]!); };
  if (["", "/schedule", "/practice", "/feedback", "/forms", "/resources", "/reports"].includes(suffix)) uuid("caseId");
  if (suffix === "/schedule") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "")) params.set("date", query.date!);
    if (["day", "week", "month", "agenda"].includes(query.view ?? "")) params.set("view", query.view!);
  }
  if (["/practice", "/feedback", "/reports"].includes(suffix)) uuid("audienceId");
  if (suffix === "/practice") uuid("assignmentId");
  if (suffix === "/practice" && query.section === "checkins") params.set("section", "checkins");
  if (suffix === "/feedback") uuid("practiceVersionId");
  const search = params.toString();
  return root + suffix + (search ? `?${search}` : "");
}

export function loginHref(locale: Locale, returnPath: string): string {
  return `/${locale}/login?next=${encodeURIComponent(returnPath)}`;
}

/** Named child/adult destinations; request headers never supply an arbitrary URL. */
export function clientReturnPath(locale: Locale, pathname: string, query: Record<string, string | undefined>): string {
  const root = `/${locale}/client`;
  const suffix = pathname.startsWith(`${root}/`) ? pathname.slice(root.length) : pathname === root ? "" : null;
  const allowed = new Set(["", "/calendar", "/practice", "/messages", "/forms", "/resources", "/reports", "/settings", "/settings/account", "/settings/notifications"]);
  if (suffix === null || !allowed.has(suffix)) return root;
  const params = new URLSearchParams();
  if (["", "/calendar", "/practice", "/messages", "/forms", "/resources", "/reports"].includes(suffix) && isCaseId(query.caseId)) params.set("caseId", query.caseId!);
  if (suffix === "/reports" && isCaseId(query.audienceId)) params.set("audienceId", query.audienceId!);
  if (suffix === "/calendar") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "")) params.set("date", query.date!);
    if (["day", "week", "month", "agenda"].includes(query.view ?? "")) params.set("view", query.view!);
  }
  if (suffix === "/practice") {
    for (const key of ["audienceId", "assignmentId"]) if (isCaseId(query[key])) params.set(key, query[key]!);
    if (query.section === "checkins") params.set("section", "checkins");
  }
  return root + suffix + (params.size ? "?" + params.toString() : "");
}
