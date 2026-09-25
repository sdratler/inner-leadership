"use client";
import {useEffect,useRef,useState} from "react";
import {accountRead} from "../identity/client.ts";
import {ProspectsClient,type Preset} from "../prospects/client.tsx";
import type {Locale} from "../../lib/locale.ts";

type Case={id:string;kind:"minor"|"adult";state:string;displayName:string};
type Section="all"|"prospects"|"paid"|"active"|"archived";
const sections=new Set<Section>(["all","prospects","paid","active","archived"]);
const filters=new Set<Preset>(["all","today","new","intake","payment","booking","archived"]);
const copy={
 en:{title:"People",lead:"Client cases and intake follow-ups in one directory."},
 he:{title:"אנשים",lead:"תיקי לקוחות והמשך טיפול בפניות ברשימה אחת."}
} as const;
const closed=(state:string)=>/closed|archived|revoked/i.test(state);

/** The CRM is read from its existing authenticated endpoint; this view never imports or duplicates leads. */
export function ClientsRoster({locale,section:rawSection,prospectFilter}:{locale:Locale;section?:string|undefined;prospectFilter?:string|undefined}){
 const section:Section=rawSection&&sections.has(rawSection as Section)?rawSection as Section:"all";
 const t=copy[locale],showCases=section==="all"||section==="active"||section==="archived",showProspects=section==="all"||section==="prospects"||section==="paid"||section==="archived";
 const [rows,setRows]=useState<Case[]>([]),[state,setState]=useState<"loading"|"ready"|"error">("loading"),active=useRef(true),request=useRef(0);
 const load=()=>{const current=++request.current;setState("loading");void accountRead<Case[]>("cases").then(value=>{if(active.current&&current===request.current){setRows(value);setState("ready")}}).catch(()=>{if(active.current&&current===request.current)setState("error")})};
 useEffect(()=>{active.current=true;if(showCases)queueMicrotask(load);return()=>{active.current=false}},[showCases]);
 const filtered=rows.filter(row=>section==="all"||(section==="archived"?closed(row.state):!closed(row.state)));
 const preset:Preset=section==="paid"?"booking":section==="archived"?"archived":prospectFilter&&filters.has(prospectFilter as Preset)?prospectFilter as Preset:"all";
 return <main className="lsw-main lsu-clients-directory" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{locale==="he"?"מרחב פרטי":"Private workspace"}</p><h1>{t.title}</h1><p>{t.lead}</p></div></header>
  <ProspectsClient key={`${section}:${preset}`} locale={locale} initialFilter={preset} embedded
   clientCases={showCases&&state==="ready"?filtered:[]} caseState={showCases?state:null} onRetryCases={load} showProspects={showProspects}/>
 </main>;
}
