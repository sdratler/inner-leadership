"use client";

import {useEffect,useState} from "react";
import type {Locale} from "../../lib/locale.ts";

type Audience={id:string;published:boolean};
type Practice={assignmentId:string;startsOn:string;endsOn:string|null};
type Thread={report:{id:string;reviewState:string}};
type Snapshot={caseId:string;assignments:number|null;communications:number|null;partial:boolean};

async function read<T>(url:string,signal:AbortSignal):Promise<T>{
 const response=await fetch(url,{credentials:"same-origin",cache:"no-store",redirect:"error",signal});
 const body=await response.json() as {ok?:boolean;data?:T};
 if(!response.ok||body.ok!==true||body.data===undefined)throw new Error("UNAVAILABLE");
 return body.data;
}

/** Counts are limited to the selected authorized case. Unknown reads never become zero. */
export function CalendarAttentionSummary({locale,caseId}:{locale:Locale;caseId:string}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  if(!caseId)return()=>controller.abort();
  void read<Audience[]>(`/api/identity/audiences?caseId=${encodeURIComponent(caseId)}`,controller.signal).then(async audiences=>{
   const current=audiences.filter(item=>item.published);
   const results=await Promise.allSettled(current.flatMap(item=>[
    read<Practice[]>(`/api/home-practice?caseId=${encodeURIComponent(caseId)}&audienceId=${encodeURIComponent(item.id)}`,controller.signal),
    read<Thread[]>(`/api/updates?caseId=${encodeURIComponent(caseId)}&audienceId=${encodeURIComponent(item.id)}`,controller.signal),
   ]));
   if(controller.signal.aborted)return;
   const assignments=new Set<string>(),communications=new Set<string>();
   const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(new Date());
   let assignmentError=false,communicationError=false;
   results.forEach((result,index)=>{
    if(result.status==="rejected"){if(index%2===0)assignmentError=true;else communicationError=true;return;}
    if(index%2===0){for(const item of result.value as Practice[])if(item.startsOn<=today&&(!item.endsOn||item.endsOn>=today))assignments.add(item.assignmentId);}
    else for(const item of result.value as Thread[])if(item.report.reviewState==="new")communications.add(item.report.id);
   });
   setSnapshot({caseId,assignments:assignmentError?null:assignments.size,communications:communicationError?null:communications.size,partial:assignmentError||communicationError});
  }).catch(()=>{if(!controller.signal.aborted)setSnapshot({caseId,assignments:null,communications:null,partial:true})});
  return()=>controller.abort();
 },[caseId]);
 const he=locale==="he",path=`/${locale}/app`,current=snapshot?.caseId===caseId?snapshot:null;
 return <section className="lsu-calendar-attention" aria-label={he?"עבודה שוטפת בתיק":"Current case work"}>
  <a className="lsw-card" href={`${path}/practice?caseId=${encodeURIComponent(caseId)}`}><h2>{he?"משימות תרגול נוכחיות":"Current assignments"}</h2><strong>{!caseId?(he?"בחרו תיק":"Select a client"):current?.assignments==null?"—":current.assignments}</strong><span>{he?"פתיחת המשימות בתיק":"Open client assignments"}</span></a>
  <a className="lsw-card" href={`${path}/feedback?caseId=${encodeURIComponent(caseId)}`}><h2>{he?"תקשורת חדשה":"New communications"}</h2><strong>{!caseId?(he?"בחרו תיק":"Select a client"):current?.communications==null?"—":current.communications}</strong><span>{he?"פתיחת התקשורת בתיק":"Open client communications"}</span></a>
  {caseId&&current?.partial&&<p role="status">{he?"חלק מהנתונים אינו זמין כרגע. מקף אינו מייצג אפס.":"Some records are unavailable right now. A dash does not mean zero."}</p>}
 </section>;
}
