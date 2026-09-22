"use client";
import {useEffect,useRef,useState} from 'react';
import {accountRead} from '../identity/client.ts';
import {CaseAccess} from '../identity/case-access.tsx';
import type {Locale} from '../../lib/locale.ts';
type Case={id:string;kind:'minor'|'adult';state:string;displayName:string};
const links=[['calendar','Calendar & appointments','יומן ופגישות'],['sessions','Sessions & recordings','מפגשים והקלטות'],['practice','Home practice','תרגול הבית'],['reports','Monthly reports','דוחות חודשיים'],['private-notes','Private case notes','הערות פרטיות'],['feedback','Communications','תקשורת'],['forms','Forms','טפסים'],['resources','Resources','משאבים'],['payments','Payments','תשלומים']] as const;
export function CaseWorkspace({locale,caseId,section="overview"}:{locale:Locale;caseId:string;section?:"overview"|"settings"}){
 const [loaded,setLoaded]=useState<{caseId:string;item:Case|null}|null>(null),request=useRef(0);
 useEffect(()=>{const current=++request.current;let active=true;void accountRead<Case[]>('cases').then(rows=>{if(active&&current===request.current)setLoaded({caseId,item:rows.find(row=>row.id===caseId)??null})}).catch(()=>{if(active&&current===request.current)setLoaded({caseId,item:null})});return()=>{active=false}},[caseId]);
 const item=loaded?.caseId===caseId?loaded.item:null,he=locale==='he';
 return <main className="lsw-main" lang={locale} dir={he?'rtl':'ltr'}>
 {loaded?.caseId!==caseId?<p role="status">{he?'טוען תיק…':'Loading case…'}</p>:item?<><h1>{section==="settings"?(he?"גישה ומשתתפים בתיק":"Case access & participants"):item.displayName}</h1><p>{section==="settings"?item.displayName:(he?"מרחב עבודה מורשה · ":"Authorized workspace · ")+item.state}</p>{section==="overview"?<><nav aria-label={he?'פעולות בתיק':'Case actions'} className="lsw-card-list">{links.map(([path,en,hebrew])=><a key={path} className="lsw-card" href={path==='sessions'?`/${locale}/app/cases/${caseId}/sessions`:`/${locale}/app/${path}?caseId=${encodeURIComponent(caseId)}`}>{he?hebrew:en}</a>)}</nav><a className="lsw-button lsw-button--secondary" href={`/${locale}/app/cases/${caseId}/settings`}>{he?"הגדרות גישה ומשתתפים":"Case access settings"}</a></>:<><a href={`/${locale}/app/cases/${caseId}`}>{he?"חזרה לתיק":"Back to case"}</a><CaseAccess key={`${locale}:${caseId}`} locale={locale} caseId={caseId}/></>}</>:<p role="status">{he?'התיק אינו זמין או שאינו מורשה.':'This case is unavailable or not authorized.'}</p>}
 </main>;
}
