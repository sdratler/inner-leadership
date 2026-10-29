"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {inquiryLinkCommandSchema,type InquiryLinkCommand} from "./inquiry-links.ts";
import type {Owner305InquiryLinkStore} from "./inquiry-link-store.ts";
type Page=Awaited<ReturnType<Owner305InquiryLinkStore["list"]>>;
class ReadError extends Error{constructor(readonly status:number){super("LINK_FAILED");}}
const endpoint="/api/private/owner-305-conversations/inquiry-links";
export function InquiryLinkPanel({locale,conversationId,onPending,disabled=false}:{locale:Locale;conversationId:string;onPending:(pending:boolean)=>void;disabled?:boolean}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [page,setPage]=useState<Page|null>(null),[error,setError]=useState<number|null>(null),[busy,setBusy]=useState(false),[pending,setPending]=useState<InquiryLinkCommand|null>(null);
 const [kind,setKind]=useState<"bna_inquiry"|"fishing_inquiry">("bna_inquiry"),[id,setId]=useState(""),[message,setMessage]=useState("");
 const active=useRef(true),serial=useRef(0);
 const load=useCallback(async(cursor?:string)=>{const n=++serial.current;try{const q=new URLSearchParams({id:conversationId,...(cursor?{cursor}:{})});
  const response=await fetch(endpoint+"?"+q,{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});const body=await response.json().catch(()=>null);
  if(!response.ok||!body?.ok)throw new ReadError(response.status);if(!active.current||serial.current!==n)return;
  const value=body.data as Page;setPage(current=>cursor&&current?.nextCursor===cursor?{...value,items:[...current.items,...value.items]}:value);setError(null);
 }catch(cause){if(active.current&&serial.current===n){const code=cause instanceof ReadError?cause.status:503;setError(code);if([401,403,404].includes(code)){setPage(null);setPending(null);}}}},[conversationId]);
 useEffect(()=>{active.current=true;const timer=window.setTimeout(()=>void load(),0);return()=>{window.clearTimeout(timer);active.current=false;};},[load]);
 useEffect(()=>{onPending(pending!==null);},[pending,onPending]);
 async function save(command:InquiryLinkCommand){if(busy)return;const previouslyUnknown=pending!==null;setBusy(true);setPending(command);setError(null);setMessage("");
  try{const session=await sessionInfo(),response=await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(command)});
   const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok)throw new ReadError(response.status);if(!active.current)return;
   setPending(null);setId("");await load();setMessage(t("Link choice saved.","בחירת הקישור נשמרה."));
  }catch(cause){if(!active.current)return;const code=cause instanceof ReadError?cause.status:503;setError(code);if(!previouslyUnknown&&[400,401,403,404,409].includes(code))setPending(null);if([401,403].includes(code))setPage(null);}
  finally{if(active.current)setBusy(false);}}
 function change(target:InquiryLinkCommand["target"],linked:boolean){if(disabled||!page||page.nextCursor||pending)return;
  const current=page.items.find(item=>item.target.kind===target.kind&&item.target.id===target.id);
  const parsed=inquiryLinkCommandSchema.safeParse({operationId:crypto.randomUUID(),conversationId,target,expectedVersion:current?.version??0,linked});
  if(!parsed.success){setError(400);return;}void save(parsed.data);
 }
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();change({kind,id:id.trim()},true);}
 if(error===404&&!page)return null;
 return <section className="lsw-stack"><h4>{t("Linked inquiries","פניות מקושרות")}</h4><p>{t("Choose an existing inquiry by its reference. Nothing is matched or merged automatically.","בחרו פנייה קיימת לפי מספר הפנייה. אין התאמה או מיזוג אוטומטיים.")}</p>
  {error!==null&&<div role="alert"><p>{error===409?t("The link changed. Reload before trying again.","הקישור השתנה. יש לרענן לפני ניסיון נוסף."):t("The link request could not be confirmed.","לא ניתן לאשר את בקשת הקישור.")}</p>{!pending&&![401,403,404].includes(error)&&<button type="button" disabled={disabled||busy} onClick={()=>void load()}>{t("Reload links","רענון הקישורים")}</button>}</div>}{message&&<p role="status">{message}</p>}
  {pending&&!busy&&<button type="button" disabled={disabled} onClick={()=>void save(pending)}>{t("Retry the same link operation","ניסיון חוזר לאותה פעולת קישור")}</button>}
  {page&&<><ul>{page.items.map(item=><li key={item.target.kind+item.target.id}>{item.target.kind==="bna_inquiry"?"BNA":"Fishing"} · <bdi dir="ltr">{item.target.id}</bdi> · {item.linked?t("Linked","מקושר"):t("Unlinked","לא מקושר")}
   <button type="button" disabled={disabled||busy||!!pending||!!page.nextCursor} onClick={()=>change(item.target,!item.linked)}>{item.linked?t("Unlink","ביטול קישור"):t("Link again","קישור מחדש")}</button></li>)}</ul>
   {page.nextCursor&&<button type="button" disabled={disabled||busy||!!pending} onClick={()=>void load(page.nextCursor!)}>{t("Load older link choices","טעינת קישורים קודמים")}</button>}
   <form onSubmit={submit}><label>{t("Inquiry type","סוג הפנייה")}<select value={kind} onChange={event=>setKind(event.target.value as typeof kind)}><option value="bna_inquiry">BNA</option><option value="fishing_inquiry">Fishing</option></select></label>
    <label>{t("Inquiry reference","מספר הפנייה")}<input required value={id} maxLength={36} dir="ltr" onChange={event=>setId(event.target.value)}/></label>
    <button type="submit" disabled={disabled||busy||!!pending||!!page.nextCursor}>{t("Link inquiry","קישור הפנייה")}</button></form></>}
 </section>;
}
