"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {BnaInquiryOwnerPanel} from "../bna-inquiry/owner-panel.tsx";
import {Owner305ConversationPanel} from "../conversation-305/owner-panel.tsx";
import {FishingFollowupPanel} from "../group-application/fishing-followup-panel.tsx";
import {loadLeadSource,LeadReadError,type LeadSource,type LeadSourcePage} from "./lead-loader.ts";
import {needsFollowup,type LeadPurpose,type LeadViewRow} from "./lead-view.ts";

type SourceState={page:LeadSourcePage|null;error:boolean;loading:boolean};
type Filter="followup"|"all"|LeadPurpose;
const names:LeadSource[]=["bna","fishing","conversation_305"];
const blank=():Record<LeadSource,SourceState>=>({bna:{page:null,error:false,loading:false},fishing:{page:null,error:false,loading:false},conversation_305:{page:null,error:false,loading:false}});
export function LeadWorkspace({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [sources,setSources]=useState(blank),[filter,setFilter]=useState<Filter>("followup"),[selected,setSelected]=useState<LeadViewRow|"new305"|null>(null);
 const [account,setAccount]=useState<string|null>(null),[accessError,setAccessError]=useState(false),[pending,setPending]=useState(false);
 const active=useRef(false),epoch=useRef(0),pendingRef=useRef(false),sourceEpoch=useRef<Record<LeadSource,number>>({bna:0,fishing:0,conversation_305:0});
 const load=useCallback(async(source:LeadSource,owner:string,cursor:string|null=null)=>{
  const current=epoch.current,request=++sourceEpoch.current[source];
  setSources(old=>({...old,[source]:{...old[source],loading:true,error:false}}));
  try{const page=await loadLeadSource(source,owner,cursor);if(!active.current||current!==epoch.current||request!==sourceEpoch.current[source])return;
   setSources(old=>{const prior=old[source].page;if(cursor&&prior?.nextCursor!==cursor)return {...old,[source]:{...old[source],loading:false}};
    const rows=cursor&&prior?[...new Map([...prior.rows,...page.rows].map(row=>[row.key,row])).values()]:page.rows;
    return {...old,[source]:{page:{...page,rows},error:false,loading:false}};});
  }catch(error){if(!active.current||current!==epoch.current||request!==sourceEpoch.current[source])return;
   if(error instanceof LeadReadError&&(error.status===401||error.status===403)){epoch.current++;setSources(blank());setSelected(null);setAccount(null);setAccessError(true);return;}
   if(error instanceof LeadReadError&&error.status===404)setSelected(null);
   setSources(old=>({...old,[source]:{page:error instanceof LeadReadError&&error.status===404?null:old[source].page,error:true,loading:false}}));}
 },[]);
 const pendingChanged=useCallback((value:boolean)=>{const completed=pendingRef.current&&!value;pendingRef.current=value;setPending(value);
  if(completed&&account)for(const name of names)void load(name,account);
 },[account,load]);
 useEffect(()=>{let cancelled=false;const generation=epoch;active.current=true;const current=++generation.current;
  const timer=window.setTimeout(()=>{void sessionInfo().then(session=>{if(cancelled||!active.current||epoch.current!==current)return;
   if(session.role!=="practitioner"){setAccessError(true);return;}setAccount(session.accountId);for(const name of names)void load(name,session.accountId);
  }).catch(()=>{if(!cancelled&&active.current&&epoch.current===current)setAccessError(true);});},0);
  return()=>{cancelled=true;window.clearTimeout(timer);active.current=false;generation.current++;};
 },[load]);
 const rows=names.flatMap(name=>sources[name].page?.rows??[]).filter(row=>filter==="all"||filter==="followup"&&needsFollowup(row)||filter!=="followup"&&row.purposes.includes(filter)).sort((a,b)=>b.latestActivity.localeCompare(a.latestActivity));
 const label=(source:LeadSource)=>source==="bna"?"BNA":source==="fishing"?"Fishing":"305";
 return <main className="lsw-main" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <h1>{t("People","אנשים")}</h1><p>{t("Inquiries and conversations that need your attention.","פניות ושיחות שדורשות את תשומת לבך.")}</p>
  <a href={`/${locale}/app/clients?view=legacy`}>{t("Open existing contact workspace","פתיחת סביבת אנשי הקשר הקיימת")}</a>
  {accessError?<p role="alert">{t("Access could not be verified. Sign in again or contact the administrator.","לא ניתן לאמת את הגישה. יש להיכנס מחדש או לפנות למנהל.")}</p>:<>
   <label>{t("View","תצוגה")} <select value={filter} onChange={event=>setFilter(event.target.value as Filter)}>
    <option value="followup">{t("Needs follow-up","דורשים מעקב")}</option><option value="all">{t("All loaded","כל הרשומות שנטענו")}</option>
    <option value="bna">BNA</option><option value="fishing">{t("Fishing","דיג")}</option><option value="support">{t("Support","תמיכה")}</option>
    <option value="provider">{t("Providers","ספקים")}</option><option value="unclassified">{t("Unclassified","טרם סווג")}</option></select></label>
   <p>{t(`${rows.length} loaded records shown. Load older records for a fuller view.`,`${rows.length} רשומות שנטענו מוצגות. אפשר לטעון רשומות קודמות לתצוגה רחבה יותר.`)}</p>
   <div className="lsw-stack">{names.map(source=><div key={source}>{label(source)}: {sources[source].loading?t("Loading…","טוען…"):sources[source].error?t("Could not load","לא ניתן לטעון"):sources[source].page?t(`${sources[source].page!.rows.length} loaded`,`${sources[source].page!.rows.length} נטענו`):t("Not loaded","לא נטען")}
    {sources[source].error&&account&&<button type="button" disabled={pending} onClick={()=>void load(source,account)}>{t("Retry","ניסיון חוזר")}</button>}
    {sources[source].page?.nextCursor&&account&&<button type="button" disabled={pending||sources[source].loading} onClick={()=>void load(source,account,sources[source].page!.nextCursor!)}>{t("Load older","טעינת קודמים")}</button>}</div>)}</div>
   <button type="button" disabled={pending} onClick={()=>setSelected("new305")}>{t("Add a 305 conversation","הוספת שיחת 305")}</button>
   {account&&<button type="button" disabled={pending} onClick={()=>{for(const name of names)void load(name,account);}}>{t("Refresh loaded records","רענון הרשומות שנטענו")}</button>}
   <ul>{rows.map(row=><li key={row.key}><button type="button" disabled={pending} onClick={()=>setSelected(row)}>{row.label} · {row.purposes.join(" / ")} · {row.status}</button>
    <span> · {row.source} · <time dateTime={row.latestActivity}>{row.latestActivity}</time> · {row.nextAction??row.waitingCondition??t("No next action recorded","לא תועדה פעולה הבאה")}{row.dueDate&&<> · {row.dueDate}</>}</span></li>)}</ul>
   {selected&&<section aria-label={t("Selected record","הרשומה שנבחרה")}>
    {selected==="new305"?<Owner305ConversationPanel key="new305" locale={locale} onOperationPending={pendingChanged}/>:
     selected.kind==="bna_inquiry"?<BnaInquiryOwnerPanel key={selected.key} locale={locale} initialId={selected.recordId} onOperationPending={pendingChanged}/>:
     selected.kind==="conversation_305"?<Owner305ConversationPanel key={selected.key} locale={locale} initialId={selected.recordId} onOperationPending={pendingChanged}/>:
     <div className="lsw-card"><h2>{selected.label}</h2><FishingFollowupPanel key={selected.key} locale={locale} applicationId={selected.recordId} autoOpen onOperationPending={pendingChanged}/></div>}
   </section>}
  </>}
 </main>;
}
