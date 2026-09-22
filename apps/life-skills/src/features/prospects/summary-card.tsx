"use client";

import {useEffect,useMemo,useState} from "react";
import type {Locale} from "@/lib/locale.ts";
import type {Prospect} from "./bridge.ts";

function closed(row:Prospect){return /archive|do not contact/i.test(`${row.stage} ${row.outcome}`);}
export function IntakeSummaryCard({locale}:{locale:Locale}){
 const [rows,setRows]=useState<Prospect[]|null>(null);
 useEffect(()=>{let active=true;void fetch("/api/prospects",{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"}).then(async response=>{const body=await response.json() as {ok?:boolean;data?:Prospect[]};if(active&&response.ok&&body.ok)setRows(body.data??[])}).catch(()=>undefined);return()=>{active=false}},[]);
 const counts=useMemo(()=>{const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(new Date()),open=(rows??[]).filter(row=>!closed(row)&&row.journeyState!=="active");return {today:open.filter(row=>row.dueDate&&row.dueDate<=today).length,intake:open.filter(row=>row.formSent&&!row.formSubmitted).length,payment:open.filter(row=>row.formSubmitted&&!row.paymentVerified).length,booking:open.filter(row=>row.paymentVerified&&!/confirmed|active/i.test(row.bookingStatus)).length};},[rows]);
 if(!rows)return null;
 const items=locale==="he"?[["today","לטיפול היום",counts.today],["intake","טפסים שטרם הוגשו",counts.intake],["payment","תשלומים לאימות",counts.payment],["booking","שולם וממתינים למועד",counts.booking]] as const:[["today","Follow-ups due",counts.today],["intake","Forms awaiting submission",counts.intake],["payment","Payments awaiting verification",counts.payment],["booking","Paid, awaiting booking",counts.booking]] as const;
 return <aside className="lsw-card" aria-labelledby="intake-summary-title"><div className="lsw-section-header"><div><p className="lsw-eyebrow">{locale==="he"?"קליטה":"Intake"}</p><h2 id="intake-summary-title">{locale==="he"?"תמונת מצב":"Intake overview"}</h2></div><a className="lsw-button lsw-button--secondary" href={`/${locale}/app/prospects`}>{locale==="he"?"פתיחת המתעניינים":"Open prospects"}</a></div><div className="lsw-inline-meta">{items.map(([filter,label,count])=><a key={filter} href={`/${locale}/app/prospects?filter=${filter}`}><strong>{new Intl.NumberFormat(locale).format(count)}</strong><span>{label}</span></a>)}</div></aside>;
}
