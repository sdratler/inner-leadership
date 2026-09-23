"use client";
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Locale} from '../../lib/locale.ts';
import {accountRead,sessionInfo} from '../identity/client.ts';
import {FormsWorkspace} from '../forms/workspace.tsx';
import {ResourcesWorkspace} from '../resources/workspace.tsx';
type Role='parent'|'practitioner';
type Mode='forms'|'resources'|'both';
type Case={id:string;displayName:string;kind:'minor'|'adult'};
type Option={id:string;label:string};
type Audience={id:string;visibility:string;published:boolean};
type Member={accountId:string;displayName:string;email:string;state:string;guardianRevokedAt:string|null};
type Props={locale:Locale;role:Role;mode:Mode;initialCaseId?:string|undefined};
const words={en:{forms:'Forms',resources:'Materials & exercises',both:'Forms & materials',case:'Case',load:'Loading authorized workspace…',error:'This workspace is unavailable. Check your access and try again.',empty:'No authorized cases are available.',retry:'Try again',full:'Full shared audience',limited:'Title-only audience'},he:{forms:'טפסים',resources:'חומרים ותרגילים',both:'טפסים וחומרים',case:'תיק',load:'טוען מרחב מורשה…',error:'המרחב אינו זמין. יש לבדוק הרשאה ולנסות שוב.',empty:'אין תיקים מורשים להצגה.',retry:'ניסיון נוסף',full:'קהל לשיתוף מלא',limited:'קהל לכותרת בלבד'}} as const;
async function read<T>(url:string,signal:AbortSignal):Promise<T>{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal}),body=await response.json() as {ok?:boolean;data:T};if(!response.ok||body.ok!==true)throw Error('READ_FAILED');return body.data;}
/** The case roster, never a raw query parameter, grants the UI its context. APIs recheck every action. */
export function SharedItemsWorkspace(props:Props){return <AuthorizedItems key={`${props.locale}:${props.role}:${props.mode}:${props.initialCaseId??''}`} {...props}/>;}
export function AuthorizedItems({locale,role,mode,initialCaseId=''}:Props){
 const t=words[locale],router=useRouter();
 const [cases,setCases]=useState<Case[]|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0),[selected,setSelected]=useState(initialCaseId);
 useEffect(()=>{let active=true;void accountRead<Case[]>('cases').then(rows=>{if(active){setCases(role==='parent'?rows.filter(row=>row.kind==='minor'):rows);setError(false)}}).catch(()=>{if(active){setCases(null);setError(true)}});return()=>{active=false}},[role,revision]);
 const current=cases?.find(item=>item.id===selected)||(!selected?cases?.[0]:undefined),invalid=Boolean(cases&&selected&&!current);
 return <section className="lsw-stack" lang={locale} dir={locale==='he'?'rtl':'ltr'}><h1>{t[mode]}</h1>{mode==='forms'&&role==='practitioner'&&<aside className="lsu-state"><strong>{locale==='he'?'טופס היכרות, הסכמה וגילוי':'Intake, consent and disclosure'}</strong><p>{locale==='he'?'טופס ההיכרות הקיים מנוהל בנפרד מטפסים שמוקצים לתיק.':'The existing intake form is managed separately from forms assigned to a client case.'}</p><a href={`/${locale}/intake/staff`}>{locale==='he'?'פתיחת ניהול טופס ההיכרות':'Open intake form management'}</a></aside>}{error||invalid?<div role="alert"><p>{t.error}</p><button onClick={()=>setRevision(n=>n+1)}>{t.retry}</button></div>:!cases?<p role="status">{t.load}</p>:!cases.length?<p>{t.empty}</p>:<>
 <label className="lsw-field">{t.case}<select className="lsw-input" value={current?.id??''} onChange={event=>{const next=event.target.value;if(!cases.some(item=>item.id===next))return;setSelected(next);router.replace(`/${locale}/${role==='parent'?'family':'app'}/${mode==='both'?'resources':mode}?caseId=${encodeURIComponent(next)}`,{scroll:false})}}>{cases.map(item=><option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>
 {current&&(mode==='forms'||mode==='both')&&<AuthorizedForms key={`${locale}:${role}:${current.id}`} locale={locale} role={role} item={current}/>}
 {current&&(mode==='resources'||mode==='both')&&<ResourcesWorkspace key={`${locale}:${role}:${current.id}`} locale={locale} role={role} caseId={current.id}/>}</>}
 </section>;
}
export function AuthorizedForms({locale,role,item}:{locale:Locale;role:Role;item:Case}){
 const t=words[locale];const [data,setData]=useState<{csrf:string;audiences:Option[];responders:Option[]}|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();void Promise.all([sessionInfo(),role==='practitioner'?read<Audience[]>(`/api/identity/audiences?caseId=${encodeURIComponent(item.id)}`,controller.signal):Promise.resolve([]),role==='practitioner'?read<{caseId:string;members:Member[]}>(`/api/identity/case-access?caseId=${encodeURIComponent(item.id)}`,controller.signal):Promise.resolve({caseId:item.id,members:[]})]).then(([session,audiences,access])=>{if(controller.signal.aborted)return;if(session.role!==role||access.caseId!==item.id)throw Error('CONTEXT_MISMATCH');setData({csrf:session.csrfToken,audiences:audiences.filter(a=>a.published&&a.visibility==='family_full').map((a,i)=>({id:a.id,label:`${t.full} ${i+1}`})),responders:access.members.filter(m=>m.state==='active'&&!m.guardianRevokedAt).map(m=>({id:m.accountId,label:`${m.displayName} · ${m.email}`}))});setError(false)}).catch(()=>{if(!controller.signal.aborted){setData(null);setError(true)}});return()=>controller.abort()},[locale,role,item.id,revision,t.full]);
 if(error)return <div role="alert"><p>{t.error}</p><button onClick={()=>setRevision(n=>n+1)}>{t.retry}</button></div>;
 if(!data)return <p role="status">{t.load}</p>;
 return <FormsWorkspace key={`${role}:${locale}:${item.id}`} locale={locale} role={role} csrfToken={data.csrf} caseKind={item.kind} cases={[{id:item.id,label:item.displayName}]} audiences={data.audiences} responders={data.responders}/>;
}
