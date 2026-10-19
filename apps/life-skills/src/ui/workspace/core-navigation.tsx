"use client";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "../../lib/locale.ts";
import { selectedCaseId,workspaceHref,workspaceContext, type WorkspaceRole } from "./navigation-model.ts";
import { WorkspaceShell } from "./workspace-shell.tsx";
import {calendarLayerQuery} from '../../features/calendar/layers.ts';
import {fishingFamilyContext,fishingFamilyHref} from '../../features/fishing/family-home-contract.ts';
export { selectedCaseId, workspaceHref } from "./navigation-model.ts";
export function CoreNavigation({ locale, role, clientRole, groupInterestEnabled=false, children }: { locale: Locale; role: WorkspaceRole; clientRole?:'adult_client'|'child';groupInterestEnabled?:boolean;children: ReactNode }) {
  const pathname = usePathname(), query = useSearchParams(), caseId = selectedCaseId(pathname, query.get("caseId"));
  const other = locale === "he" ? "en" : "he";
  const languageHref = pathname.replace(/^\/(he|en)(?=\/|$)/, `/${other}`) + (query.size ? `?${query.toString()}` : "");
  const academyQuery=new URLSearchParams(query.toString());
  if(role==='parent'&&pathname.endsWith('/family/schedule')&&academyQuery.has('stageId')&&academyQuery.has('enrollmentId'))academyQuery.set('fishing','1');
  const academy=role==='parent'&&fishingFamilyContext(academyQuery);
  const academyHref=academy?(path:string)=>['family','family/schedule'].includes(path)?fishingFamilyHref(locale,path as 'family'|'family/schedule',academy):'/'+locale+'/'+path:undefined;
  const fishingKeys=['learnerId','enrollmentId','cohortId','stageId','stage'] as const;
  const operatorAcademy=role==='practitioner'&&pathname.endsWith('/app/calendar')&&(query.has('fishing')||fishingKeys.some(key=>query.has(key)));
  const operatorHref=operatorAcademy?(path:string)=>{
    const url=new URL(workspaceHref(locale,path,caseId,workspaceContext({mode:query.get('mode'),date:query.get('date'),view:query.get('view')})),'https://private.invalid');
    if(path==='app/calendar'){
      url.searchParams.delete('caseId');
      // Preserve the exact hint, including invalid/repeated values, so native
      // readers still deny it. Only Calendar destinations receive these hints.
      if(query.has('fishing'))for(const value of query.getAll('fishing'))url.searchParams.append('fishing',value);else url.searchParams.set('fishing','1');
      for(const key of fishingKeys)for(const value of query.getAll(key))url.searchParams.append(key,value);
    }
    return url.pathname+url.search;
  }:undefined;
  const toHref=academyHref??operatorHref;
  return <WorkspaceShell locale={locale} role={role} {...(clientRole?{clientRole}:{})} {...(toHref?{toHref,academyContext:Boolean(academyHref)}:{})} pathname={pathname} caseId={caseId} audienceId={query.get('audienceId')} selectedClient={query.get("context")==="client"} section={query.get("section")} communityView={query.get('communityView')} view={query.get("view")} date={query.get("date")} mode={query.get("mode")} calendarLayers={operatorAcademy?{}:calendarLayerQuery(query)} groupInterestEnabled={groupInterestEnabled} languageHref={languageHref}>{children}</WorkspaceShell>;
}
export function PrivateWorkspaceUnavailable({ locale }: { locale: Locale; role: WorkspaceRole }) {
  const he = locale === "he";
  return <div className="lsw" lang={locale} dir={he ? "rtl" : "ltr"}><main className="lsw-main"><section className="lsw-card" role="status"><h1>{he ? "יש להתחבר למרחב הפרטי" : "Sign in to the private app"}</h1><p>{he ? "הגישה נפתחת רק לאחר כניסה לחשבון מורשה." : "Access opens only after signing in with an authorized account."}</p><a className="lsw-button lsw-button--secondary" href={`/${locale}/login`}>{he ? "מעבר לכניסה" : "Go to sign in"}</a></section></main></div>;
}
