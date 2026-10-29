"use client";
import {useEffect,useState} from "react";
import type {Locale} from "../../lib/locale.ts";
type Item={id:string;fromNumber:string;pushName:string;messageText:string;messageType:string;occurredAt:string;media:{fileName:string;mimeType:string;sizeBytes:number|null}[]};
type Result={items:Item[];hasMore:boolean};
export function Owner305InboundPanel({locale,onRecord,disabled}:{locale:Locale;onRecord:(item:Item)=>void;disabled:boolean}){
 const [data,setData]=useState<Result|null>(null),[failed,setFailed]=useState(false);
 const t=(en:string,he:string)=>locale==="he"?he:en;
 useEffect(()=>{let active=true;const controller=new AbortController();
  fetch("/api/private/owner-305-inbound",{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:controller.signal})
   .then(async response=>{const body=await response.json();if(!response.ok||!body?.ok)throw Error();if(active)setData(body.data as Result);})
   .catch(()=>{if(active){setData(null);setFailed(true);}});
  return()=>{active=false;controller.abort();};},[]);
 return <div className="lsw-stack"><h3>{t("305 WhatsApp messages","הודעות WhatsApp לקו 305")}</h3>
  {failed?<p role="alert">{t("Messages could not be read.","לא ניתן לקרוא את ההודעות.")}</p>:!data?<p role="status">{t("Loading messages…","טוען הודעות…")}</p>:<>
   {data.items.length===0?<p>{t("No messages received yet.","טרם התקבלו הודעות.")}</p>:<ul>{data.items.map(item=><li key={item.id}>
    <p><bdi>{item.fromNumber}</bdi> {item.pushName} · <time dateTime={item.occurredAt}>{item.occurredAt}</time></p>
    <p>{item.messageText}</p>{item.media.map((media,index)=><p key={index}>{media.fileName||media.mimeType}</p>)}
    <button type="button" disabled={disabled} onClick={()=>onRecord(item)}>{t("Record a follow-up","תיעוד מעקב")}</button>
   </li>)}</ul>}{data.hasMore&&<p>{t("Showing the latest 100 messages.","מוצגות 100 ההודעות האחרונות.")}</p>}</>}
 </div>;
}
