import {notFound} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {requireWorkspaceRole} from "../../../../features/integration/page-session.ts";
import {MarketingDashboard} from "../../../../ui/revamp/marketing-dashboard.tsx";
import {loadMarketingSnapshot} from "../../../../features/marketing-overview/provider.ts";
import type {ContentCalendarQuery} from "../../../../ui/revamp/marketing-content-calendar.tsx";
import type {CreativeQuery} from "../../../../features/marketing-overview/creative-filters.ts";
export const dynamic="force-dynamic";
export const metadata={title:"Life Skills — Marketing",robots:{index:false,follow:false}};
/** No unverified connections or fabricated live data. Codex binds a separately owner-authorized read model here. */
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 try{await requireWorkspaceRole("practitioner");}catch{notFound();}
 const snapshot=await loadMarketingSnapshot();
 const rawQuery=await searchParams;
 const query:ContentCalendarQuery&CreativeQuery&{section?:string|undefined}=Object.fromEntries(["section","filter","month","layout","date","channel","state","from","to","publication","language","placement","approval","search"].map(key=>[key,typeof rawQuery[key]==="string"?rawQuery[key]:undefined]));
 return <MarketingDashboard locale={locale} snapshot={snapshot} initialSection={query.section} initialFilter={query.filter} initialMonth={query.month} calendarQuery={query} creativeQuery={query} renderedAt={new Date().toISOString()}/>;
}
