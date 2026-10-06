"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {IdentityClientError,sessionInfo} from "../identity/client.ts";
import {loginHref} from "../identity/login-return.ts";
import type {PeopleView} from "./core/types.ts";
import type {Preset} from "../prospects/client.tsx";
import {administrativeStageLabel,administrativeStageChoices,administrativeActionLabel} from "../prospects/admin-display.ts";
import {peopleEdit,type PeopleEdit,type AdministrativeFields} from "./core/people-edit.ts";
import {compareAdministrativeEdits,resolveAdministrativeEdits,type AdministrativeField,type FieldChoice} from "./core/people-merge.ts";
import {normalizePhone} from "./core/contact-resolution.ts";
import "./native-people.css";
import type {PeopleResponse} from "./server/people-http.ts";
import type {NativeContactRow} from "./server/native-directory.ts";
import {peopleCreate,type PeopleCreate,type ProspectCreateFields} from "./core/people-create.ts";
import {peopleFiltersFromQuery,peoplePageFromQuery,oneDirectoryQuery as oneQuery,type DirectoryFilters} from "../prospects/directory-query.ts";
import {LeadCommandWorkspace} from "./lead-command-workspace.tsx";
export {peopleFiltersFromQuery,peoplePageFromQuery} from "../prospects/directory-query.ts";
type NativeData=Extract<PeopleResponse,{source:"native"}>;
type Draft={fields:AdministrativeFields;base:AdministrativeFields;version:number;pending?:PeopleEdit|null;conflict?:boolean};
export type SheetRequestContext={mode:"live";filter:Preset;personId?:string|undefined;leadId?:string|undefined};
export class PeopleRequestError extends Error{constructor(readonly status:number){super("PEOPLE_REQUEST_FAILED");}}
export async function requestPeople(params:URLSearchParams):Promise<PeopleResponse>{
 const r=await fetch("/api/private/people?"+params.toString(),{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 let b;try{b=await r.json();}catch{throw new PeopleRequestError(r.status);}
 if(!r.ok||!b?.ok)throw new PeopleRequestError(r.status);return b.data as PeopleResponse;
}
const pick=(row:NativeContactRow):AdministrativeFields=>({stage:row.stage,nextAction:row.nextAction,followUpDate:row.followUpDate,notes:row.notes});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const leadPattern=/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/;
const validPresets=new Set<Preset>(["all","today","new","intake","payment","booking","archived"]);
const emptyCreation:ProspectCreateFields={name:"",phone:"",language:"",source:"",notes:"",nextAction:"",dueDate:""};
export function NativePeopleWorkspace({locale,view,initial,onSheet,initialMode="live",initialFilter="all",initialFilters,initialLoadedContext=false,initialPersonId,initialLeadId}:{locale:Locale;view:PeopleView;initial:NativeData;initialMode?:"live"|"demo";initialFilter?:Preset;initialFilters?:DirectoryFilters;initialLoadedContext?:boolean;initialPersonId?:string|undefined;initialLeadId?:string|undefined;onSheet:(source:Extract<PeopleResponse,{source:"sheet"}>,context:SheetRequestContext)=>void}){
 const he=locale==="he",text=(en:string,heText:string)=>he?heText:en;
 const stageChoices=administrativeStageChoices(locale),isCustomStage=(value:string)=>value!==""&&!stageChoices.some(choice=>choice.value===value);
 const [data,setData]=useState(initial),[query,setQuery]=useState(initialFilters?.query??""),[stage,setStage]=useState(initialFilters?.stage??""),[language,setLanguage]=useState(initialFilters?.language??""),[due,setDue]=useState<string>(initialFilters?.due??"any"),[mode,setMode]=useState<"live"|"demo">(initialMode);
 const [customStage,setCustomStage]=useState(()=>isCustomStage(initialFilters?.stage??""));
 const [busy,setBusy]=useState(false),[failure,setFailure]=useState<number|null>(null),[selected,setSelected]=useState<string|null>(initialPersonId??null),[selectedRow,setSelectedRow]=useState<NativeContactRow|null>(initialPersonId?initial.page.items.find(row=>row.personId===initialPersonId)??null:null);
 const [focusedLead,setFocusedLead]=useState<string|null>(initialLeadId??null);
 const [preset,setPreset]=useState<Preset>(initialFilter);
 const lifecycle=useRef({serial:0,alive:true,authorized:true}),locationKey=useRef<string|null>(initialLoadedContext&&typeof window!=="undefined"?window.location.pathname+window.location.search:null);
 const [drafts,setDrafts]=useState(()=>new Map<string,Draft>());
 const [creation,setCreation]=useState<ProspectCreateFields>(emptyCreation),[createOpen,setCreateOpen]=useState(false),
  [createBusy,setCreateBusy]=useState(false),[createPending,setCreatePending]=useState<PeopleCreate|null>(null),[createMessage,setCreateMessage]=useState("");
 const createGuard=useRef(false);
 const load=useCallback(async(page=1,personId?:string,nextMode:"live"|"demo"=mode,leadId?:string,nextPreset:Preset=preset,filters?:DirectoryFilters)=>{
  const state=lifecycle.current,current=++state.serial;setBusy(true);setFailure(null);setMode(nextMode);setPreset(nextPreset);
  const applied=filters??peopleFiltersFromQuery(new URLSearchParams(window.location.search));
  // A pending/failed context change must never expose rows from the old context.
  setSelectedRow(null);setData(d=>({...d,page:{...d.page,items:[],total:0}}));
  const parameters=new URLSearchParams({view:personId||leadId?"all":view,mode:nextMode,page:String(page),...(personId?{personId}:{}),...(leadId?{leadId}:{}),
   ...(!personId&&!leadId?{search:applied.query,...(applied.stage?{stage:applied.stage}:{}),...(applied.language?{language:applied.language}:{}),due:applied.due,...(nextPreset!=="all"?{filter:nextPreset}:{})}:{})});
  try{const result=await requestPeople(parameters);if(!state.alive||current!==state.serial)return;
   if(result.source==="sheet"){if(nextMode==="demo")throw new PeopleRequestError(409);onSheet(result,{mode:nextMode,filter:nextPreset,personId,leadId});return;}
   state.authorized=true;
   setMode(nextMode);
   if(personId||leadId){const row=result.page.items.find(r=>personId?r.personId===personId:r.references.some(ref=>ref.leadId===leadId))??null;setSelected(row?.personId??personId??null);setSelectedRow(row);setData(d=>({...d,authorityEpoch:result.authorityEpoch}));}
   else setData(result);
  }catch(error){if(state.alive&&current===state.serial){const status=error instanceof PeopleRequestError?error.status:503;setFailure(status);if(status===401||status===403){state.authorized=false;setData(d=>({...d,page:{items:[],page:1,pages:1,pageSize:12,total:0}}));setSelectedRow(null);setDrafts(new Map());setCreation(emptyCreation);setCreatePending(null);setCreateMessage("");}}}
  finally{if(state.alive&&current===state.serial)setBusy(false);}
 },[view,mode,preset,onSheet]);
 const fromUrl=useCallback(()=>{locationKey.current=window.location.pathname+window.location.search;const params=new URLSearchParams(window.location.search),value=oneQuery(params,"personId"),lead=oneQuery(params,"leadId"),rawFilter=oneQuery(params,"filter"),filter=rawFilter&&validPresets.has(rawFilter as Preset)?rawFilter as Preset:"all",urlMode=oneQuery(params,"mode")==="demo"?"demo":"live";const id=value&&uuid.test(value)?value:null,leadId=lead&&leadPattern.test(lead)?lead:null,applied=peopleFiltersFromQuery(params);setQuery(applied.query);setStage(applied.stage);setCustomStage(applied.stage!==""&&!administrativeStageChoices("en").some(choice=>choice.value===applied.stage));setLanguage(applied.language);setDue(applied.due);setSelected(id);setFocusedLead(leadId);setSelectedRow(null);void load(id||leadId?1:peoplePageFromQuery(params),id??undefined,urlMode,leadId??undefined,filter,applied);},[load]);
 // The ordinary route can be hard-reloaded or opened directly. Popstate, not an
 // anchor jump, restores the selected main view. Drafts stay in authorized memory.
 useEffect(()=>{const state=lifecycle.current;state.alive=true;return()=>{state.alive=false;state.serial++;};},[]);
 useEffect(()=>{
  const key=window.location.pathname+window.location.search;
  if(locationKey.current!==key){locationKey.current=key;queueMicrotask(()=>{if(lifecycle.current.alive)fromUrl();});}
  window.addEventListener("popstate",fromUrl);return()=>window.removeEventListener("popstate",fromUrl);
 },[fromUrl]);
 function select(row:NativeContactRow|null){const url=new URL(window.location.href);url.searchParams.delete("leadId");if(row)url.searchParams.set("personId",row.personId);else url.searchParams.delete("personId");if(mode==="demo")url.searchParams.set("mode","demo");else url.searchParams.delete("mode");window.history.pushState(null,"",url);locationKey.current=url.pathname+url.search;setFocusedLead(null);setSelected(row?.personId??null);setSelectedRow(row);if(!row)void load(peoplePageFromQuery(url.searchParams));}
 function switchMode(next:"live"|"demo"){const url=new URL(window.location.href);url.searchParams.delete("leadId");url.searchParams.delete("personId");url.searchParams.delete("page");if(next==="demo")url.searchParams.set("mode","demo");else url.searchParams.delete("mode");window.history.pushState(null,"",url);locationKey.current=url.pathname+url.search;setFocusedLead(null);setSelected(null);void load(1,undefined,next);}
 function clearPreset(){const url=new URL(window.location.href);url.searchParams.delete("filter");url.searchParams.delete("page");window.history.pushState(null,"",url);locationKey.current=url.pathname+url.search;void load(1,undefined,mode,undefined,"all");}
 function changePage(page:number){const url=new URL(window.location.href);if(page===1)url.searchParams.delete("page");else url.searchParams.set("page",String(page));window.history.pushState(null,"",url);locationKey.current=url.pathname+url.search;void load(page);}
 function applyFilters(){const url=new URL(window.location.href);for(const [key,value] of [["search",query],["stage",stage],["language",language],["due",due==="any"?"":due]] as const){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}url.searchParams.delete("page");if(url.href!==window.location.href)window.history.pushState(null,"",url);locationKey.current=url.pathname+url.search;void load(1,undefined,mode,undefined,preset,{query,stage,language,due:due==="today"||due==="overdue"?due:"any"});}
 async function createContact(){
  if(createGuard.current||mode!=="live"||!lifecycle.current.authorized)return;
  let operation:PeopleCreate;
  try{operation=createPending??peopleCreate({...creation,action:"add",expectedEpoch:data.authorityEpoch,operationId:crypto.randomUUID()});}
  catch{setCreateMessage(text("Check the phone number, date and field lengths. Your draft is preserved.","יש לבדוק את הטלפון, התאריך ואורך השדות. הטיוטה נשמרה."));return;}
  createGuard.current=true;setCreateBusy(true);setCreatePending(operation);setCreateMessage("");
  const startedSerial=lifecycle.current.serial;
  try{
   const session=await sessionInfo(),r=await fetch("/api/prospects",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",
    headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(operation)});
   let body;try{body=await r.json();}catch{throw new PeopleRequestError(503);}
   if(!r.ok||!body?.ok)throw new PeopleRequestError(r.status);
   const saved=body.data;
   if(saved?.source!=="native"||saved.action!=="created"||!uuid.test(saved.personId??"")||saved.leadId!=="LS-LEAD-native-"+saved.personId||
    !Number.isSafeInteger(saved.version)||saved.version<1||saved.authorityEpoch!==operation.expectedEpoch)throw new PeopleRequestError(503);
   if(!lifecycle.current.alive||!lifecycle.current.authorized)return;
   setCreation(emptyCreation);setCreatePending(null);setCreateOpen(false);
   setCreateMessage(text("Contact saved without sending anything or creating a login.","איש הקשר נשמר בלי לשלוח דבר ובלי ליצור חשבון כניסה."));
   // Back/context navigation can occur while the request is in flight. Confirm
   // its outcome without returning the user to the old live context.
   if(startedSerial===lifecycle.current.serial){const url=new URL(window.location.href);if(url.searchParams.has("page")){url.searchParams.delete("page");window.history.replaceState(window.history.state,"",url);locationKey.current=url.pathname+url.search;}await load(1);}
  }catch(error){if(lifecycle.current.alive){
   const status=error instanceof PeopleRequestError?error.status:error instanceof IdentityClientError&&error.code==="UNAUTHENTICATED"?401:error instanceof IdentityClientError&&error.code==="FORBIDDEN"?403:503;
   if(status===401||status===403){lifecycle.current.authorized=false;lifecycle.current.serial++;setFailure(status);setSelectedRow(null);setDrafts(new Map());setCreation(emptyCreation);setCreatePending(null);setCreateMessage("");}
   else{
    if(status===409||status===400)setCreatePending(null);
    setCreateMessage(status===409?text("An existing phone claim or changed CRM authority needs review. No contact was merged. Your draft is preserved; refresh and check People before retrying.","שיוך קיים לטלפון או שינוי במקור אנשי הקשר דורשים בדיקה. לא אוחדו אנשי קשר. הטיוטה נשמרה; יש לרענן ולבדוק את האנשים לפני ניסיון נוסף."):status===400?text("Check the phone number, date and field lengths. The request was not accepted; your draft is preserved.","יש לבדוק את הטלפון, התאריך ואורך השדות. הבקשה לא התקבלה והטיוטה נשמרה."):
     text("The save could not be confirmed. Your draft is preserved. Retry the same request to check its outcome without creating a duplicate.","לא ניתן לאשר את השמירה. הטיוטה נשמרה. ניסיון חוזר של אותה בקשה בודק את התוצאה בלי ליצור כפילות."));
   }
  }}finally{createGuard.current=false;if(lifecycle.current.alive)setCreateBusy(false);}
 }
 const presetLabels:Record<Preset,string>={all:text("All","הכול"),today:text("Due today","לטיפול היום"),new:text("New inquiries","פניות חדשות"),intake:text("Intake","טופס היכרות"),payment:text("Awaiting verified payment","ממתינים לתשלום מאומת"),booking:text("Paid — awaiting booking","שולם — ממתינים לקביעת מועד"),archived:text("Archived","בארכיון")};
 const denied=failure===401||failure===403;
 return <section className="lsu-native-people" aria-busy={busy}>
  {!denied&&<div hidden={mode!=="live"}><LeadCommandWorkspace locale={locale} epoch={data.authorityEpoch} personId={selectedRow?.personId} readBlocked={busy||failure!==null||mode!=="live"}
   denied={status=>{lifecycle.current.authorized=false;lifecycle.current.serial++;setBusy(false);setFailure(status);setSelectedRow(null);setDrafts(new Map());setCreation(emptyCreation);setCreatePending(null);setCreateMessage("");}}/></div>}
  {failure!==null&&<div className="lsw-alert" role="alert"><p>{failure===401?text("Your session ended. Sign in to continue.","פג תוקף החיבור. יש להיכנס מחדש."):failure===403?text("This account cannot access the practitioner directory.","לחשבון הזה אין גישה לרשימת המטפל/ת."):failure===409?text("Contact records are being reconciled. No fallback data or changes were used.","רשומות אנשי הקשר נמצאות בהתאמה. לא הוצגו נתונים חלופיים ולא בוצעו שינויים."):text("The current records could not be loaded. No unrefreshed records are shown. Your authorized draft remains in this session.","לא ניתן לטעון את הרשומות העדכניות. רשומות שלא רועננו אינן מוצגות. הטיוטה המורשית שלך נשמרת בחיבור הנוכחי.")}</p>{failure===401?<a className="lsw-button lsw-button--secondary" href={loginHref(locale,window.location.pathname+window.location.search)}>{text("Sign in","כניסה")}</a>:!denied&&<button className="lsw-button lsw-button--secondary" onClick={()=>void load(focusedLead||selected?1:peoplePageFromQuery(new URLSearchParams(window.location.search)),focusedLead?undefined:selected??undefined,mode,focusedLead??undefined)}>{text("Retry","ניסיון חוזר")}</button>}</div>}
  {!denied&&(selected||focusedLead?<><nav aria-label={text("Person context","הקשר איש קשר")} className="lsw-breadcrumbs"><button className="lsw-button lsw-button--quiet" onClick={()=>select(null)}>{text("People","אנשים")}</button><span aria-current="page">{selectedRow?.displayName??text("Person","איש קשר")}</span></nav>
    {selectedRow?<NativePerson key={selectedRow.personId} row={selectedRow} epoch={data.authorityEpoch} locale={locale} draft={drafts.get(selectedRow.personId)}
     remember={(fields,base,version,pending,conflict)=>{if(lifecycle.current.alive&&lifecycle.current.authorized)setDrafts(previous=>new Map(previous).set(selectedRow.personId,{fields,base,version,pending:pending??null,conflict:conflict??false}));}} denied={status=>{lifecycle.current.authorized=false;lifecycle.current.serial++;setBusy(false);setFailure(status);setSelectedRow(null);setDrafts(new Map());setCreation(emptyCreation);setCreatePending(null);setCreateMessage("");}}/>:!busy&&failure===null&&<p role="status">{text("This person is not in the authorized view.","איש הקשר אינו נמצא בתצוגה המורשית.")}</p>}</>:
   <><div className="lsw-section-header"><span>{data.page.total} {text("people","אנשים")}{preset!=="all"&&<> · {presetLabels[preset]} <button className="lsw-button lsw-button--quiet" disabled={busy} onClick={clearPreset}>{text("Clear workflow filter","ניקוי מסנן תהליך")}</button></>}</span><div className="lsw-actions">{mode==="demo"?<button className="lsw-button lsw-button--secondary" disabled={busy||createBusy} onClick={()=>switchMode("live")}>{text("Return to live app","חזרה ליישום החי")}</button>:<><button type="button" className="lsw-button lsw-button--secondary" disabled={busy||createBusy} aria-expanded={createOpen} aria-controls="native-create-contact" onClick={()=>setCreateOpen(!createOpen)}>{text("Add prospect","הוספת מתעניין")}</button><button className="lsw-button lsw-button--quiet" disabled={busy||createBusy} onClick={()=>switchMode("demo")}>{text("DEMO records","רשומות DEMO")}</button></>}</div></div>
    {mode==="demo"&&<p role="status">{text("Clearly marked synthetic records. Real sending, billing and booking effects are blocked.","רשומות סינתטיות מסומנות. שליחה, חיוב וקביעת תורים אמיתיים חסומים.")}</p>}
    {mode==="live"&&<>
     <div id="native-create-contact" hidden={!createOpen}>{createOpen&&<form className="lsw-card" onSubmit={event=>{event.preventDefault();void createContact();}} aria-label={text("New administrative contact","איש קשר מנהלי חדש")}>
      <fieldset className="lsw-stack" disabled={createBusy||createPending!==null}><legend>{text("Contact details — no message or login is created","פרטי איש קשר — לא נשלחת הודעה ולא נוצר חשבון כניסה")}</legend>
       <div className="lsw-two-fields"><label className="lsw-field">{text("Name (optional)","שם (לא חובה)")}<input className="lsw-input" maxLength={120} value={creation.name} onChange={e=>setCreation({...creation,name:e.target.value})}/></label>
        <label className="lsw-field">{text("Phone","טלפון")}<input className="lsw-input" inputMode="tel" required maxLength={64} value={creation.phone} onChange={e=>setCreation({...creation,phone:e.target.value})}/></label>
        <label className="lsw-field">{text("Language","שפה")}<select className="lsw-input" value={creation.language} onChange={e=>setCreation({...creation,language:e.target.value as ""|"he"|"en"})}><option value="">{text("Not specified","לא צוין")}</option><option value="he">עברית</option><option value="en">English</option></select></label>
        <label className="lsw-field">{text("Source","מקור")}<input className="lsw-input" maxLength={120} value={creation.source} onChange={e=>setCreation({...creation,source:e.target.value})}/></label>
        <label className="lsw-field">{text("Next action","הפעולה הבאה")}<input className="lsw-input" maxLength={500} value={creation.nextAction} onChange={e=>setCreation({...creation,nextAction:e.target.value})}/></label>
        <label className="lsw-field">{text("Due date","תאריך יעד")}<input className="lsw-input" type="date" value={creation.dueDate} onChange={e=>setCreation({...creation,dueDate:e.target.value})}/></label></div>
       <label className="lsw-field">{text("Administrative note","הערה מנהלית")}<textarea className="lsw-input" maxLength={5000} value={creation.notes} onChange={e=>setCreation({...creation,notes:e.target.value})}/></label>
      </fieldset><button className="lsw-button lsw-button--primary" disabled={createBusy||busy}>{createPending?text("Retry this save","ניסיון חוזר של השמירה"):text("Save contact","שמירת איש קשר")}</button>
     </form>}</div>{createMessage&&<p role="status">{createMessage}</p>}</>}
    <form className="lsw-card lsu-people-toolbar" onSubmit={e=>{e.preventDefault();applyFilters();}} aria-label={text("Search and filters","חיפוש ומסננים")}>
     <label className="lsw-field">{text("Search name, phone or email","חיפוש לפי שם, טלפון או דוא״ל")}<input className="lsw-input" type="search" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)}/></label>
     <div className="lsw-field"><label className="lsw-field">{text("Exact stage","שלב מדויק")}<select className="lsw-select" value={customStage?"__custom__":stage} onChange={e=>{const custom=e.target.value==="__custom__";setCustomStage(custom);setStage(custom?isCustomStage(stage)?stage:"":e.target.value);}}>
      <option value="">{text("All stages","כל השלבים")}</option>{stageChoices.map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>)}<option value="__custom__">{text("Custom exact stage","שלב מותאם מדויק")}</option>
     </select></label>{customStage&&<label className="lsw-field">{text("Custom exact stage text","טקסט השלב המותאם המדויק")}<input className="lsw-input" maxLength={120} value={stage} onChange={e=>setStage(e.target.value)}/></label>}</div>
     <label className="lsw-field">{text("Language","שפה")}<select className="lsw-input" value={language} onChange={e=>setLanguage(e.target.value)}><option value="">{text("All","הכול")}</option><option value="he">עברית</option><option value="en">English</option></select></label>
     <label className="lsw-field">{text("Follow-up","המשך טיפול")}<select className="lsw-input" value={due} onChange={e=>setDue(e.target.value)}><option value="any">{text("Any date","כל המועדים")}</option><option value="today">{text("Today","היום")}</option><option value="overdue">{text("Overdue","באיחור")}</option></select></label>
     <button className="lsw-button lsw-button--primary" disabled={busy}>{text("Apply filters","הצגת המסננים")}</button>
    </form>
    <div className="lsu-native-table"><table><caption>{text("People and next actions","אנשים והפעולה הבאה")}</caption><thead><tr>{[text("Person","איש קשר"),text("Status","מצב"),text("Next action","הפעולה הבאה"),text("Follow-up","המשך טיפול")].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{data.page.items.map(row=><tr key={row.personId}><td><button className="lsw-button lsw-button--quiet" onClick={()=>select(row)}>{row.displayName}</button>{row.mode==="demo"&&<span> DEMO</span>}</td><td>{administrativeStageLabel(row.stage,locale)}</td><td>{row.nextAction===null?"—":administrativeActionLabel(row.nextAction,locale)}</td><td>{row.followUpDate??"—"}</td></tr>)}</tbody></table></div>
    <div className="lsu-people-results lsu-native-cards">{data.page.items.map(row=><button type="button" className="lsw-card lsu-person-row" key={row.personId} onClick={()=>select(row)}><strong>{row.displayName}</strong><span>{row.identityKind==="minor"?text("Child","ילד/ה"):text("Adult / contact","מבוגר/ת / איש קשר")} · {administrativeStageLabel(row.stage,locale)} {row.mode==="demo"&&"· DEMO"}</span><span>{row.nextAction===null?"—":administrativeActionLabel(row.nextAction,locale)}</span><span>{row.followUpDate??"—"}</span></button>)}</div>
    {!busy&&failure===null&&!data.page.total&&<p className="lsw-empty">{text("No people match these filters.","אין אנשים שמתאימים למסננים.")}</p>}
    <nav className="lsw-actions" aria-label={text("Pagination","דפדוף")}><button className="lsw-button lsw-button--secondary" disabled={busy||data.page.page<=1} onClick={()=>changePage(data.page.page-1)}>{text("Previous","הקודם")}</button><span>{data.page.page} / {data.page.pages}</span><button className="lsw-button lsw-button--secondary" disabled={busy||data.page.page>=data.page.pages} onClick={()=>changePage(data.page.page+1)}>{text("Next","הבא")}</button></nav>
   </>)}
 </section>;
}
function NativePerson({row,epoch,locale,draft,remember,denied}:{row:NativeContactRow;epoch:number;locale:Locale;draft:Draft|undefined;remember:(f:AdministrativeFields,base:AdministrativeFields,v:number,pending?:PeopleEdit|null,conflict?:boolean)=>void;denied:(s:number)=>void}){
 const text=(en:string,he:string)=>locale==="he"?he:en;
 const [fields,setFields]=useState(draft?.fields??pick(row)),[version,setVersion]=useState(draft?.version??row.version),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[unknown,setUnknown]=useState(!!draft?.pending),[conflict,setConflict]=useState(draft?.conflict??false),[latest,setLatest]=useState<{fields:AdministrativeFields;version:number;conflicts:AdministrativeField[]}|null>(null),[choices,setChoices]=useState<Partial<Record<AdministrativeField,FieldChoice>>>({});
 const base=useRef<AdministrativeFields>(draft?.base??pick(row));
 const pending=useRef<PeopleEdit|null>(draft?.pending??null),guard=useRef(false);
 function edit(patch:Partial<AdministrativeFields>){const f={...fields,...patch};setFields(f);if(version!==null)remember(f,base.current,version,pending.current,conflict);}
 async function save(){if(guard.current||version===null||conflict)return;
  let op:PeopleEdit;try{op=pending.current??peopleEdit({action:"update",personId:row.personId,expectedEpoch:epoch,expectedVersion:version,operationId:crypto.randomUUID(),fields});}
  catch{setMessage(text("Check the stage, date and field lengths. Your draft is preserved.","יש לבדוק את השלב, התאריך ואורך השדות. הטיוטה שלך נשמרה."));return;}
  guard.current=true;setBusy(true);setMessage("");
  try{pending.current=op;remember(fields,base.current,version,op,conflict);
   const s=await sessionInfo(),r=await fetch("/api/private/contact-profiles",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{"content-type":"application/json","x-csrf-token":s.csrfToken},body:JSON.stringify(op)});
   if(r.status===401||r.status===403){denied(r.status);return;}
   if(r.status===409){pending.current=null;remember(fields,base.current,version,null,true);setUnknown(false);setConflict(true);setMessage(text("A newer version or changed contact authority prevents this save. Your draft is preserved.","גרסה חדשה או שינוי בבעלות על הרשומות מונעים שמירה. הטיוטה שלך נשמרה."));return;}
   if(r.status===400){pending.current=null;remember(fields,base.current,version,null,false);setUnknown(false);setMessage(text("Check the stage, date and field lengths. Your draft is preserved.","יש לבדוק את השלב, התאריך ואורך השדות. הטיוטה שלך נשמרה."));return;}
   const b=await r.json();if(!r.ok||!b?.ok||!Number.isSafeInteger(b.data?.version)||b.data.personId!==row.personId||b.data.authorityEpoch!==epoch)throw Error("UNCONFIRMED");
   setFields(op.fields);setVersion(b.data.version);base.current=op.fields;remember(op.fields,base.current,b.data.version,null,false);pending.current=null;setUnknown(false);setMessage(text("Saved in the native contact record.","נשמר ברשומת איש הקשר המקומית."));
  }catch(error){if(error instanceof IdentityClientError&&["UNAUTHENTICATED","FORBIDDEN"].includes(error.code)){denied(error.code==="UNAUTHENTICATED"?401:403);return;}setUnknown(!!pending.current);setMessage(text("The save could not be confirmed. Your draft remains here. Retry the same operation; do not send anything.","לא ניתן לאשר את השמירה. הטיוטה נשארה כאן. יש לנסות שוב את אותה פעולת שמירה; לא נשלחת הודעה."));}
  finally{guard.current=false;setBusy(false);}}
 async function check(){setBusy(true);try{const q=new URLSearchParams({personId:row.personId,expectedEpoch:String(epoch)}),r=await fetch("/api/private/contact-profiles?"+q,{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});if(r.status===401||r.status===403){denied(r.status);return;}const b=await r.json();if(!r.ok||!b?.ok||b.data?.personId!==row.personId||b.data?.authorityEpoch!==epoch)throw Error("READ_FAILED");const current=peopleEdit({action:"update",personId:row.personId,expectedEpoch:epoch,expectedVersion:b.data.version,operationId:crypto.randomUUID(),fields:{stage:b.data.stage,nextAction:b.data.nextAction,followUpDate:b.data.followUpDate,notes:b.data.notes}});const comparison=compareAdministrativeEdits(base.current,fields,current.fields);setChoices({});if(comparison.conflicts.length){setLatest({fields:current.fields,version:current.expectedVersion,conflicts:comparison.conflicts});setMessage(text("Choose which value to keep for each changed field. Nothing has been saved yet.","יש לבחור איזה ערך לשמור בכל שדה שהשתנה. דבר עדיין לא נשמר."));}else{base.current=current.fields;setFields(comparison.merged);setVersion(current.expectedVersion);remember(comparison.merged,base.current,current.expectedVersion,null,false);setLatest(null);setConflict(false);setMessage(text("Independent changes were combined. Review and save the draft.","שינויים נפרדים שולבו. יש לעיין בטיוטה ולשמור."));}}catch{setMessage(text("The saved record could not be read. Your draft is still preserved.","לא ניתן לקרוא את הרשומה השמורה. הטיוטה עדיין נשמרה."));}finally{setBusy(false);}}
 return <article className="lsw-stack"><h2>{row.displayName}</h2><p>{row.mode==="demo"?"DEMO · ":""}{administrativeStageLabel(fields.stage,locale)}</p>
  {row.acquisitionProjections?.length&&<section className="lsw-card" aria-label={text("Administrative label projections","תוויות מנהליות אצל הספק")}>
   {row.acquisitionProjections.map(projection=><p key={projection.channel}>{projection.channel==="google_contacts"?"Google · Life Skills Lead":"WhatsApp · LS • Lead"}: {projection.state==="applied"?text("Applied","הוחלה"):projection.state==="no_chat"?text("No chat","אין שיחה"):projection.state==="failed"?text("Failed","נכשל"):text("Pending — provider connection/write not verified","ממתין — החיבור והשינוי אצל הספק לא אומתו")} · <time dateTime={projection.updatedAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(projection.updatedAt))}</time></p>)}
  </section>}
  <div className="lsw-actions">{row.caseLinks?.map(c=><a key={c.caseId} className="lsw-button lsw-button--secondary" href={`/${locale}/app/cases/${encodeURIComponent(c.caseId)}`}>{text("Open client case","פתיחת תיק לקוח")} · {c.state}</a>)}</div>
  {row.callActivity&&<details className="lsw-details"><summary>{text("Recorded phone calls","שיחות טלפון מתועדות")}</summary>
   {row.callActivity.items.map(call=><p key={call.id}>{text("Incoming call notification · Nomad","הודעת שיחה נכנסת · Nomad")} · <time dateTime={call.occurredAt}>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(call.occurredAt))}</time></p>)}
   <p className="lsw-help">{text("Administrative activity only. A ringing notification is not a completed/missed call, consent, payment or clinical record.","פעילות מנהלית בלבד. הודעת צלצול אינה שיחה שהושלמה או הוחמצה, הסכמה, תשלום או רשומה טיפולית.")}</p>
   {row.callActivity.hasMore&&<p>{text("Showing the latest five recorded calls.","מוצגות חמש השיחות המתועדות האחרונות.")}</p>}
  </details>}
  <details className="lsw-details"><summary>{text("Recorded inquiries and verified journey facts","פניות מתועדות ועובדות מאומתות בתהליך")}</summary>{row.references.map(ref=><section key={ref.leadId} className="lsw-card"><p dir="ltr">{ref.phone||ref.email||ref.leadId}</p><p>{ref.journey.journeyState} · {text("Payment verified","תשלום מאומת")}: {ref.journey.paymentVerified?text("Yes","כן"):text("No","לא")} · {text("Booking confirmed","מועד מאושר")}: {ref.journey.bookingConfirmed?text("Yes","כן"):text("No","לא")}</p>{normalizePhone(ref.phone)&&row.mode!=="demo"&&!row.doNotContact&&<a className="lsw-button lsw-button--secondary" href={`https://wa.me/${normalizePhone(ref.phone)!.slice(1)}`} target="_blank" rel="noopener noreferrer">{text("Open WhatsApp","פתיחת WhatsApp")}</a>}{row.doNotContact&&<p className="lsw-help">{text("Do not contact: communication actions are unavailable.","אין ליצור קשר: פעולות תקשורת אינן זמינות.")}</p>}<p className="lsw-help">{text("Imported payment/booking labels are not verification. External communications stay separate from clinical notes.","תוויות תשלום או הזמנה שיובאו אינן אימות. תקשורת חיצונית נפרדת מהערות טיפוליות.")}</p></section>)}</details>
  {version!==null&&<details className="lsw-details"><summary>{text("Follow-up and administrative notes","המשך טיפול והערות מנהליות")}</summary><form className="lsw-stack" onSubmit={e=>{e.preventDefault();void save();}}>
   <label className="lsw-field">{text("Stage","שלב")}<input className="lsw-input" required maxLength={120} value={fields.stage} disabled={busy||unknown||conflict} onChange={e=>edit({stage:e.target.value})}/></label>
   <label className="lsw-field">{text("Next action","הפעולה הבאה")}<input className="lsw-input" maxLength={500} value={fields.nextAction??""} disabled={busy||unknown||conflict} onChange={e=>edit({nextAction:e.target.value||null})}/></label>
   <label className="lsw-field">{text("Follow-up date","תאריך המשך טיפול")}<input className="lsw-input" type="date" value={fields.followUpDate??""} disabled={busy||unknown||conflict} onChange={e=>edit({followUpDate:e.target.value||null})}/></label>
   <label className="lsw-field">{text("Administrative note","הערה מנהלית")}<textarea className="lsw-input" maxLength={5000} value={fields.notes} disabled={busy||unknown||conflict} onChange={e=>edit({notes:e.target.value})}/></label>
   <button className="lsw-button lsw-button--primary" disabled={busy||conflict}>{unknown?text("Retry the same save","ניסיון נוסף לאותה שמירה"):text("Save follow-up","שמירת המשך טיפול")}</button>
  </form>{conflict&&<button className="lsw-button lsw-button--secondary" disabled={busy} onClick={()=>void check()}>{text("Compare saved version","השוואה לגרסה השמורה")}</button>}
  {latest&&<section className="lsw-card"><h3>{text("Compare saved version","השוואה לגרסה השמורה")} {latest.version}</h3><p>{text("Your draft and the saved record both changed these fields. Choose each value before preparing a new save; this does not save or send anything.","הטיוטה והרשומה השמורה שינו את השדות הבאים. יש לבחור ערך לכל שדה לפני הכנת שמירה חדשה; פעולה זו אינה שומרת או שולחת דבר.")}</p>
   {latest.conflicts.map(key=><fieldset key={key} className="lsw-stack"><legend>{key==="stage"?text("Stage","שלב"):key==="nextAction"?text("Next action","הפעולה הבאה"):key==="followUpDate"?text("Follow-up date","תאריך המשך טיפול"):text("Administrative note","הערה מנהלית")}</legend>
    <label><input type="radio" name={`resolve-${key}`} checked={choices[key]==="saved"} onChange={()=>setChoices(old=>({...old,[key]:"saved"}))}/> {text("Use saved value","שימוש בערך השמור")}</label><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{latest.fields[key]??"—"}</pre>
    <label><input type="radio" name={`resolve-${key}`} checked={choices[key]==="draft"} onChange={()=>setChoices(old=>({...old,[key]:"draft"}))}/> {text("Keep my draft value","שמירת הערך מהטיוטה")}</label><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{fields[key]??"—"}</pre>
   </fieldset>)}
   <button type="button" className="lsw-button lsw-button--secondary" disabled={busy||latest.conflicts.some(key=>!choices[key])} onClick={()=>{const merged=resolveAdministrativeEdits(base.current,fields,latest.fields,choices);if(!merged)return;base.current=latest.fields;setFields(merged);setVersion(latest.version);remember(merged,base.current,latest.version,null,false);setConflict(false);setLatest(null);setChoices({});setMessage(text("Your chosen values are in the draft. Review and save them explicitly.","הערכים שנבחרו נמצאים בטיוטה. יש לעיין בהם ולשמור במפורש."));}}>{text("Prepare merged draft","הכנת טיוטה משולבת")}</button>
  </section>}
  </details>}
  <p className="lsw-save-result" role="status">{message}</p>
 </article>;
}
