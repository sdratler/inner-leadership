"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import type {Locale} from '../../lib/locale.ts';
import {accountRead,sessionInfo} from '../identity/client.ts';
import {FormsWorkspace} from '../forms/workspace.tsx';
import {ResourcesWorkspace} from '../resources/workspace.tsx';
import {workspaceContext,workspaceHref} from '../../ui/workspace/navigation-model.ts';
type Role='parent'|'practitioner'|'adult_client';
type Mode='forms'|'resources'|'both';
type Case={id:string;displayName:string;kind:'minor'|'adult'};
type Option={id:string;label:string};
type Audience={id:string;visibility:string;published:boolean};
type Member={accountId:string;displayName:string;email:string;role:'parent'|'adult_client'|'child';state:string;guardianRevokedAt:string|null};
type Props={locale:Locale;role:Role;mode:Mode;initialCaseId?:string|undefined};
const words={en:{forms:'Forms',resources:'Materials & exercises',both:'Forms & materials',case:'Case',load:'Loading authorized workspace…',error:'This workspace is unavailable. Check your access and try again.',empty:'No authorized cases are available.',retry:'Try again',full:'Full shared audience',limited:'Title-only audience'},he:{forms:'טפסים',resources:'חומרים ותרגילים',both:'טפסים וחומרים',case:'תיק',load:'טוען מרחב מורשה…',error:'המרחב אינו זמין. יש לבדוק הרשאה ולנסות שוב.',empty:'אין תיקים מורשים להצגה.',retry:'ניסיון נוסף',full:'קהל לשיתוף מלא',limited:'קהל לכותרת בלבד'}} as const;
async function read<T>(url:string,signal:AbortSignal):Promise<T>{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal}),body=await response.json() as {ok?:boolean;data:T};if(!response.ok||body.ok!==true)throw Error('READ_FAILED');return body.data;}
export function eligibleFormResponders(kind:Case['kind'],members:readonly Member[]):Member[]{return members.filter(member=>member.role===(kind==='adult'?'adult_client':'parent')&&member.state==='active'&&!member.guardianRevokedAt)}
/** The case roster, never a raw query parameter, grants the UI its context. APIs recheck every action. */
export function SharedItemsWorkspace(props:Props){return <AuthorizedItems key={`${props.locale}:${props.role}:${props.mode}:${props.initialCaseId??''}`} {...props}/>;}
export function AuthorizedItems({locale,role,mode,initialCaseId=''}:Props){
 const t=words[locale],router=useRouter(),query=useSearchParams(),dirty=useRef({forms:false,resources:false});
 const formsDirty=useCallback((value:boolean)=>{dirty.current.forms=value},[]),resourcesDirty=useCallback((value:boolean)=>{dirty.current.resources=value},[]);
 const [cases,setCases]=useState<Case[]|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0),[selected,setSelected]=useState(initialCaseId);
 useEffect(()=>{let active=true;void accountRead<Case[]>('cases').then(rows=>{if(active){setCases(role==='parent'?rows.filter(row=>row.kind==='minor'):role==='adult_client'?rows.filter(row=>row.kind==='adult'):rows);setError(false)}}).catch(()=>{if(active){setCases(null);setError(true)}});return()=>{active=false}},[role,revision]);
 const current=cases?.find(item=>item.id===selected)||(!selected?cases?.[0]:undefined),invalid=Boolean(cases&&selected&&!current);
 return <section className="lsw-stack" lang={locale} dir={locale==='he'?'rtl':'ltr'}><h1>{t[mode]}</h1>{mode==='forms'&&role==='practitioner'&&<aside className="lsu-state"><strong>{locale==='he'?'טופס היכרות, הסכמה וגילוי':'Intake, consent and disclosure'}</strong><p>{locale==='he'?'טופס ההיכרות הקיים מנוהל בנפרד מטפסים שמוקצים לתיק.':'The existing intake form is managed separately from forms assigned to a client case.'}</p><a href={`/${locale}/intake/staff`}>{locale==='he'?'פתיחת ניהול טופס ההיכרות':'Open intake form management'}</a></aside>}{error||invalid?<div role="alert"><p>{t.error}</p><button onClick={()=>setRevision(n=>n+1)}>{t.retry}</button></div>:!cases?<p role="status">{t.load}</p>:!cases.length?<p>{t.empty}</p>:<>
 <label className="lsw-field">{t.case}<select aria-label={t.case} className="lsw-input" value={current?.id??''} onChange={event=>{const next=event.target.value;if(next===current?.id||!cases.some(item=>item.id===next))return;if((dirty.current.forms||dirty.current.resources)&&!window.confirm(locale==='he'?'יש קלט שלא נשמר או פעולה שטרם אושרה. לעבור לתיק אחר ולאבד את הקלט?':'There is unsaved input or an unconfirmed action. Switch cases and discard this input?'))return;dirty.current={forms:false,resources:false};setSelected(next);const root=role==='parent'?'family':role==='adult_client'?'client':'app',context=workspaceContext(Object.fromEntries(query));router.replace(workspaceHref(locale,`${root}/${mode==='both'?'resources':mode}`,next,context),{scroll:false})}}>{cases.map(item=><option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>
 {current&&(mode==='forms'||mode==='both')&&<AuthorizedForms key={`${locale}:${role}:${current.id}`} locale={locale} role={role} item={current} onDirtyChange={formsDirty}/>}
 {current&&(mode==='resources'||mode==='both')&&<ResourcesWorkspace key={`${locale}:${role}:${current.id}`} locale={locale} role={role} caseId={current.id} onDirtyChange={resourcesDirty}/>}</>}
 </section>;
}
export function AuthorizedForms({locale,role,item,onDirtyChange}:{locale:Locale;role:Role;item:Case;onDirtyChange?:(dirty:boolean)=>void}){
 const t=words[locale];const [data,setData]=useState<{csrf:string;audiences:Option[];responders:Option[]}|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();void Promise.all([sessionInfo(),role==='practitioner'?read<Audience[]>(`/api/identity/audiences?caseId=${encodeURIComponent(item.id)}`,controller.signal):Promise.resolve([]),role==='practitioner'?read<{caseId:string;members:Member[]}>(`/api/identity/case-access?caseId=${encodeURIComponent(item.id)}`,controller.signal):Promise.resolve({caseId:item.id,members:[]})]).then(([session,audiences,access])=>{if(controller.signal.aborted)return;if(session.role!==role||access.caseId!==item.id)throw Error('CONTEXT_MISMATCH');setData({csrf:session.csrfToken,audiences:audiences.filter(a=>a.published&&a.visibility==='family_full').map((a,i)=>({id:a.id,label:`${t.full} ${i+1}`})),responders:eligibleFormResponders(item.kind,access.members).map(m=>({id:m.accountId,label:`${m.displayName} · ${m.email}`}))});setError(false)}).catch(()=>{if(!controller.signal.aborted){setData(null);setError(true)}});return()=>controller.abort()},[locale,role,item.id,item.kind,revision,t.full]);
 if(error)return <div role="alert"><p>{t.error}</p><button onClick={()=>setRevision(n=>n+1)}>{t.retry}</button></div>;
 if(!data)return <p role="status">{t.load}</p>;
 return <FormsWorkspace key={`${role}:${locale}:${item.id}`} locale={locale} role={role} csrfToken={data.csrf} caseKind={item.kind} cases={[{id:item.id,label:item.displayName}]} audiences={data.audiences} responders={data.responders} {...(onDirtyChange?{onDirtyChange}:{})}/>;
}
