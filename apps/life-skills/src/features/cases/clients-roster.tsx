"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {accountRead,IdentityClientError} from "../identity/client.ts";
import {practitionerReturnPath} from "../identity/login-return.ts";
import {ProspectsClient,type Preset} from "../prospects/client.tsx";
import type {Locale} from "../../lib/locale.ts";
import {NativePeopleWorkspace,requestPeople,PeopleRequestError} from "../contact-ops/native-people-workspace.tsx";
import type {PeopleResponse} from "../contact-ops/server/people-http.ts";
import {loginHref} from "../identity/login-return.ts";

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
type RosterProps={locale:Locale;section?:string|undefined;prospectFilter?:string|undefined;focusLeadId?:string|undefined};
/** Choose the real durable authority before rendering one directory. A frozen
 * transition or failed native read cannot initialize the legacy bridge UI. */
export function ClientsRoster(props:RosterProps){
 const {locale}=props,section=props.section&&sections.has(props.section as Section)?props.section as Section:"all";
 const [source,setSource]=useState<PeopleResponse|null>(null),[failure,setFailure]=useState<number|null>(null),lifecycle=useRef({alive:true,serial:0});
 const load=useCallback(()=>{const state=lifecycle.current,n=++state.serial;setSource(null);setFailure(null);void requestPeople(new URLSearchParams({view:section})).then(r=>{if(state.alive&&n===state.serial)setSource(r);}).catch(e=>{if(state.alive&&n===state.serial)setFailure(e instanceof PeopleRequestError?e.status:503);});},[section]);
 useEffect(()=>{const state=lifecycle.current;state.alive=true;queueMicrotask(()=>{if(state.alive)load();});return()=>{state.alive=false;state.serial++;};},[load]);
 if(source?.source==="sheet")return <LegacyClientsRoster {...props}/>;
 const text=(en:string,he:string)=>locale==="he"?he:en;
 return <main className="lsw-main lsu-clients-directory" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{text("Private workspace","מרחב פרטי")}</p><h1>{copy[locale].title}</h1><p>{copy[locale].lead}</p></div></header>
  {source?.source==="native"?<NativePeopleWorkspace key={section} locale={locale} view={section} initial={source} onSheet={setSource}/>:
   failure===null?<p role="status">{text("Loading authorized people…","טוען אנשים מורשים…")}</p>:<div className="lsw-alert" role="alert"><p>{failure===401?text("Your session ended. Sign in to continue.","פג תוקף החיבור. יש להיכנס מחדש."):failure===403?text("This account cannot access the practitioner directory.","לחשבון הזה אין גישה לרשימת המטפל/ת."):failure===409?text("Contact records are being reconciled. No fallback or changes were used.","רשומות אנשי הקשר נמצאות בהתאמה. לא הוצגו נתונים חלופיים ולא בוצעו שינויים."):text("People could not be loaded. This is not an empty directory.","לא ניתן לטעון את האנשים. אין להסיק שהרשימה ריקה.")}</p>{failure===401?<a className="lsw-button lsw-button--secondary" href={loginHref(locale,practitionerReturnPath(locale,"clients",props))}>{text("Sign in","כניסה")}</a>:failure!==403&&<button className="lsw-button lsw-button--secondary" onClick={load}>{text("Retry","ניסיון חוזר")}</button>}</div>}
 </main>;
}
export function LegacyClientsRoster({locale,section:rawSection,prospectFilter,focusLeadId}:RosterProps){
 const section:Section=rawSection&&sections.has(rawSection as Section)?rawSection as Section:"all";
 const t=copy[locale],showCases=section==="all"||section==="active"||section==="archived",showProspects=section==="all"||section==="prospects"||section==="paid"||section==="archived";
 const [rows,setRows]=useState<Case[]>([]),[state,setState]=useState<"loading"|"ready"|"error"|"auth"|"forbidden">("loading"),active=useRef(true),request=useRef(0);
 const load=()=>{const current=++request.current;setState("loading");void accountRead<Case[]>("cases").then(value=>{if(active.current&&current===request.current){setRows(value);setState("ready")}}).catch(error=>{if(active.current&&current===request.current){setRows([]);setState(error instanceof IdentityClientError&&error.code==="UNAUTHENTICATED"?"auth":error instanceof IdentityClientError&&error.code==="FORBIDDEN"?"forbidden":"error")}})};
 useEffect(()=>{active.current=true;if(showCases)queueMicrotask(load);return()=>{active.current=false}},[showCases]);
 const filtered=rows.filter(row=>section==="all"||(section==="archived"?closed(row.state):!closed(row.state)));
 const preset:Preset=section==="paid"?"booking":section==="archived"?"archived":prospectFilter&&filters.has(prospectFilter as Preset)?prospectFilter as Preset:"all";
 return <main className="lsw-main lsu-clients-directory" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className="lsw-page-header"><div><p className="lsw-eyebrow">{locale==="he"?"מרחב פרטי":"Private workspace"}</p><h1>{t.title}</h1><p>{t.lead}</p></div></header>
  <ProspectsClient key={`${section}:${preset}:${focusLeadId??''}`} locale={locale} initialFilter={preset} focusLeadId={focusLeadId} embedded
   clientCases={showCases&&state==="ready"?filtered:[]} caseState={showCases?state:null} onRetryCases={load} showProspects={showProspects}
   returnPath={practitionerReturnPath(locale,"clients",{section,filter:prospectFilter,leadId:focusLeadId})}/>
 </main>;
}
