"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import {IdentityClientError,sessionInfo} from "../identity/client.ts";
import {loginHref} from "../identity/login-return.ts";
import type {PeopleView} from "./core/types.ts";
import {peopleEdit,type PeopleEdit,type AdministrativeFields} from "./core/people-edit.ts";
import {normalizePhone} from "./core/contact-resolution.ts";
import "./native-people.css";
import type {PeopleResponse} from "./server/people-http.ts";
import type {NativeContactRow} from "./server/native-directory.ts";
type NativeData=Extract<PeopleResponse,{source:"native"}>;
type Draft={fields:AdministrativeFields;version:number;pending?:PeopleEdit|null;conflict?:boolean};
export class PeopleRequestError extends Error{constructor(readonly status:number){super("PEOPLE_REQUEST_FAILED");}}
export async function requestPeople(params:URLSearchParams):Promise<PeopleResponse>{
 const r=await fetch("/api/private/people?"+params.toString(),{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 let b;try{b=await r.json();}catch{throw new PeopleRequestError(r.status);}
 if(!r.ok||!b?.ok)throw new PeopleRequestError(r.status);return b.data as PeopleResponse;
}
const pick=(row:NativeContactRow):AdministrativeFields=>({stage:row.stage,nextAction:row.nextAction,followUpDate:row.followUpDate,notes:row.notes});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const leadPattern=/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/;
export function NativePeopleWorkspace({locale,view,initial,onSheet,initialMode="live",initialPersonId,initialLeadId}:{locale:Locale;view:PeopleView;initial:NativeData;initialMode?:"live"|"demo";initialPersonId?:string|undefined;initialLeadId?:string|undefined;onSheet:(source:Extract<PeopleResponse,{source:"sheet"}>)=>void}){
 const he=locale==="he",text=(en:string,heText:string)=>he?heText:en;
 const [data,setData]=useState(initial),[query,setQuery]=useState(""),[stage,setStage]=useState(""),[language,setLanguage]=useState(""),[due,setDue]=useState("any"),[mode,setMode]=useState<"live"|"demo">(initialMode);
 const [busy,setBusy]=useState(false),[failure,setFailure]=useState<number|null>(null),[selected,setSelected]=useState<string|null>(initialPersonId??null),[selectedRow,setSelectedRow]=useState<NativeContactRow|null>(initialPersonId?initial.page.items.find(row=>row.personId===initialPersonId)??null:null);
 const [focusedLead,setFocusedLead]=useState<string|null>(initialLeadId??null);
 const lifecycle=useRef({serial:0,alive:true,authorized:true}),locationKey=useRef<string|null>(null);
 const [drafts,setDrafts]=useState(()=>new Map<string,Draft>());
 const load=useCallback(async(page=1,personId?:string,nextMode:"live"|"demo"=mode,leadId?:string)=>{
  const state=lifecycle.current,current=++state.serial;setBusy(true);setFailure(null);setMode(nextMode);
  // A pending/failed context change must never expose rows from the old context.
  setSelectedRow(null);setData(d=>({...d,page:{...d.page,items:[],total:0}}));
  const parameters=new URLSearchParams({view:personId||leadId?"all":view,mode:nextMode,page:String(page),...(personId?{personId}:{}),...(leadId?{leadId}:{}),
   ...(!personId&&!leadId?{search:query,...(stage?{stage}:{}),...(language?{language}:{}),due}:{})});
  try{const result=await requestPeople(parameters);if(!state.alive||current!==state.serial)return;
   if(result.source==="sheet"){if(nextMode==="demo")throw new PeopleRequestError(409);onSheet(result);return;}
   state.authorized=true;
   setMode(nextMode);
   if(personId||leadId){const row=result.page.items.find(r=>personId?r.personId===personId:r.references.some(ref=>ref.leadId===leadId))??null;setSelected(row?.personId??personId??null);setSelectedRow(row);setData(d=>({...d,authorityEpoch:result.authorityEpoch}));}
   else setData(result);
  }catch(error){if(state.alive&&current===state.serial){const status=error instanceof PeopleRequestError?error.status:503;setFailure(status);if(status===401||status===403){state.authorized=false;setData(d=>({...d,page:{items:[],page:1,pages:1,pageSize:12,total:0}}));setSelectedRow(null);setDrafts(new Map());}}}
  finally{if(state.alive&&current===state.serial)setBusy(false);}
 },[view,mode,query,stage,language,due,onSheet]);
 const fromUrl=useCallback(()=>{locationKey.current=window.location.pathname+window.location.search;const params=new URLSearchParams(window.location.search),value=params.get("personId"),lead=params.get("leadId"),urlMode=params.get("mode")==="demo"?"demo":"live";const id=value&&uuid.test(value)?value:null,leadId=lead&&leadPattern.test(lead)?lead:null;setSelected(id);setFocusedLead(leadId);setSelectedRow(null);void load(1,id??undefined,urlMode,leadId??undefined);},[load]);
 // The ordinary route can be hard-reloaded or opened directly. Popstate, not an
 // anchor jump, restores the selected main view. Drafts stay in authorized memory.
 useEffect(()=>{const state=lifecycle.current;state.alive=true;return()=>{state.alive=false;state.serial++;};},[]);
 useEffect(()=>{
  const key=window.location.pathname+window.location.search;
  if(locationKey.current!==key){locationKey.current=key;queueMicrotask(()=>{if(lifecycle.current.alive)fromUrl();});}
  window.addEventListener("popstate",fromUrl);return()=>window.removeEventListener("popstate",fromUrl);
 },[fromUrl]);
 function select(row:NativeContactRow|null){const url=new URL(window.location.href);url.searchParams.delete("leadId");if(row)url.searchParams.set("personId",row.personId);else url.searchParams.delete("personId");if(mode==="demo")url.searchParams.set("mode","demo");else url.searchParams.delete("mode");window.history.pushState(null,"",url);locationKey.current=url.pathname+url.search;setFocusedLead(null);setSelected(row?.personId??null);setSelectedRow(row);if(!row)void load(data.page.page);}
 function switchMode(next:"live"|"demo"){const url=new URL(window.location.href);url.searchParams.delete("leadId");url.searchParams.delete("personId");if(next==="demo")url.searchParams.set("mode","demo");else url.searchParams.delete("mode");window.history.pushState(null,"",url);locationKey.current=url.pathname+url.search;setFocusedLead(null);setSelected(null);void load(1,undefined,next);}
 const denied=failure===401||failure===403;
 return <section className="lsu-native-people" aria-busy={busy}>
  {failure!==null&&<div className="lsw-alert" role="alert"><p>{failure===401?text("Your session ended. Sign in to continue.","פג תוקף החיבור. יש להיכנס מחדש."):failure===403?text("This account cannot access the practitioner directory.","לחשבון הזה אין גישה לרשימת המטפל/ת."):failure===409?text("Contact records are being reconciled. No fallback data or changes were used.","רשומות אנשי הקשר נמצאות בהתאמה. לא הוצגו נתונים חלופיים ולא בוצעו שינויים."):text("The current records could not be loaded. No unrefreshed records are shown. Your authorized draft remains in this session.","לא ניתן לטעון את הרשומות העדכניות. רשומות שלא רועננו אינן מוצגות. הטיוטה המורשית שלך נשמרת בחיבור הנוכחי.")}</p>{failure===401?<a className="lsw-button lsw-button--secondary" href={loginHref(locale,window.location.pathname+window.location.search)}>{text("Sign in","כניסה")}</a>:!denied&&<button className="lsw-button lsw-button--secondary" onClick={()=>void load(data.page.page,focusedLead?undefined:selected??undefined,mode,focusedLead??undefined)}>{text("Retry","ניסיון חוזר")}</button>}</div>}
  {!denied&&(selected||focusedLead?<><nav aria-label={text("Person context","הקשר איש קשר")} className="lsw-breadcrumbs"><button className="lsw-button lsw-button--quiet" onClick={()=>select(null)}>{text("People","אנשים")}</button><span aria-current="page">{selectedRow?.displayName??text("Person","איש קשר")}</span></nav>
    {selectedRow?<NativePerson key={selectedRow.personId} row={selectedRow} epoch={data.authorityEpoch} locale={locale} draft={drafts.get(selectedRow.personId)}
     remember={(fields,version,pending,conflict)=>{if(lifecycle.current.alive&&lifecycle.current.authorized)setDrafts(previous=>new Map(previous).set(selectedRow.personId,{fields,version,pending:pending??null,conflict:conflict??false}));}} denied={status=>{lifecycle.current.authorized=false;lifecycle.current.serial++;setBusy(false);setFailure(status);setSelectedRow(null);setDrafts(new Map());}}/>:!busy&&failure===null&&<p role="status">{text("This person is not in the authorized view.","איש הקשר אינו נמצא בתצוגה המורשית.")}</p>}</>:
   <><div className="lsw-section-header"><span>{data.page.total} {text("people","אנשים")}</span>{mode==="demo"?<button className="lsw-button lsw-button--secondary" disabled={busy} onClick={()=>switchMode("live")}>{text("Return to live app","חזרה ליישום החי")}</button>:<button className="lsw-button lsw-button--quiet" disabled={busy} onClick={()=>switchMode("demo")}>{text("DEMO records","רשומות DEMO")}</button>}</div>
    {mode==="demo"&&<p role="status">{text("Clearly marked synthetic records. Real sending, billing and booking effects are blocked.","רשומות סינתטיות מסומנות. שליחה, חיוב וקביעת תורים אמיתיים חסומים.")}</p>}
    <form className="lsw-card lsu-people-toolbar" onSubmit={e=>{e.preventDefault();void load(1);}} aria-label={text("Search and filters","חיפוש ומסננים")}>
     <label className="lsw-field">{text("Search name, phone or email","חיפוש לפי שם, טלפון או דוא״ל")}<input className="lsw-input" type="search" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)}/></label>
     <label className="lsw-field">{text("Exact stage","שלב מדויק")}<input className="lsw-input" maxLength={120} value={stage} onChange={e=>setStage(e.target.value)}/></label>
     <label className="lsw-field">{text("Language","שפה")}<select className="lsw-input" value={language} onChange={e=>setLanguage(e.target.value)}><option value="">{text("All","הכול")}</option><option value="he">עברית</option><option value="en">English</option></select></label>
     <label className="lsw-field">{text("Follow-up","המשך טיפול")}<select className="lsw-input" value={due} onChange={e=>setDue(e.target.value)}><option value="any">{text("Any date","כל המועדים")}</option><option value="today">{text("Today","היום")}</option><option value="overdue">{text("Overdue","באיחור")}</option></select></label>
     <button className="lsw-button lsw-button--primary" disabled={busy}>{text("Apply filters","הצגת המסננים")}</button>
    </form>
    <div className="lsu-native-table"><table><caption>{text("People and next actions","אנשים והפעולה הבאה")}</caption><thead><tr>{[text("Person","איש קשר"),text("Status","מצב"),text("Next action","הפעולה הבאה"),text("Follow-up","המשך טיפול")].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{data.page.items.map(row=><tr key={row.personId}><td><button className="lsw-button lsw-button--quiet" onClick={()=>select(row)}>{row.displayName}</button>{row.mode==="demo"&&<span> DEMO</span>}</td><td>{row.stage}</td><td>{row.nextAction??"—"}</td><td>{row.followUpDate??"—"}</td></tr>)}</tbody></table></div>
    <div className="lsu-people-results lsu-native-cards">{data.page.items.map(row=><button type="button" className="lsw-card lsu-person-row" key={row.personId} onClick={()=>select(row)}><strong>{row.displayName}</strong><span>{row.identityKind==="minor"?text("Child","ילד/ה"):text("Adult / contact","מבוגר/ת / איש קשר")} · {row.stage} {row.mode==="demo"&&"· DEMO"}</span><span>{row.nextAction??"—"}</span><span>{row.followUpDate??"—"}</span></button>)}</div>
    {!busy&&failure===null&&!data.page.total&&<p className="lsw-empty">{text("No people match these filters.","אין אנשים שמתאימים למסננים.")}</p>}
    <nav className="lsw-actions" aria-label={text("Pagination","דפדוף")}><button className="lsw-button lsw-button--secondary" disabled={busy||data.page.page<=1} onClick={()=>void load(data.page.page-1)}>{text("Previous","הקודם")}</button><span>{data.page.page} / {data.page.pages}</span><button className="lsw-button lsw-button--secondary" disabled={busy||data.page.page>=data.page.pages} onClick={()=>void load(data.page.page+1)}>{text("Next","הבא")}</button></nav>
   </>)}
 </section>;
}
function NativePerson({row,epoch,locale,draft,remember,denied}:{row:NativeContactRow;epoch:number;locale:Locale;draft:Draft|undefined;remember:(f:AdministrativeFields,v:number,pending?:PeopleEdit|null,conflict?:boolean)=>void;denied:(s:number)=>void}){
 const text=(en:string,he:string)=>locale==="he"?he:en;
 const [fields,setFields]=useState(draft?.fields??pick(row)),[version,setVersion]=useState(draft?.version??row.version),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[unknown,setUnknown]=useState(!!draft?.pending),[conflict,setConflict]=useState(draft?.conflict??false),[latest,setLatest]=useState<{fields:AdministrativeFields;version:number}|null>(null);
 const pending=useRef<PeopleEdit|null>(draft?.pending??null),guard=useRef(false);
 function edit(patch:Partial<AdministrativeFields>){const f={...fields,...patch};setFields(f);if(version!==null)remember(f,version,pending.current,conflict);}
 async function save(){if(guard.current||version===null||conflict)return;
  let op:PeopleEdit;try{op=pending.current??peopleEdit({action:"update",personId:row.personId,expectedEpoch:epoch,expectedVersion:version,operationId:crypto.randomUUID(),fields});}
  catch{setMessage(text("Check the stage, date and field lengths. Your draft is preserved.","יש לבדוק את השלב, התאריך ואורך השדות. הטיוטה שלך נשמרה."));return;}
  guard.current=true;setBusy(true);setMessage("");
  try{pending.current=op;remember(fields,version,op,conflict);
   const s=await sessionInfo(),r=await fetch("/api/private/contact-profiles",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{"content-type":"application/json","x-csrf-token":s.csrfToken},body:JSON.stringify(op)});
   if(r.status===401||r.status===403){denied(r.status);return;}
   if(r.status===409){pending.current=null;remember(fields,version,null,true);setUnknown(false);setConflict(true);setMessage(text("A newer version or changed contact authority prevents this save. Your draft is preserved.","גרסה חדשה או שינוי בבעלות על הרשומות מונעים שמירה. הטיוטה שלך נשמרה."));return;}
   if(r.status===400){pending.current=null;remember(fields,version,null,false);setUnknown(false);setMessage(text("Check the stage, date and field lengths. Your draft is preserved.","יש לבדוק את השלב, התאריך ואורך השדות. הטיוטה שלך נשמרה."));return;}
   const b=await r.json();if(!r.ok||!b?.ok||!Number.isSafeInteger(b.data?.version)||b.data.personId!==row.personId||b.data.authorityEpoch!==epoch)throw Error("UNCONFIRMED");
   setFields(op.fields);setVersion(b.data.version);remember(op.fields,b.data.version,null,false);pending.current=null;setUnknown(false);setMessage(text("Saved in the native contact record.","נשמר ברשומת איש הקשר המקומית."));
  }catch(error){if(error instanceof IdentityClientError&&["UNAUTHENTICATED","FORBIDDEN"].includes(error.code)){denied(error.code==="UNAUTHENTICATED"?401:403);return;}setUnknown(!!pending.current);setMessage(text("The save could not be confirmed. Your draft remains here. Retry the same operation; do not send anything.","לא ניתן לאשר את השמירה. הטיוטה נשארה כאן. יש לנסות שוב את אותה פעולת שמירה; לא נשלחת הודעה."));}
  finally{guard.current=false;setBusy(false);}}
 async function check(){setBusy(true);try{const q=new URLSearchParams({personId:row.personId,expectedEpoch:String(epoch)}),r=await fetch("/api/private/contact-profiles?"+q,{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});if(r.status===401||r.status===403){denied(r.status);return;}const b=await r.json();if(!r.ok||!b?.ok||b.data?.personId!==row.personId||b.data?.authorityEpoch!==epoch)throw Error("READ_FAILED");const current=peopleEdit({action:"update",personId:row.personId,expectedEpoch:epoch,expectedVersion:b.data.version,operationId:crypto.randomUUID(),fields:{stage:b.data.stage,nextAction:b.data.nextAction,followUpDate:b.data.followUpDate,notes:b.data.notes}});setLatest({fields:current.fields,version:current.expectedVersion});}catch{setMessage(text("The saved record could not be read. Your draft is still preserved.","לא ניתן לקרוא את הרשומה השמורה. הטיוטה עדיין נשמרה."));}finally{setBusy(false);}}
 return <article className="lsw-stack"><h2>{row.displayName}</h2><p>{row.mode==="demo"?"DEMO · ":""}{fields.stage}</p>
  <div className="lsw-actions">{row.caseLinks?.map(c=><a key={c.caseId} className="lsw-button lsw-button--secondary" href={`/${locale}/app/cases/${encodeURIComponent(c.caseId)}`}>{text("Open client case","פתיחת תיק לקוח")} · {c.state}</a>)}</div>
  <details className="lsw-details"><summary>{text("Recorded inquiries and verified journey facts","פניות מתועדות ועובדות מאומתות בתהליך")}</summary>{row.references.map(ref=><section key={ref.leadId} className="lsw-card"><p dir="ltr">{ref.phone||ref.email||ref.leadId}</p><p>{ref.journey.journeyState} · {text("Payment verified","תשלום מאומת")}: {ref.journey.paymentVerified?text("Yes","כן"):text("No","לא")} · {text("Booking confirmed","מועד מאושר")}: {ref.journey.bookingConfirmed?text("Yes","כן"):text("No","לא")}</p>{normalizePhone(ref.phone)&&row.mode!=="demo"&&!row.doNotContact&&<a className="lsw-button lsw-button--secondary" href={`https://wa.me/${normalizePhone(ref.phone)!.slice(1)}`} target="_blank" rel="noopener noreferrer">{text("Open WhatsApp","פתיחת WhatsApp")}</a>}{row.doNotContact&&<p className="lsw-help">{text("Do not contact: communication actions are unavailable.","אין ליצור קשר: פעולות תקשורת אינן זמינות.")}</p>}<p className="lsw-help">{text("Imported payment/booking labels are not verification. External communications stay separate from clinical notes.","תוויות תשלום או הזמנה שיובאו אינן אימות. תקשורת חיצונית נפרדת מהערות טיפוליות.")}</p></section>)}</details>
  {version!==null&&<details className="lsw-details"><summary>{text("Follow-up and administrative notes","המשך טיפול והערות מנהליות")}</summary><form className="lsw-stack" onSubmit={e=>{e.preventDefault();void save();}}>
   <label className="lsw-field">{text("Stage","שלב")}<input className="lsw-input" required maxLength={120} value={fields.stage} disabled={busy||unknown} onChange={e=>edit({stage:e.target.value})}/></label>
   <label className="lsw-field">{text("Next action","הפעולה הבאה")}<input className="lsw-input" maxLength={500} value={fields.nextAction??""} disabled={busy||unknown} onChange={e=>edit({nextAction:e.target.value||null})}/></label>
   <label className="lsw-field">{text("Follow-up date","תאריך המשך טיפול")}<input className="lsw-input" type="date" value={fields.followUpDate??""} disabled={busy||unknown} onChange={e=>edit({followUpDate:e.target.value||null})}/></label>
   <label className="lsw-field">{text("Administrative note","הערה מנהלית")}<textarea className="lsw-input" maxLength={5000} value={fields.notes} disabled={busy||unknown} onChange={e=>edit({notes:e.target.value})}/></label>
   <button className="lsw-button lsw-button--primary" disabled={busy||conflict}>{unknown?text("Retry the same save","ניסיון נוסף לאותה שמירה"):text("Save follow-up","שמירת המשך טיפול")}</button>
  </form>{conflict&&<button className="lsw-button lsw-button--secondary" disabled={busy} onClick={()=>void check()}>{text("Compare saved version","השוואה לגרסה השמורה")}</button>}
  {latest&&<section className="lsw-card"><h3>{text("Saved version","גרסה שמורה")} {latest.version}</h3><p>{latest.fields.stage} · {latest.fields.nextAction} · {latest.fields.followUpDate}</p><pre style={{whiteSpace:"pre-wrap"}}>{latest.fields.notes}</pre><button className="lsw-button lsw-button--secondary" onClick={()=>{setFields(latest.fields);setVersion(latest.version);remember(latest.fields,latest.version);setConflict(false);setLatest(null);setMessage("");}}>{text("Use saved version","שימוש בגרסה השמורה")}</button><button className="lsw-button lsw-button--secondary" onClick={()=>{setVersion(latest.version);remember(fields,latest.version);setConflict(false);setLatest(null);setMessage(text("Your draft is retained. Review it before saving against the current version.","הטיוטה נשמרה. יש לעיין בה לפני שמירה מול הגרסה העדכנית."));}}>{text("Keep my draft using this version","שמירת הטיוטה מול גרסה זו")}</button></section>}
  </details>}
  <p className="lsw-save-result" role="status">{message}</p>
 </article>;
}
