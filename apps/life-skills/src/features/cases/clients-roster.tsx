"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {accountRead} from "../identity/client.ts";
import type {Locale} from "../../lib/locale.ts";
type Case={id:string;kind:"minor"|"adult";state:string;displayName:string};
const copy={en:{title:"Clients & parents",lead:"Choose an authorized case to open its workspace.",search:"Search clients",empty:"No authorized cases are available.",loading:"Loading authorized cases…",error:"Could not load the roster."},he:{title:"ילדים והורים",lead:"בחירת תיק מורשה לפתיחת מרחב העבודה.",search:"חיפוש ילדים",empty:"אין תיקים מורשים זמינים.",loading:"טוען תיקים מורשים…",error:"לא ניתן לטעון את הרשימה."}} as const;
export function ClientsRoster({locale}:{locale:Locale}){
 const t=copy[locale];const [rows,setRows]=useState<Case[]>([]),[query,setQuery]=useState(""),[state,setState]=useState<"loading"|"ready"|"error">("loading"),active=useRef(true),request=useRef(0);
 const load=()=>{const current=++request.current;setState("loading");void accountRead<Case[]>("cases").then(v=>{if(active.current&&current===request.current){setRows(v);setState("ready")}}).catch(()=>{if(active.current&&current===request.current)setState("error")})};
 useEffect(()=>{active.current=true;queueMicrotask(load);return()=>{active.current=false}},[]);
 const filtered=useMemo(()=>rows.filter(r=>r.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase())),[rows,query]);
 return <main className="lsw-main" lang={locale} dir={locale==="he"?"rtl":"ltr"}><div className="lsw-breadcrumbs"><a href={`/${locale}/app/calendar`}>{locale==="he"?"היום":"Today"}</a><span aria-hidden="true">/</span><span>{t.title}</span></div><h1>{t.title}</h1><p>{t.lead}</p>{state==="loading"&&<p role="status">{t.loading}</p>}{state==="error"&&<div role="alert"><p>{t.error}</p><button type="button" onClick={load}>{locale==="he"?"ניסיון נוסף":"Try again"}</button></div>}{state==="ready"&&<><label htmlFor="client-search">{t.search}</label><input id="client-search" value={query} onChange={e=>setQuery(e.target.value)} /><div className="lsw-card-list">{filtered.length?filtered.map(row=><a className="lsw-card" key={row.id} href={`/${locale}/app/cases/${row.id}`}><h2>{row.displayName}</h2><p>{row.kind==="minor"?(locale==="he"?"ילד/ה":"Child"):(locale==="he"?"מבוגר/ת":"Adult client")} · {row.state}</p></a>):<p role="status">{t.empty}</p>}</div></>}</main>;
}
