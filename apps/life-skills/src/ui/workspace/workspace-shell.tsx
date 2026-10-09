"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Locale } from "../../lib/locale.ts";
import { revealWorkspaceTab } from "./tab-visibility.ts";
import {communityView as selectedCommunityView} from '../../features/community-reply/views.ts';
import type {CalendarLayerQuery} from '../../features/calendar/layers.ts';
import { activeItem, breadcrumbItems, isCaseId, isClientWorkspacePath, practitionerContext, primaryNavigation, workspaceContext, workspaceGroups, workspaceHref, type ContextItem, type NavItem, type WorkspaceRole } from "./navigation-model.ts";
import "./professional-ui.css";
const copy = {
  en: { skip: "Skip to content", nav: "Workspace navigation", more: "More", close: "Close navigation", menu: "Open navigation", account: "Account menu", settings: "Settings", practitioner: "Practitioner workspace", parent: "Family workspace", client: "Client workspace", location: "You are here", language: "עברית", privacy: "Access is limited to your authorized workspace." },
  he: { skip: "דילוג לתוכן", nav: "ניווט במרחב", more: "עוד", close: "סגירת התפריט", menu: "פתיחת התפריט", account: "תפריט החשבון", settings: "הגדרות", practitioner: "מרחב המטפל", parent: "מרחב המשפחה", client: "מרחב לקוח/ה", location: "המיקום שלכם", language: "English", privacy: "הגישה מוגבלת למרחב המורשה שלכם." },
} as const;
export type WorkspaceShellProps = { locale: Locale; role: WorkspaceRole; clientRole?:'adult_client'|'child';pathname: string; caseId?: string | null; audienceId?:string|null; selectedClient?: boolean; section?: string | null | undefined; communityView?: string|null|undefined;view?: string | null | undefined; date?: string | null | undefined; mode?: string | null | undefined; calendarLayers?:CalendarLayerQuery;groupInterestEnabled?:boolean;languageHref: string; children: ReactNode; toHref?: (path: string) => string; notice?: ReactNode };
export function WorkspaceShell({ locale, role, clientRole, pathname, caseId, audienceId, selectedClient=false, section, communityView,view, date, mode, calendarLayers={},groupInterestEnabled=false,languageHref, children, toHref, notice }: WorkspaceShellProps) {
  const sharedClientContext=role==='practitioner'&&isCaseId(caseId)&&['/app/forms','/app/resources'].some(path=>pathname.endsWith(path));
  const effectiveSelectedClient=(selectedClient||sharedClientContext)&&isClientWorkspacePath(pathname.slice(locale.length+2));
  const t = copy[locale], active = role === "practitioner" && effectiveSelectedClient && caseId ? primaryNavigation.practitioner.find(item=>item.key==="clients") : activeItem(pathname, locale, role);
  const drawer = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), account = useRef<HTMLDetailsElement>(null);
  const drawerId = useId(), titleId = useId();
  const tabStrip = useRef<HTMLElement>(null);
  const navigationContext=role==='practitioner'?workspaceContext({mode,date,view,context:effectiveSelectedClient&&caseId?'client':undefined}):{};
  const href = (path: string) => toHref ? toHref(path) : workspaceHref(locale, path, caseId,navigationContext,role === 'practitioner' ? audienceId : undefined);
  const close = () => { drawer.current?.close(); trigger.current?.focus(); };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && account.current && !account.current.contains(event.target)) account.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && account.current?.open) { account.current.open = false; account.current.querySelector<HTMLElement>("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const link = (entry: NavItem) => <a className="lsu-nav-link" key={entry.key} href={href(entry.path)} aria-current={active?.key === entry.key ? "page" : undefined}>{entry[locale]}</a>;
  const clientContext = Boolean(caseId && (effectiveSelectedClient || pathname.includes("/app/cases/")));
  const roleGroups=workspaceGroups(role,clientRole),sharedItems=roleGroups.flatMap(group=>group.items),sharedContext=role!=='practitioner'&&sharedItems.some(item=>pathname===`/${locale}/${item.path}`);
  const inCommunity=pathname.endsWith('/app/marketing')&&section==='community';
  const contextItems = role === "practitioner" ? practitionerContext(pathname, caseId ?? null, clientContext,inCommunity,groupInterestEnabled) : sharedContext?sharedItems:primaryNavigation[role];
  const currentContext = inCommunity?selectedCommunityView(communityView):pathname.endsWith("/app/practice") ? (section ?? "practice") : clientContext ? pathname.endsWith("/settings") ? "access" : pathname.includes("/sessions") ? "sessions" : pathname.includes("/app/calendar") ? "calendar" : pathname.includes("/app/feedback") ? "communications" : pathname.includes("/app/reports") ? "reports" : pathname.includes("/app/forms") ? "forms" : pathname.includes('/app/resources')?'resources':"overview" : pathname.includes("/app/calendar") ? (view ?? "week") : pathname.includes("/app/group-interest") ? "groups" : pathname.includes("/app/group-applications") ? "group_applications" : pathname.includes("/app/clients") || pathname.includes("/app/prospects") ? (section ?? "all") : pathname.endsWith('/app/marketing')&&section==='needs_approval'?'creatives':section ?? (pathname.includes("/app/reports") ? "drafts" : pathname.includes("/app/feedback") ? "app_updates" : "overview");
  const contextHref = (entry: ContextItem) => {
    const url = new URL(href(entry.path), "https://private.invalid");
    for (const [key, value] of Object.entries(entry.query ?? {})) url.searchParams.set(key, value);
    if(entry.path==='app/calendar'&&pathname.endsWith('/app/calendar'))for(const [key,value]of Object.entries(calendarLayers))url.searchParams.set(key,value);
    if(['app/reports','app/practice'].includes(entry.path)&&isCaseId(caseId)&&isCaseId(audienceId)){
      url.searchParams.delete('audienceId');url.searchParams.set('audienceId',audienceId);
    }
    // Business receipts have no clinical case context; leave the selected case
    // only on this explicit global tab, never by inferring identity from phone.
    if(entry.key==="whatsapp"&&!clientContext){url.searchParams.delete("caseId");url.searchParams.delete("context");}
    return url.pathname + url.search;
  };
  const tabKeys = contextItems.map(entry => entry.key).join('|');
  useEffect(() => {
    const strip = tabStrip.current;
    if (!strip) return;
    const reveal = () => revealWorkspaceTab(strip, strip.querySelector<HTMLElement>('[aria-current="page"]'));
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    for (const child of strip.children) observer.observe(child);
    return () => observer.disconnect();
  }, [pathname, currentContext, active?.key, locale, tabKeys]);
  const topTabs = <nav ref={tabStrip} className="lsu-top-tabs" onFocus={event => {
    if (event.target instanceof HTMLElement) revealWorkspaceTab(event.currentTarget, event.target.closest('a'));
  }} aria-label={role === "practitioner" ? (locale === "he" ? "תצוגות הדף הנוכחי" : "Current page views") : (locale === "he" ? "חלקי המרחב" : "Workspace sections")}>{contextItems.map(entry => <a key={entry.key} href={role === "practitioner" ? contextHref(entry) : href(entry.path)} aria-current={role === "practitioner" ? (currentContext === entry.key ? "page" : undefined) : (active?.key === entry.key ? "page" : undefined)}>{entry[locale]}</a>)}</nav>;
  const settings = `${role === "parent" ? "family" : role === "client" ? "client" : "app"}/settings`;
  const groups = roleGroups.map(group => <details key={`${group.key}:${active?.key ?? "none"}`} className="lsu-nav-group" open={group.items.some(x => x.key === active?.key)}><summary>{group[locale]}<span aria-hidden="true">⌄</span></summary><div>{group.items.map(link)}</div></details>);
  const crumbs = breadcrumbItems(locale, role, pathname, section, view, effectiveSelectedClient, caseId,communityView);
  const crumbHref=(path:string,query?:Readonly<Record<string,string>>)=>{const url=new URL(href(path),'https://private.invalid');for(const [key,value] of Object.entries(query??{}))url.searchParams.set(key,value);return url.pathname+url.search;};
  return <div className={`lsw lsu lsu--${role}`} lang={locale} dir={locale === "he" ? "rtl" : "ltr"}>
    <a className="lsu-skip" href="#lsw-main">{t.skip}</a>
    <header className="lsu-header">
      <a className="lsu-brand" href={href(role === "parent" ? "family" : role === "client" ? "client" : "app/calendar")} aria-label="Life Skills">
        {/* Exact approved bitmap; no image reconstruction, recoloring or remote source. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/intake-brand/life-skills-logo.png" alt={locale === "he" ? "כישורי חיים" : "Life Skills"} width={124} height={65}/>
        <span><strong translate="no" dir="ltr">Life Skills</strong><small>{t[role]}</small></span>
      </a>
      {contextItems.length>0&&topTabs}
      <div className="lsu-header-controls">
        <a className="lsu-icon-control lsu-language" href={languageHref} lang={locale === "he" ? "en" : "he"} aria-label={locale === "he" ? "Switch to English" : "מעבר לעברית"}>{t.language}</a>
        <details ref={account} className="lsu-account"><summary aria-label={t.account} className="lsu-icon-control"><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2"/></svg></summary><nav className="lsu-account-panel" aria-label={t.account}><a href={href(settings)}>{t.settings}</a>{(role==="parent"||role==="practitioner")&&<a href={`/${locale}/sample`}>{locale==="he"?"נתוני דוגמה":"Sample data"}</a>}</nav></details>
        <button ref={trigger} type="button" className="lsu-icon-control lsu-menu" aria-label={t.menu} aria-controls={drawerId} aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}><svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      </div>
    </header>
    {notice && <div className="lsu-preview-notice">{notice}</div>}
    <div className="lsu-layout">
      <aside className="lsu-sidebar"><nav aria-label={t.nav}><p className="lsu-nav-heading">{t[role]}</p>{primaryNavigation[role].map(link)}{groups}</nav><p className="lsu-sidebar-note">{t.privacy}</p></aside>
      <div className="lsu-content">
        <nav className="lsu-breadcrumbs" aria-label={t.location}><ol>{crumbs.map((crumb, i) => <li key={`${i}-${crumb.label}`}>{crumb.path ? <a href={crumbHref(crumb.path,crumb.query)}>{crumb.label}</a> : <span aria-current="page">{crumb.label}</span>}</li>)}</ol></nav>
        <div id="lsw-main" className="lsu-page" tabIndex={-1}>{children}</div>
      </div>
    </div>
    <dialog ref={drawer} id={drawerId} className="lsu-drawer" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="lsu-drawer-inner"><header><h2 id={titleId}>{t.nav}</h2><button type="button" className="lsu-icon-control" aria-label={t.close} onClick={close}>×</button></header><nav aria-label={t.nav}>{primaryNavigation[role].map(link)}{groups}</nav></div>
    </dialog>
  </div>;
}
