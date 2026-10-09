import {notFound} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {MarketingDashboard} from "../../../../ui/revamp/marketing-dashboard.tsx";
import {loadMarketingSnapshot} from "../../../../features/marketing-overview/provider.ts";
import type {ContentCalendarQuery} from "../../../../ui/revamp/marketing-content-calendar.tsx";
import type {CreativeQuery} from "../../../../features/marketing-overview/creative-filters.ts";
import {headers} from "next/headers";
import {ownerDigestContext,loadOwnerDigest} from "../../../../features/owner-digest/runtime.ts";
import {normalizeMarketingSection} from "../../../../features/marketing-overview/contracts.ts";
import {AppError} from "../../../../lib/errors.ts";
import {communityView} from '../../../../features/community-reply/views.ts';
import {CommunitySection} from '../../../../features/community-reply/section.tsx';
import {readContentVoiceSource} from '../../../../features/content-voice/source.ts';
import {loadFacebookPagePublicationState} from '../../../../features/marketing-overview/page-publication-provider.ts';
export const dynamic="force-dynamic";
export const metadata={title:"Life Skills — Marketing",robots:{index:false,follow:false}};
/** No unverified connections or fabricated live data. Codex binds a separately owner-authorized read model here. */
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 let context:Awaited<ReturnType<typeof ownerDigestContext>>;
 try{context=await ownerDigestContext((await headers()).get("cookie"));}
 catch(error){if(error instanceof AppError&&["UNAUTHENTICATED","FORBIDDEN","NOT_FOUND"].includes(error.code))notFound();throw error;}
 const rawQuery=await searchParams;
 const section=normalizeMarketingSection(typeof rawQuery.section==='string'?rawQuery.section:undefined);
 if(section==='community'){
  const view=communityView(rawQuery.communityView);
  const source=view==='writing_rules'?await readContentVoiceSource().catch(()=>null):null;
  return <CommunitySection locale={locale} view={view} source={source}/>;
 }
 const query:ContentCalendarQuery&CreativeQuery&{section?:string|undefined}=Object.fromEntries(["section","filter","month","layout","date","channel","state","from","to","publication","language","placement","approval","search","page","collection","concept","cycle"].map(key=>[key,typeof rawQuery[key]==="string"?rawQuery[key]:undefined]));
  query.section=section;
  const [snapshot,facebookPage]=await Promise.all([loadMarketingSnapshot(),section==="content_calendar"?loadFacebookPagePublicationState():Promise.resolve(undefined)]);
  const digest=query.section==="overview"?await (async()=>{
   try{return await loadOwnerDigest(context.actor,context.runtime,snapshot,locale);}
   catch(error){if(error instanceof AppError&&error.code==="FORBIDDEN")notFound();throw error;}
  })():undefined;
  return <MarketingDashboard locale={locale} snapshot={snapshot} ownerDigest={digest} facebookPage={facebookPage} initialSection={query.section} initialFilter={query.filter} initialMonth={query.month} calendarQuery={query} creativeQuery={query} renderedAt={new Date().toISOString()}/>;
}
