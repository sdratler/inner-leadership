"use client";
import {useEffect,useState} from "react";
import {accountRead} from "../../features/identity/client.ts";
import {PracticeList} from "../../features/home-practice/practice-list.tsx";
import {workspaceHref} from "./navigation-model.ts";
import type {Locale} from "../../lib/locale.ts";
type Case={id:string;displayName:string;kind:"minor"|"adult"};
export function FamilyHomeWorkspace({locale,initialCaseId,role="parent"}:{locale:Locale;initialCaseId?:string|undefined;role?:"parent"|"adult_client"}) {
 const [cases,setCases]=useState<Case[]|null>(null),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0);
 const he=locale==="he";
 useEffect(()=>{let live=true;void accountRead<Case[]>("cases").then(rows=>{if(live){setCases(role==="parent"?rows.filter(row=>row.kind==="minor"):rows);setFailed(false);}}).catch(()=>{if(live){setFailed(true);setCases(null);}});return()=>{live=false};},[revision,role]);
 const selected=initialCaseId?cases?.find(row=>row.id===initialCaseId):cases?.[0];
 const base=role==="adult_client"?"client":"family";
 return <main className="lsw-stack"><header className="lsw-page-header"><div><p className="lsw-eyebrow">{he?"מרחב המשפחה":"Family workspace"}</p><h1>{he?"התרגול שלכם להיום":"Your current practice"}</h1><p>{he?"ההנחיות ששותפו איתכם, ומה אפשר לעשות עכשיו.":"The instructions shared with you, and your next step."}</p></div></header>
 {failed?<section className="lsu-state lsu-state--error" role="alert"><p>{he?"לא ניתן לקרוא את המרחב המורשה. לא הוצג מידע מתיק אחר.":"Your authorized workspace could not be read. No other case was substituted."}</p><button type="button" onClick={()=>setRevision(n=>n+1)}>{he?"ניסיון נוסף":"Try again"}</button></section>:!cases?<p role="status">{he?"טוען את התיקים המורשים…":"Loading authorized cases…"}</p>:!cases.length?<section className="lsu-panel"><p>{he?"עדיין אין תיק מורשה המחובר לחשבון הזה.":"No authorized case is linked to this account yet."}</p></section>:!selected?<section className="lsu-state" role="alert"><p>{he?"התיק שבקישור אינו זמין לחשבון הזה.":"The case in this link is not available to this account."}</p><a href={workspaceHref(locale,base)}>{he?"חזרה למרחב המורשה":"Return to authorized workspace"}</a></section>:<>
 {cases.length>1?<label className="lsw-field">{he?"עבור מי התרגול?":"Whose practice?"}<select value={selected.id} onChange={event=>{if(cases.some(row=>row.id===event.target.value))window.location.href=workspaceHref(locale,base,event.target.value);}}>{cases.map(row=><option key={row.id} value={row.id}>{row.displayName}</option>)}</select></label>:<p><strong>{selected.displayName}</strong></p>}
 <nav className="lsu-attention-links" aria-label={he?"פעולות מרכזיות":"Quick actions"}><a href={workspaceHref(locale,`${base}/${role==="adult_client"?"messages":"feedback"}`,selected.id)}>{he?"דיווח או שאלה":"Share an update or question"}</a><a href={workspaceHref(locale,`${base}/${role==="adult_client"?"calendar":"schedule"}`,selected.id)}>{he?"המפגשים שלכם":"Your appointments"}</a></nav>
 <section className="lsu-panel" aria-labelledby="home-practice-title"><h2 id="home-practice-title">{he?"תרגול נוכחי":"Current practice"}</h2><PracticeList key={selected.id} locale={locale} role={role} kind="home-practice" caseId={selected.id}/></section></>}
 </main>;
}
