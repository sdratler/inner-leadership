"use client";
import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import type {Locale} from "./types.ts";
import type {SessionDetail,SessionListItem} from "./database.ts";
import {PractitionerSessionDesk,type SessionDeskActions} from "../../ui/revamp/session-desk.tsx";
import {sessionCommand,sessionEnsure,sessionRead} from "./client.ts";
import {SessionConsentPanel} from "./consent-panel.tsx";
import {workspaceHref,type WorkspaceContext} from '../../ui/workspace/navigation-model.ts';

/** A query only selects from the server-authorized list. It never opens,
 * creates, grants or falls back to a different appointment. */
export function visibleSessionAppointments(items:SessionListItem[],appointmentId?:string):SessionListItem[]{return appointmentId?items.filter(item=>item.appointmentId===appointmentId):items;}
export function sessionAppointmentListPath(caseId:string,appointmentId?:string):string{const query=new URLSearchParams({caseId:caseId.toLowerCase()});if(appointmentId)query.set('appointmentId',appointmentId.toLowerCase());return '?'+query.toString();}
export function SessionListWorkspace({locale,caseId,selectedAppointmentId,navigationContext={}}:{locale:Locale;caseId:string;selectedAppointmentId?:string;navigationContext?:WorkspaceContext}){
 const [items,setItems]=useState<SessionListItem[]|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState<string|null>(null),router=useRouter(),he=locale==="he";
 useEffect(()=>{const controller=new AbortController();queueMicrotask(()=>{if(controller.signal.aborted)return;setItems(null);setError(false);void sessionRead<SessionListItem[]>(sessionAppointmentListPath(caseId,selectedAppointmentId),controller.signal).then(value=>{if(!controller.signal.aborted){setItems(value);setError(false);}}).catch(()=>{if(!controller.signal.aborted){setItems(null);setError(true);}});});return()=>controller.abort();},[caseId,selectedAppointmentId]);
 async function open(item:SessionListItem){setBusy(item.appointmentId);try{const id=item.sessionId??(await sessionEnsure(caseId,item.appointmentId)).sessionId;router.push(workspaceHref(locale,`app/cases/${caseId}/sessions/${id}`,caseId,navigationContext));}catch{setError(true);}finally{setBusy(null);}}
 const visible=items?visibleSessionAppointments(items,selectedAppointmentId):null;
 return <main className="lsw-main" lang={locale} dir={he?"rtl":"ltr"}>
  <h1>{he?"מפגשים והקלטות":"Sessions & recordings"}</h1>
  <p>{he?"הקלטה, תמלול, ניתוח ותצפיות נשארים פרטיים למטפל. רק עדכון שאושר במפורש משותף.":"Recording, transcript, analysis and observations remain practitioner-private. Only an explicitly approved update is shared."}</p>
  {selectedAppointmentId&&<p><a className="lsw-button lsw-button--secondary" href={workspaceHref(locale,`app/cases/${caseId}/sessions`,caseId,navigationContext)}>{he?"חזרה לכל המפגשים":"Return to all sessions"}</a></p>}
  {error&&<p role="alert">{he?"לא ניתן לאשר את המצב. יש לטעון מחדש לפני ניסיון נוסף.":"The current state could not be confirmed. Reload before trying again."}</p>}
  {visible===null?<p role="status">{he?"טוען…":"Loading…"}</p>:visible.length?<div className="lsw-card-list">{visible.map(item=><article className="lsw-card" key={item.appointmentId} data-appointment-id={item.appointmentId}>
   <h2><time dateTime={item.startsAt}>{new Intl.DateTimeFormat(he?"he-IL":"en-IL",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(item.startsAt))}</time></h2>
   <p>{item.processingState?`${item.processingState} · ${item.audioState}`:(he?"ללא הקלטה":"No recording")}</p>
   <button className="lsw-button" type="button" disabled={busy!==null} onClick={()=>void open(item)}>{busy===item.appointmentId?(he?"פותח…":"Opening…"):(he?"פתיחת רשומת מפגש":"Open session record")}</button>
  </article>)}</div>:<p role="status">{selectedAppointmentId?(he?"הפגישה שנבחרה אינה זמינה בתיק הזה. לא נפתחה רשומה אחרת.":"The selected appointment is unavailable in this case. No other record was opened."):(he?"אין פגישות יחיד בתיק הזה.":"No individual appointments are available for this case.")}</p>}
 </main>;
}

export function SessionDetailWorkspace({locale,sessionId,caseId,navigationContext={}}:{locale:Locale;sessionId:string;caseId?:string;navigationContext?:WorkspaceContext}){
 const [model,setModel]=useState<SessionDetail|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0),he=locale==="he";
 useEffect(()=>{const controller=new AbortController();queueMicrotask(()=>{if(controller.signal.aborted)return;void sessionRead<SessionDetail>(`/${sessionId}`,controller.signal).then(value=>{if(controller.signal.aborted)return;if(value.sessionId!==sessionId||caseId&&value.caseId!==caseId){setModel(null);setError(true);return;}setModel(value);setError(false);}).catch(reason=>{if(controller.signal.aborted)return;if(reason instanceof Error&&["UNAUTHENTICATED","FORBIDDEN","NOT_FOUND"].includes(reason.message))setModel(null);setError(true);});});return()=>controller.abort();},[sessionId,caseId,revision]);
 const actions=useMemo<SessionDeskActions>(()=>({
  async upload(){throw new Error("SESSION_PROVIDER_NOT_CONFIGURED");},
  async refresh(){setRevision(value=>value+1);},
  saveRecap:sessionCommand(`/${sessionId}/recap`),speakers:sessionCommand(`/${sessionId}/speakers`),metrics:sessionCommand(`/${sessionId}/observations`),share:sessionCommand(`/${sessionId}/share`),selectAnalysisLanguage(){setRevision(value=>value+1);},
 }),[sessionId]);
 const retry=<div role="alert"><p>{he?"לא ניתן לאשר מחדש את רשומת המפגש. קלט שלא נשמר נשאר כאן כאשר הגישה עדיין מורשית.":"The session record could not be confirmed again. Unsaved input stays here when access is still authorized."}</p><button className="lsw-button" type="button" onClick={()=>setRevision(value=>value+1)}>{he?"ניסיון קריאה חוזר":"Retry this read"}</button></div>;
 if(error&&!model)return <main className="lsw-main">{retry}</main>;
 if(!model||model.sessionId!==sessionId||caseId&&model.caseId!==caseId)return <main className="lsw-main"><p role="status">{he?"טוען רשומת מפגש…":"Loading session record…"}</p></main>;
 return <>{error&&retry}<p><a className="lsw-button lsw-button--secondary" href={workspaceHref(locale,'app/calendar',model.caseId,navigationContext)}>{he?'חזרה ליומן':'Return to calendar'}</a></p><PractitionerSessionDesk locale={locale} model={model} actions={actions} consentPanel={<SessionConsentPanel locale={locale} model={model} refresh={()=>setRevision(value=>value+1)}/>}/></>;
}
