"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {accountRead} from "../identity/client.ts";
import {ProspectsClient,type Preset} from "../prospects/client.tsx";
import type {Locale} from "../../lib/locale.ts";

type Case={id:string;kind:"minor"|"adult";state:string;displayName:string};
type Section="all"|"prospects"|"paid"|"active"|"archived";
const sections=new Set<Section>(["all","prospects","paid","active","archived"]);
const filters=new Set<Preset>(["all","today","new","intake","payment","booking","archived"]);
const copy={
 en:{title:"Clients",lead:"Authorized client cases and the existing intake CRM in one directory.",search:"Search clients",empty:"No authorized cases match this view.",loading:"Loading authorized cases…",error:"Could not load the client cases. The CRM below can still be checked.",retry:"Try again",cases:"Client cases"},
 he:{title:"לקוחות",lead:"תיקי לקוחות מורשים ומתעניינים מה-CRM הקיים בספרייה אחת.",search:"חיפוש לקוחות",empty:"אין תיקים מורשים שמתאימים לתצוגה.",loading:"טוען תיקים מורשים…",error:"לא ניתן לטעון את תיקי הלקוחות. אפשר עדיין לבדוק את ה-CRM למטה.",retry:"ניסיון נוסף",cases:"תיקי לקוחות"}
} as const;
const closed=(state:string)=>/closed|archived|revoked/i.test(state);

/** The CRM is read from its existing authenticated endpoint; this view never imports or duplicates leads. */
export function ClientsRoster({locale,section:rawSection,prospectFilter}:{locale:Locale;section?:string|undefined;prospectFilter?:string|undefined}){
 const section:Section=rawSection&&sections.has(rawSection as Section)?rawSection as Section:"all";
 const t=copy[locale],showCases=section==="all"||section==="active"||section==="archived",showProspects=section==="all"||section==="prospects"||section==="paid"||section==="archived";
 const [rows,setRows]=useState<Case[]>([]),[query,setQuery]=useState(""),[state,setState]=useState<"loading"|"ready"|"error">("loading"),active=useRef(true),request=useRef(0);
 const load=()=>{const current=++request.current;setState("loading");void accountRead<Case[]>("cases").then(value=>{if(active.current&&current===request.current){setRows(value);setState("ready")}}).catch(()=>{if(active.current&&current===request.current)setState("error")})};
 useEffect(()=>{active.current=true;if(showCases)queueMicrotask(load);return()=>{active.current=false}},[showCases]);
 const filtered=useMemo(()=>rows.filter(row=>row.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase())&&(section==="all"||(section==="archived"?closed(row.state):!closed(row.state)))),[rows,query,section]);
 const preset:Preset=section==="paid"?"booking":section==="archived"?"archived":prospectFilter&&filters.has(prospectFilter as Preset)?prospectFilter as Preset:"all";
 return <main className="lsw-main lsu-clients-directory" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{locale==="he"?"מרחב פרטי":"Private workspace"}</p><h1>{t.title}</h1><p>{t.lead}</p></div></header>
  {showCases&&<section className="lsw-case-group" aria-label={t.cases}><h2>{t.cases}</h2>{state==="loading"&&<p role="status">{t.loading}</p>}{state==="error"&&<div className="lsw-alert" role="alert"><p>{t.error}</p><button className="lsw-button lsw-button--secondary" type="button" onClick={load}>{t.retry}</button></div>}{state==="ready"&&<><label className="lsw-field" htmlFor="client-search">{t.search}<input id="client-search" className="lsw-input" type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className="lsw-card-list">{filtered.length?filtered.map(row=><a className="lsw-card" key={row.id} href={`/${locale}/app/cases/${encodeURIComponent(row.id)}`}><h3>{row.displayName}</h3><p>{row.kind==="minor"?(locale==="he"?"ילד/ה":"Child"):(locale==="he"?"מבוגר/ת":"Adult client")} · {row.state}</p></a>):<p role="status">{t.empty}</p>}</div></>}</section>}
  {showProspects&&<ProspectsClient key={`${section}:${preset}`} locale={locale} initialFilter={preset} embedded/>}
 </main>;
}
