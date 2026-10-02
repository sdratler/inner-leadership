"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {z} from "zod";
import {accountRead,IdentityClientError} from "../identity/client.ts";
import {practitionerReturnPath} from "../identity/login-return.ts";
import {ProspectsClient,type Preset} from "../prospects/client.tsx";
import type {Locale} from "../../lib/locale.ts";
import {NativePeopleWorkspace,peopleFiltersFromQuery,peoplePageFromQuery,requestPeople,PeopleRequestError,type SheetRequestContext} from "../contact-ops/native-people-workspace.tsx";
import type {PeopleResponse} from "../contact-ops/server/people-http.ts";
import {loginHref} from "../identity/login-return.ts";
import {AcquisitionWorkspace} from "../contact-ops/acquisition-workspace.tsx";

const caseRows=z.array(z.object({id:z.uuid(),kind:z.enum(["minor","adult"]),state:z.string().min(1),displayName:z.string().min(1),mode:z.enum(["live","demo"])}));
type Case=z.infer<typeof caseRows>[number];
type Section="all"|"prospects"|"paid"|"active"|"archived";
const sections=new Set<Section>(["all","prospects","paid","active","archived"]);
const filters=new Set<Preset>(["all","today","new","intake","payment","booking","archived"]);
const copy={
 en:{title:"People",lead:"Client cases and intake follow-ups in one directory."},
 he:{title:"אנשים",lead:"תיקי לקוחות והמשך טיפול בפניות ברשימה אחת."}
} as const;
const closed=(state:string)=>/closed|archived|revoked/i.test(state);

/** The CRM is read from its existing authenticated endpoint; this view never imports or duplicates leads. */
type RosterProps={locale:Locale;section?:string|undefined;prospectFilter?:string|undefined;focusLeadId?:string|undefined;personId?:string|undefined;mode?:string|undefined;page?:string|undefined;search?:string|undefined;stage?:string|undefined;language?:string|undefined;due?:string|undefined};
/** Choose the real durable authority before rendering one directory. A frozen
 * transition or failed native read cannot initialize the legacy bridge UI. */
export function ClientsRoster(props:RosterProps){
 const needsReview=props.section==="needs_review";
 const {locale}=props,section=props.section&&sections.has(props.section as Section)?props.section as Section:"all";
 const mode=props.mode==="demo"?"demo":"live",personId=props.personId&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(props.personId)?props.personId:undefined;
 const leadId=props.focusLeadId&&/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/.test(props.focusLeadId)?props.focusLeadId:undefined;
 const filter=props.prospectFilter&&filters.has(props.prospectFilter as Preset)?props.prospectFilter as Preset:"all";
 const requested=new URLSearchParams();for(const key of ["page","search","stage","language","due"] as const)if(props[key])requested.set(key,props[key]);
 const initialPage=peoplePageFromQuery(requested),initialFilters=peopleFiltersFromQuery(requested);
 const returnQuery={...props,filter:props.prospectFilter,leadId:props.focusLeadId};
 const [source,setSource]=useState<PeopleResponse|null>(null),[sourceContext,setSourceContext]=useState<{mode:"live"|"demo";filter:Preset;personId?:string|undefined;leadId?:string|undefined}>({mode,filter,personId,leadId}),[failure,setFailure]=useState<number|null>(null),lifecycle=useRef({alive:true,serial:0});
 const acceptSheet=useCallback((response:Extract<PeopleResponse,{source:"sheet"}>,context:SheetRequestContext)=>{if(lifecycle.current.alive){setSourceContext(context);setSource(response);}},[]);
 const load=useCallback(()=>{if(needsReview)return;const state=lifecycle.current,n=++state.serial;setSource(null);setSourceContext({mode,filter,personId,leadId});setFailure(null);void requestPeople(new URLSearchParams({view:personId||leadId?"all":section,...(mode==="demo"?{mode}:{}),...(personId?{personId}:{}),...(leadId?{leadId}:{}),...(!personId&&!leadId?{...(filter!=="all"?{filter}:{}),...(initialPage>1?{page:String(initialPage)}:{}),...(initialFilters.query?{search:initialFilters.query}:{}),...(initialFilters.stage?{stage:initialFilters.stage}:{}),...(initialFilters.language?{language:initialFilters.language}:{}),...(initialFilters.due!=="any"?{due:initialFilters.due}:{})}:{})})).then(r=>{if(state.alive&&n===state.serial)setSource(r);}).catch(e=>{if(state.alive&&n===state.serial)setFailure(e instanceof PeopleRequestError?e.status:503);});},[needsReview,section,mode,personId,leadId,filter,initialPage,initialFilters.query,initialFilters.stage,initialFilters.language,initialFilters.due]);
 useEffect(()=>{const state=lifecycle.current;state.alive=true;queueMicrotask(()=>{if(state.alive)load();});return()=>{state.alive=false;state.serial++;};},[load]);
 if(needsReview)return <AcquisitionWorkspace locale={locale} mode={props.mode}/>;
 if(source?.source==="sheet"&&sourceContext.mode!=="demo"&&(!sourceContext.personId||sourceContext.leadId))return <LegacyClientsRoster {...props} mode="live" prospectFilter={sourceContext.filter} focusLeadId={sourceContext.leadId} personId={sourceContext.personId}/>;
 const text=(en:string,he:string)=>locale==="he"?he:en;
 return <main className="lsw-main lsu-clients-directory" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className="lsw-page-header"><h1>{copy[locale].title}</h1></header>
  {source?.source==="native"?<NativePeopleWorkspace key={`${section}:${mode}:${filter}:${personId??leadId??""}`} locale={locale} view={section} initial={source} initialMode={mode} initialFilter={filter} initialFilters={initialFilters} initialLoadedContext initialPersonId={personId??(leadId&&source.page.items.length===1?source.page.items[0]?.personId:undefined)} initialLeadId={leadId} onSheet={acceptSheet}/>:
   source?.source==="sheet"?<p role="status">{sourceContext.mode==="demo"?text("The DEMO native directory is not available before the verified contact cutover. No live records are shown in DEMO.","רשימת DEMO המקומית אינה זמינה לפני המעבר המאומת של אנשי הקשר. רשומות חיות אינן מוצגות ב-DEMO."):text("This native person view is unavailable while contact authority is the existing Sheet. No unrelated records are shown.","תצוגת איש הקשר המקומית אינה זמינה כאשר הגיליון הקיים הוא מקור אנשי הקשר. רשומות אחרות אינן מוצגות.")}{sourceContext.mode!=="demo"&&<> <a href={`/${locale}/app/clients`}>{text("Open People","פתיחת אנשים")}</a></>}</p>:
   failure===null?<p role="status">{text("Loading authorized people…","טוען אנשים מורשים…")}</p>:<div className="lsw-alert" role="alert"><p>{failure===401?text("Your session ended. Sign in to continue.","פג תוקף החיבור. יש להיכנס מחדש."):failure===403?text("This account cannot access the practitioner directory.","לחשבון הזה אין גישה לרשימת המטפל/ת."):failure===409?text("Contact records are being reconciled. No fallback or changes were used.","רשומות אנשי הקשר נמצאות בהתאמה. לא הוצגו נתונים חלופיים ולא בוצעו שינויים."):text("People could not be loaded. This is not an empty directory.","לא ניתן לטעון את האנשים. אין להסיק שהרשימה ריקה.")}</p>{failure===401?<a className="lsw-button lsw-button--secondary" href={loginHref(locale,practitionerReturnPath(locale,"clients",returnQuery))}>{text("Sign in","כניסה")}</a>:failure!==403&&<button className="lsw-button lsw-button--secondary" onClick={load}>{text("Retry","ניסיון חוזר")}</button>}</div>}
 </main>;
}
export function LegacyClientsRoster({locale,section:rawSection,prospectFilter,focusLeadId}:RosterProps){
 const section:Section=rawSection&&sections.has(rawSection as Section)?rawSection as Section:"all";
 const t=copy[locale],showCases=section==="all"||section==="active"||section==="archived",showProspects=section==="all"||section==="prospects"||section==="paid"||section==="archived";
 const [rows,setRows]=useState<Case[]>([]),[state,setState]=useState<"loading"|"ready"|"error"|"auth"|"forbidden">("loading"),active=useRef(true),request=useRef(0);
 const load=()=>{const current=++request.current;setState("loading");void accountRead<unknown>("cases","live").then(value=>{if(active.current&&current===request.current){setRows(caseRows.parse(value).filter(row=>row.mode==="live"));setState("ready")}}).catch(error=>{if(active.current&&current===request.current){setRows([]);setState(error instanceof IdentityClientError&&error.code==="UNAUTHENTICATED"?"auth":error instanceof IdentityClientError&&error.code==="FORBIDDEN"?"forbidden":"error")}})};
 useEffect(()=>{active.current=true;if(showCases)queueMicrotask(load);return()=>{active.current=false}},[showCases]);
 const filtered=rows.filter(row=>section==="all"||(section==="archived"?closed(row.state):!closed(row.state)));
 const preset:Preset=section==="paid"?"booking":section==="archived"?"archived":prospectFilter&&filters.has(prospectFilter as Preset)?prospectFilter as Preset:"all";
 return <main className="lsw-main lsu-clients-directory" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <header className="lsw-page-header"><h1>{t.title}</h1></header>
  <ProspectsClient key={`${section}:${preset}:${focusLeadId??''}`} locale={locale} initialFilter={preset} focusLeadId={focusLeadId} embedded
   clientCases={showCases&&state==="ready"?filtered:[]} caseState={showCases?state:null} onRetryCases={load} showProspects={showProspects}
   returnPath={practitionerReturnPath(locale,"clients",{section,filter:prospectFilter,leadId:focusLeadId})}/>
 </main>;
}
