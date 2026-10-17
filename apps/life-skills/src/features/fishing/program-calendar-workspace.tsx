"use client";
import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import type {Locale} from "../../lib/locale.ts";
import {Button,Select} from "../../ui/workspace/controls.tsx";
import {calendarRead,calendarWrite,CalendarClientError} from "../calendar/client.ts";
import {loginHref} from "../identity/login-return.ts";
import {FishingStagePlan} from "../fishing-stage/plan.tsx";
import {FishingParentAttendanceSummary} from "../fishing-stage/parent-attendance-summary.tsx";
import type {StageCommand,OccurrenceProjection} from "../fishing-stage/contract.ts";
import type {NativeProgramCommandIntent} from "./native-program-contract.ts";
import {FishingCalendarEditor} from "./program-calendar-editor.tsx";
import {fishingCalendarChoicesSchema,fishingCalendarSearch,fishingCalendarSelectionQuery,selectedFishingStage,fishingCalendarTimelineSchema,type FishingCalendarChoices,type FishingCalendarPlan,type FishingCalendarSelection,type FishingCalendarEvent} from "./program-calendar-contract.ts";
import styles from "./program-calendar.module.css";

export function FishingCalendarEntry({item,locale,compact,onOpen}:{item:FishingCalendarEvent;locale:Locale;compact:boolean;onOpen:((item:FishingCalendarEvent)=>void)|undefined}){
 const he=locale==="he",status={published:he?"מתוכנן":"Scheduled",completed:he?"הושלם":"Completed",cancelled:he?"בוטל":"Cancelled"}[item.state];
 const formatted=new Intl.DateTimeFormat(he?"he-IL":"en-US",{timeZone:"America/New_York",...(compact?{}:{year:"numeric" as const,month:"short" as const,day:"numeric" as const}),hour:"2-digit",minute:"2-digit",timeZoneName:"short"}).format(new Date(item.startsAt));
 return <article className={styles.event} data-fishing-occurrence-id={item.id}><strong>{item.label} · {he?"מפגש":"Session"} {item.ordinal}</strong><time dateTime={item.startsAt}>{formatted}</time><span>{status} · America/New_York</span>{!compact&&<p>{item.location}</p>}<Button variant="secondary" disabled={!onOpen} onClick={()=>onOpen?.(item)}>{he?"פתיחת פרטי מפגש":"Open session details"}</Button></article>;
}
/** Independent native layer: a failed clinical read must not hide fishing, and
 * a failed native read must never be replaced with clinical/sample records. */
export function useFishingCalendarTimeline({enabled,role,from,to,search,refresh}:{enabled:boolean;role:string;from:string;to:string;search:string;refresh:number}){
 const key=JSON.stringify([enabled,role,from,to,search,refresh]),[state,setState]=useState<{key:string;items:FishingCalendarEvent[];failure:boolean}|null>(null),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let live=true;if(!enabled)return;const timer=window.setTimeout(()=>{
   const params=new URLSearchParams(search),query=new URLSearchParams({from,to});for(const id of params.getAll("learnerId"))query.append("learnerId",id);
   void calendarRead<unknown>("fishing/timeline?"+query).then(data=>{const value=fishingCalendarTimelineSchema.parse(data);if(live)setState({key,items:value.items,failure:false});}).catch(()=>{if(live)setState({key,items:[],failure:true});});
  },0);return()=>{live=false;window.clearTimeout(timer);};
 },[enabled,key,from,to,search,retry]);
 return {items:enabled&&state?.key===key?state.items:[],loading:enabled&&state?.key!==key,failure:enabled&&state?.key===key&&state.failure,retry:()=>{setState(null);setRetry(n=>n+1);}};
}

const contextKeys=["learnerId","enrollmentId","cohortId","stageId","stage"] as const;
const contextKey=(role:string,p:URLSearchParams)=>JSON.stringify([role,...contextKeys.map(k=>p.getAll(k))]);
type Read={key:string;choices:FishingCalendarChoices;plan:FishingCalendarPlan|null};
type Pending={key:string;body:{selection:FishingCalendarSelection;command:StageCommand;intent:NativeProgramCommandIntent};serialized:string;id:string};
/** A retained authenticated Calendar section, not another route or a role switch. */
export function FishingCalendarWorkspace({locale,role,enabled,onDirtyChange,onSaved}:{locale:Locale;role:"practitioner"|"parent"|"child"|"adult_client";enabled:boolean;onDirtyChange:(dirty:boolean)=>void;onSaved:()=>void}){
 const router=useRouter(),pathname=usePathname(),search=useSearchParams().toString(),scope=contextKey(role,new URLSearchParams(search));
 const t=(en:string,he:string)=>locale==="he"?he:en,active=enabled&&role!=="adult_client";
 const [read,setRead]=useState<Read|null>(null),[loading,setLoading]=useState(false),[failure,setFailure]=useState(""),[refresh,setRefresh]=useState(0),[lessonLearner,setLessonLearner]=useState("");
 const [editor,setEditor]=useState<string|null>(null),[dirty,setDirty]=useState(false),[pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 const [contextState,setContextState]=useState({scope,role,active}),[blockedScope,setBlockedScope]=useState<string|null>(null);
 const inFlight=useRef(false),currentScope=useRef(scope),href=useRef(pathname+"?"+search),dirtyRef=useRef(false),pendingRef=useRef<Pending|null>(null),blocked=useRef(false),receipt=useRef<HTMLParagraphElement>(null);
 const openedContext=useRef("");
 if(contextState.role!==role||contextState.active!==active||contextState.scope!==scope&&blockedScope===null){
  setContextState({scope,role,active});setRead(null);setLoading(false);setEditor(null);setDirty(false);setPending(null);setSaved(false);setFailure("");setLessonLearner("");if(blockedScope!==null)setBlockedScope(null);
 }
 if(blockedScope!==null&&scope===blockedScope)setBlockedScope(null);
 const value=read&&(read.key===scope||blockedScope===read.key&&read.choices.role===role)?read:null,plan=value?.plan??null,choices=value?.choices??null,locked=busy||pending!==null||blockedScope!==null;
 useLayoutEffect(()=>{currentScope.current=blockedScope??scope;dirtyRef.current=dirty;pendingRef.current=pending;},[scope,blockedScope,dirty,pending]);
 useEffect(()=>{onDirtyChange(dirty||pending!==null);return()=>onDirtyChange(false);},[dirty,pending,onDirtyChange]);
 useEffect(()=>{
  const pop=()=>{const target=new URL(window.location.href);if(contextKey(role,target.searchParams)===currentScope.current)return;
   if((dirtyRef.current||pendingRef.current)&&!window.confirm(locale==="he"?"לצאת מההקשר הנוכחי? טיוטה שלא נשמרה תאבד. יציאה אינה מבטלת פעולה שנשלחה.":"Leave this context? Unsaved input will be lost. Leaving does not undo a submitted action.")){blocked.current=true;setBlockedScope(currentScope.current);router.replace(href.current,{scroll:false});}
  };window.addEventListener("popstate",pop);return()=>window.removeEventListener("popstate",pop);
 },[role,locale,router]);
 useLayoutEffect(()=>{
  if(blocked.current&&pathname+"?"+search!==href.current)return;blocked.current=false;
  href.current=pathname+"?"+search;
 },[pathname,search]);
 useEffect(()=>{
  let live=true;if(!active)return;
  const timer=window.setTimeout(()=>{
   if(!live||blocked.current)return;setLoading(true);setFailure("");
   const params=new URLSearchParams(search),context=new URLSearchParams();for(const learner of params.getAll("learnerId"))context.append("learnerId",learner);
   void (async()=>{
   const choices=fishingCalendarChoicesSchema.parse(await calendarRead<unknown>("fishing/context"+(context.size?"?"+context:"")));
   if(choices.role!==role)throw new CalendarClientError("FORBIDDEN");
   let plan:FishingCalendarPlan|null=null;
   if(choices.availability==="ready"&&["stageId","cohortId","stage","enrollmentId"].some(k=>params.has(k))){
    const selected=new URLSearchParams();for(const key of contextKeys)for(const v of params.getAll(key))selected.append(key,v);
    let selection:FishingCalendarSelection;try{selection=fishingCalendarSelectionQuery(selected);}catch{throw new CalendarClientError("INVALID_REQUEST");}
    if(!selectedFishingStage(choices,selection))throw new CalendarClientError("NOT_FOUND");
    plan=await calendarRead<FishingCalendarPlan>("fishing/plan?"+fishingCalendarSearch(selection)+(role==="practitioner"&&lessonLearner?"&lessonLearnerId="+encodeURIComponent(lessonLearner):""));
    if(JSON.stringify(plan.selection)!==JSON.stringify(selection)||plan.view&&plan.view.role!==role)throw new CalendarClientError("UNAVAILABLE");
   }
   if(live&&currentScope.current===scope)setRead({key:scope,choices,plan});
  })().catch(error=>{
   if(!live||currentScope.current!==scope)return;const code=error instanceof CalendarClientError?error.code:"UNAVAILABLE";setFailure(code);
   if(["UNAUTHENTICATED","FORBIDDEN","NOT_FOUND"].includes(code)){setRead(null);setEditor(null);setDirty(false);setPending(null);setSaved(false);setLessonLearner("");}
   }).finally(()=>{if(live&&currentScope.current===scope)setLoading(false);});
  },0);
  return()=>{live=false;window.clearTimeout(timer);};
 },[active,role,scope,search,refresh,lessonLearner]);
 useEffect(()=>{if(saved)receipt.current?.focus();},[saved]);
 useEffect(()=>{if(!plan)return;const key=fishingCalendarSearch(plan.selection);if(openedContext.current!==key){openedContext.current=key;const heading=document.getElementById("fishing-calendar-heading");heading?.scrollIntoView({block:"start"});heading?.focus({preventScroll:true});}},[plan]);
 if(!active)return null;
 const leaveMessage=t("Leave unsaved fishing work? Leaving does not undo a submitted operation.","לצאת מעבודת דיג שלא נשמרה? יציאה אינה מבטלת פעולה שנשלחה.");
 function navigate(selection:FishingCalendarSelection|null,learnerId:string|null){
  if(locked||dirty&&!window.confirm(leaveMessage))return;
  const query=new URLSearchParams(search);for(const key of contextKeys)query.delete(key);query.set("fishing","1");
  if(selection)for(const [key,value]of new URLSearchParams(fishingCalendarSearch(selection)))query.set(key,value);else if(learnerId)query.set("learnerId",learnerId);
  setRead(null);setEditor(null);setDirty(false);setPending(null);setSaved(false);router.replace(pathname+"?"+query,{scroll:false});
 }
 async function execute(action:Pending){
  if(inFlight.current||action.key!==currentScope.current)return;inFlight.current=true;setBusy(true);setFailure("");setSaved(false);
  try{
   if(JSON.stringify(action.body)!==action.serialized)throw new CalendarClientError("INVALID_REQUEST");
   await calendarWrite("fishing/command",JSON.parse(action.serialized),action.id);
   if(action.key!==currentScope.current)return;setPending(null);setEditor(null);setDirty(false);setSaved(true);setRefresh(n=>n+1);onSaved();
  }catch(error){
   if(action.key!==currentScope.current)return;const code=error instanceof CalendarClientError?error.code:"UNAVAILABLE";setFailure(code);
   if(!["UNAVAILABLE","INTERNAL"].includes(code))setPending(null);
   if(["UNAUTHENTICATED","FORBIDDEN","NOT_FOUND"].includes(code)){setRead(null);setEditor(null);setDirty(false);setPending(null);}
  }finally{inFlight.current=false;setBusy(false);}
 }
 function save(command:StageCommand,intent:NativeProgramCommandIntent){
  if(!plan||locked)return;const body={selection:plan.selection,command,intent},action={key:scope,body,serialized:JSON.stringify(body),id:command.operationId};setPending(action);void execute(action);
 }
 function familyAction(command:Omit<Extract<StageCommand,{action:"notice"}>,"operationId"|"expectedRevision">|Omit<Extract<StageCommand,{action:"request_makeup"}>,"operationId"|"expectedRevision">){
  if(!plan?.view||locked)return;const operationId=crypto.randomUUID();save({...command,operationId,expectedRevision:plan.view.revision},{operationId,resources:[],makeupFitDecisionId:null});
 }
 const next=plan?.view?.occurrences.find(o=>o.id===plan.view?.nextOccurrenceId),format=(instant:string)=>new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(instant));
 const errorText=failure==="UNAUTHENTICATED"?t("Your session ended. Sign in to verify current access.","הכניסה פגה. היכנסו כדי לאמת הרשאה נוכחית."):failure==="FORBIDDEN"||failure==="NOT_FOUND"?t("This context is no longer available to this account. Reload your authorized choices.","ההקשר אינו זמין עוד לחשבון זה. טענו את האפשרויות המורשות."):failure==="CONFLICT"?t("The saved version, capacity or approval changed. Reload the current plan; your edit is retained until you choose a revision.","הגרסה, הקיבולת או האישור השתנו. טענו את התוכנית הנוכחית; העריכה נשמרת עד לבחירת גרסה."):failure==="INVALID_REQUEST"?t("Check the selected context and required fields. Nothing further was sent.","בדקו את ההקשר ושדות החובה. לא נשלחה פעולה נוספת."):t("The fishing plan could not be verified. Other calendar items remain separate. Keep your draft and retry.","לא ניתן לאמת את תוכנית הדיג. שאר פריטי היומן זמינים בנפרד. שמרו את הטיוטה במסך ונסו שוב.");
 return <section className={styles.workspace} aria-labelledby="fishing-calendar-heading" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <h2 id="fishing-calendar-heading" tabIndex={-1}>{t("Fishing academy plan","תוכנית האקדמיה לדיג")}</h2>
  {loading&&<p role="status">{t("Loading the current authorized plan…","טוען תוכנית מורשית עדכנית…")}</p>}
  {pending&&!busy&&<div role="alert"><p>{t("The save outcome is not confirmed. Keep this page open and retry the exact operation.","תוצאת השמירה אינה מאומתת. השאירו את המסך פתוח ונסו שוב את אותה פעולה.")}</p><Button variant="secondary" onClick={()=>void execute(pending)}>{t("Retry the same operation","ניסיון חוזר לאותה פעולה")}</Button></div>}
  {failure&&!pending&&<div role="alert"><p>{errorText}</p>{failure==="UNAUTHENTICATED"?<a href={loginHref(locale,pathname+"?"+search)}>{t("Sign in","כניסה")}</a>:<Button variant="secondary" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>{t("Reload current access and plan","טעינת הרשאות ותוכנית עדכניות")}</Button>}</div>}
  {busy&&<p role="status">{t("Saving the exact selected operation…","שומר את הפעולה המדויקת שנבחרה…")}</p>}
  {saved&&<p ref={receipt} tabIndex={-1} role="status" className={styles.receipt}>{t("Saved in the app. No message, charge or enrollment was created.","נשמר במערכת. לא נוצרו הודעה, חיוב או רישום לקורס.")}</p>}
  {choices?.availability==="not_configured"&&<p role="status">{t("The native fishing calendar is not configured for this runtime. No sample schedule is substituted.","יומן הדיג המקורי אינו מוגדר בסביבה זו. לא מוצג במקומו לוח לדוגמה.")}</p>}
  {choices?.availability==="ready"&&<>
   <div className={styles.context}>
    {role==="parent"&&<Select id="fishing-learner" label={t("Authorized child","ילד מורשה")} value={choices.selectedLearnerId??""} disabled={locked} onChange={e=>navigate(null,e.target.value||null)}><option value="">{t("Select a child","בחירת ילד")}</option>{choices.children.map(c=><option key={c.learnerId} value={c.learnerId}>{c.displayName}</option>)}</Select>}
    {(role==="practitioner"||choices.selectedLearnerId)&&<Select id="fishing-stage" label={t("Stage enrollment","רישום לשלב")} value={plan?plan.choice.enrollmentId??plan.choice.stageId:""} disabled={locked} onChange={e=>{const choice=choices.stages.find(c=>(c.enrollmentId??c.stageId)===e.target.value);navigate(choice?{learnerId:choice.learnerId,enrollmentId:choice.enrollmentId,reference:{cohortId:choice.cohortId,stageId:choice.stageId,stage:choice.stage}}:null,choices.selectedLearnerId);}}><option value="">{t("Select an authorized stage","בחירת שלב מורשה")}</option>{choices.stages.map(c=><option key={c.enrollmentId??c.stageId} value={c.enrollmentId??c.stageId}>{c.label} · {t("Stage","שלב")} {c.stage}</option>)}</Select>}
   </div>
   {role==="parent"&&!choices.children.length&&<p>{t("No current child relationship is available. No child account or case will be created here.","לא קיים קשר ילד מורשה נוכחי. לא ייווצרו כאן חשבון ילד או תיק.")}</p>}
   {(role==="practitioner"||choices.selectedLearnerId)&&!choices.stages.length&&<p>{t("No authorized stage enrollment or operator cohort is available in this context. Payment alone does not grant access.","לא זמינים רישום מורשה לשלב או קבוצה בניהולכם בהקשר זה. תשלום לבדו אינו מעניק גישה.")}</p>}
  </>}
  {plan&&<>
   <div className={styles.next}><h3>{t("Next fishing session","מפגש הדיג הבא")}</h3>{next?.time.kind==="scheduled"?<><p><time dateTime={next.time.startsAt}>{format(next.time.startsAt)}</time> · America/New_York</p><p>{next.location}</p>{next.equipment&&<details><summary>{t("Equipment and preparation","ציוד והכנה")}</summary><p>{next.equipment}</p></details>}</>:<p>{t("No upcoming date is published. Undated syllabus entries remain in the full plan.","טרם פורסם מועד קרוב. פריטי תוכנית ללא מועד נשמרים בתוכנית המלאה.")}</p>}</div>
   {role==="parent"&&<p>{t("Parent-assisted use does not require a child device or child account.","שימוש בסיוע הורה אינו דורש מכשיר או חשבון ילד.")}</p>}
   {role==="parent"&&plan.view?.role==="parent"&&plan.view.enrollmentId&&plan.view.enrollmentId===plan.selection.enrollmentId&&<details className={styles.plan} data-fishing-parent-attendance><summary>{t("Attendance and session status","נוכחות ומצב המפגשים")}</summary><FishingParentAttendanceSummary view={plan.view} locale={locale}/></details>}
   {role==="practitioner"&&<Button variant="secondary" disabled={locked||loading} onClick={()=>{if(dirty&&!window.confirm(leaveMessage))return;setDirty(false);setEditor("");}}>{plan.view?t("Manage this stage","ניהול השלב"):t("Prepare a twelve-session draft","הכנת טיוטה ל־12 מפגשים")}</Button>}
   {plan.view&&<details className={styles.plan}><summary>{t("Full twelve-session plan and received notices","התוכנית המלאה ל־12 מפגשים והדיווחים שהתקבלו")}</summary><fieldset disabled={locked} onChange={()=>{if(role==="parent")setDirty(true);}}><FishingStagePlan view={plan.view} locale={locale}
    {...(role==="practitioner"?{onEdit:(o:OccurrenceProjection)=>{if(locked||dirty&&!window.confirm(leaveMessage))return;setDirty(false);setEditor(o.id);}}:{})}
    {...(role==="parent"?{onNotice:(o:OccurrenceProjection,reason:"ordinary_absence"|"unavoidable")=>familyAction({action:"notice",occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason}),onRequestMakeup:(id:string)=>familyAction({action:"request_makeup",noticeId:id})}:{})}
    lessonHref={id=>plan.lessonLearnerId===(role==="practitioner"?lessonLearner||null:plan.selection.learnerId)?plan.lessonLinks.find(l=>l.occurrenceId===id)?.href??null:null}/></fieldset></details>}
   {role==="practitioner"&&plan.operator.roster.length>0&&<Select id="fishing-lesson-learner" label={t("Participant for existing Materials access","משתתף לגישה קיימת לחומרים")} value={lessonLearner} disabled={locked} onChange={e=>setLessonLearner(e.target.value)}><option value="">{t("Select an authorized participant","בחירת משתתף מורשה")}</option>{plan.operator.roster.map(r=><option key={r.enrollmentId} value={r.learnerId}>{r.displayName}</option>)}</Select>}
   {plan.view&&!plan.lessonLinks.length&&<p className={styles.note}>{t("Lesson links appear only when the existing Materials catalog and access controls are available. Enrollment creates no lesson grant.","קישורי שיעור מופיעים רק כשהקטלוג ובקרת הגישה הקיימים זמינים. רישום לקורס אינו יוצר הרשאה לשיעור.")}</p>}
   {role==="practitioner"&&editor!==null&&<div className={styles.editor}><FishingCalendarEditor key={(value?.key??scope)+":"+editor} data={plan} locale={locale} initialOccurrenceId={editor} locked={locked||loading} onDirty={setDirty} onSave={save} onCancel={()=>{if(locked||dirty&&!window.confirm(leaveMessage))return;setEditor(null);setDirty(false);}}/></div>}
  </>}
 </section>;
}
