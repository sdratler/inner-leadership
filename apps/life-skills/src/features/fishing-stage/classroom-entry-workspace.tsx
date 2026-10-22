"use client";
import {useEffect,useId,useReducer,type Dispatch} from "react";
import type {Locale} from "../../lib/locale.ts";
import {Button,Select} from "../../ui/workspace/controls.tsx";
import {calendarRead,CalendarClientError} from "../calendar/client.ts";
import {sessionInfo,IdentityClientError} from "../identity/client.ts";
import {ClassroomEntryError,classroomEntryReducer,classroomEntrySearch,initialClassroomEntry,readClassroomEntry,type ClassroomEntryAction,type ClassroomEntryFailure,type ClassroomEntryRequest,type ClassroomEntryState} from "./classroom-entry-contract.ts";
import styles from "./classroom-entry.module.css";

const copy={
 en:{title:"Course lessons",intro:"Choose a learner and stage to open a lesson and record work together.",learner:"Learner",chooseLearner:"Choose a learner",stage:"Stage enrollment",chooseStage:"Choose a stage",stageNumber:"Stage",
  loading:"Loading available lessons…",unavailable:"Course lessons are not available here yet.",noLearners:"No learners are available for this account.",noStages:"No stage enrollment is available for this learner.",noLessons:"No lessons are available to open in this stage.",
  failed:"The lesson choices could not be loaded. Reload to try again.",denied:"These lesson choices are no longer available. Reload to check your access.",ended:"Your session ended. Sign in again to view your lessons.",signIn:"Sign in",reload:"Reload choices",session:"Session",open:"Open lesson",version:"Lesson version",published:"Published plan",completed:"Session delivered",cancelled:"Session cancelled"},
 he:{title:"שיעורי הקורס",intro:"בחרו משתתף ושלב כדי לפתוח שיעור ולתעד עבודה משותפת.",learner:"משתתף",chooseLearner:"בחירת משתתף",stage:"רישום לשלב",chooseStage:"בחירת שלב",stageNumber:"שלב",
  loading:"טעינת השיעורים הזמינים…",unavailable:"שיעורי הקורס עדיין אינם זמינים כאן.",noLearners:"אין משתתפים זמינים לחשבון זה.",noStages:"אין רישום לשלב זמין עבור משתתף זה.",noLessons:"אין שיעורים זמינים לפתיחה בשלב זה.",
  failed:"לא ניתן לטעון את רשימת השיעורים. טענו מחדש לניסיון נוסף.",denied:"רשימת השיעורים אינה זמינה עוד. טענו מחדש לבדיקת הגישה.",ended:"הכניסה פגה. היכנסו שוב לצפייה בשיעורים.",signIn:"כניסה",reload:"טעינה מחדש",session:"מפגש",open:"פתיחת שיעור",version:"גרסת השיעור",published:"תוכנית שפורסמה",completed:"המפגש התקיים",cancelled:"המפגש בוטל"},
}as const;
function failureCode(error:unknown):ClassroomEntryFailure{
 if(error instanceof ClassroomEntryError||error instanceof CalendarClientError||error instanceof IdentityClientError){
  if(error.code==="UNAUTHENTICATED"||error.code==="FORBIDDEN"||error.code==="NOT_FOUND")return error.code;
 }return "UNAVAILABLE";
}
/** MAIN mounts this parent-only entry in the existing Materials route behind
 * educationRehearsalEnabled. It owns no route, feature switch or save boundary. */
export function FishingClassroomEntry({locale,initialRequest}:{locale:Locale;initialRequest?:ClassroomEntryRequest}){return <ClassroomEntryLoader key={locale} locale={locale} initialRequest={initialRequest}/>;}
function ClassroomEntryLoader({locale,initialRequest}:{locale:Locale;initialRequest:ClassroomEntryRequest|undefined}){
 const [state,dispatch]=useReducer(classroomEntryReducer,initialRequest,initialClassroomEntry);
 const select=(action:ClassroomEntryAction)=>{
  if(action.type==="learner"||action.type==="stage"){
   const next=classroomEntryReducer(state,action);if(next===state)return;
   const url=new URL(window.location.href);url.search=classroomEntrySearch(next.request,url.search);
   // Replace this chooser entry; Back from the server's lesson href retains it.
   window.history.replaceState(null,"",url);
  }
  dispatch(action);
 };
 useEffect(()=>{
  let live=true;const request=state.request;
  void readClassroomEntry(request,{session:sessionInfo,read:calendarRead},()=>live).then(data=>{
   if(live&&data)dispatch({type:"loaded",generation:request.generation,data});
  }).catch(error=>{if(live)dispatch({type:"failed",generation:request.generation,failure:failureCode(error)});});
  return()=>{live=false;};
 },[state.request]);
 useEffect(()=>{
  const refresh=()=>dispatch({type:"refresh"}),visible=()=>{if(document.visibilityState==="visible")refresh();};
  window.addEventListener("pageshow",refresh);document.addEventListener("visibilitychange",visible);
  return()=>{window.removeEventListener("pageshow",refresh);document.removeEventListener("visibilitychange",visible);};
 },[]);
 return <ClassroomEntryPanel locale={locale} state={state} dispatch={select}/>;
}
/** Closed metadata view, also rendered by the focused static acceptance tests. */
export function ClassroomEntryPanel({locale,state,dispatch}:{locale:Locale;state:ClassroomEntryState;dispatch:Dispatch<ClassroomEntryAction>}){
 const w=copy[locale],id=useId(),ready=state.status==="ready",loading=state.status==="loading";
 const message=state.failure==="UNAUTHENTICATED"?w.ended:state.failure==="FORBIDDEN"||state.failure==="NOT_FOUND"?w.denied:w.failed;
 return <section className={styles.workspace} lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-labelledby={`${id}-heading`}>
  <h2 id={`${id}-heading`}>{w.title}</h2><p>{w.intro}</p>
  {state.status==="failed"&&<div role="alert"><p>{message}</p>{state.failure==="UNAUTHENTICATED"?
   <a className="lsw-button lsw-button--secondary" href={`/${locale}/login?next=${encodeURIComponent(`/${locale}/family/resources`)}`}>{w.signIn}</a>:
   <Button variant="secondary" onClick={()=>dispatch({type:"restart"})}>{w.reload}</Button>}</div>}
  {loading&&<p role="status">{w.loading}</p>}
  {state.children.length>0&&<div className={styles.choices}>
   <Select id={`${id}-learner`} label={w.learner} value={state.request.learnerId??""} onChange={e=>dispatch({type:"learner",learnerId:e.target.value||null})}>
    <option value="">{w.chooseLearner}</option>{state.children.map(child=><option key={child.learnerId} value={child.learnerId}>{child.displayName}</option>)}
   </Select>
   {state.request.learnerId&&state.stages.length>0&&<Select id={`${id}-stage`} label={w.stage} value={state.request.enrollmentId??""} onChange={e=>dispatch({type:"stage",enrollmentId:e.target.value||null})}>
    <option value="">{w.chooseStage}</option>{state.stages.map(stage=><option key={stage.enrollmentId} value={stage.enrollmentId??""}>{stage.label} · {w.stageNumber} {stage.stage}</option>)}
   </Select>}
  </div>}
  {ready&&<>
   {state.availability==="not_configured"?<p>{w.unavailable}</p>:!state.children.length?<p>{w.noLearners}</p>:
    state.request.learnerId&&!state.stages.length?<p>{w.noStages}</p>:state.request.enrollmentId&&!state.lessons.length?<p>{w.noLessons}</p>:null}
   {state.lessons.length>0&&<ol className={styles.lessons}>{state.lessons.map(lesson=><li key={lesson.occurrenceId} className={styles.lesson}>
    <div><h3>{w.session} {lesson.ordinal} · <bdi>{lesson.moduleId}</bdi></h3><p>{w[lesson.state]}</p>
     <details><summary>{w.version}</summary><bdi>{lesson.version}</bdi></details></div>
    <a className="lsw-button lsw-button--secondary" href={lesson.href} aria-label={`${w.open} · ${w.session} ${lesson.ordinal}`} referrerPolicy="no-referrer">{w.open}</a>
   </li>)}</ol>}
   <Button variant="quiet" onClick={()=>dispatch({type:"refresh"})}>{w.reload}</Button>
  </>}
 </section>;
}
