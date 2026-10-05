"use client";
import {useId,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import type {CreativeVersion} from "../../features/marketing-overview/contracts.ts";
import type {ArtworkReviewCommand,ArtworkReviewResult} from "../../features/marketing-overview/review.ts";
import {sessionInfo} from "../../features/identity/client.ts";
import {UnsavedChangesGuard} from "../workspace/draft-guard.tsx";
import {word} from "./primitives.tsx";
export function CreativeReview({asset,locale,imageVerified}:{asset:CreativeVersion;locale:"en"|"he";imageVerified:boolean}){
 const id=useId(),router=useRouter(),[decision,setDecision]=useState<ArtworkReviewCommand["decision"]>("approve_artwork"),[note,setNote]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[saved,setSaved]=useState<ArtworkReviewResult|null>(null),[error,setError]=useState<"conflict"|"unavailable"|null>(null),attempt=useRef<ArtworkReviewCommand|null>(null);
 const eligible=asset.registeredRevision===true&&!!asset.reviewToken&&asset.review!=="retired";
 if(!eligible)return <p>{word(locale,"Review saving is unavailable until the exact source revision and its approval evidence are registered.","שמירת בדיקה אינה זמינה עד לרישום גרסת המקור המדויקת ועדות האישור שלה.")}</p>;
 const edited=()=>{attempt.current=null;setSaved(null);setError(null);};
 async function save(event:React.FormEvent){
  event.preventDefault();if(busy||!imageVerified||!confirmed||decision==="needs_revision"&&!note.trim())return;
  const input:ArtworkReviewCommand={assetId:asset.assetId,revision:asset.revision,digest:asset.contentDigest,reviewToken:asset.reviewToken!,operationId:attempt.current?.operationId??crypto.randomUUID(),decision,note};attempt.current=input;setBusy(true);setError(null);
  try{
   const session=await sessionInfo(),response=await fetch("/api/marketing/review",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrfToken},body:JSON.stringify(input)}),body=await response.json();
   if(!response.ok||body?.ok!==true){setError(response.status===409?"conflict":"unavailable");return;}
   const result=body.data as ArtworkReviewResult;
   if(result?.saved!==true||result.readbackVerified!==true||result.operationId!==input.operationId||result.decision!==input.decision||result.note!==input.note||result.asset?.assetId!==input.assetId||result.asset.contentDigest!==input.digest||result.asset.revision!==input.revision){setError("unavailable");return;}
   setSaved(result);router.refresh();
  }catch{setError("unavailable");}finally{setBusy(false);}
 }
 return <form className="lsr-artwork-review" onSubmit={save} aria-label={word(locale,"Review this exact artwork","בדיקת התמונה המדויקת")}>
  <UnsavedChangesGuard dirty={!saved&&(note.length>0||confirmed)} message={word(locale,"Leave without saving this artwork review?","לצאת בלי לשמור את בדיקת התמונה?")}/>
  <h3>{word(locale,"Review this exact artwork","בדיקת התמונה המדויקת")}</h3>
  <p>{word(locale,"Artwork approval only. Nothing is scheduled, published, sent or activated; existing publication holds stay in place.","אישור התמונה בלבד. דבר אינו מתוזמן, מתפרסם, נשלח או מופעל; חסימות הפרסום הקיימות נשמרות.")}</p>
  {asset.artworkReview&&<p>{word(locale,"Previous source review","בדיקה קודמת במקור")}: {asset.artworkReview.decision==="approve_artwork"?word(locale,"Artwork approved","התמונה אושרה"):word(locale,"Needs revision","נדרש תיקון")} · <time dir="ltr">{asset.artworkReview.savedAt}</time>{asset.artworkReview.note&&<span> · {asset.artworkReview.note}</span>}</p>}
  <label htmlFor={`${id}-decision`}>{word(locale,"Review decision","החלטת הבדיקה")}</label><select id={`${id}-decision`} value={decision} disabled={busy} onChange={event=>{edited();setDecision(event.target.value as ArtworkReviewCommand["decision"]);setConfirmed(false);}}><option value="approve_artwork">{word(locale,"Approve artwork only","אישור התמונה בלבד")}</option><option value="needs_revision">{word(locale,"Needs revision","נדרש תיקון")}</option></select>
  <label htmlFor={`${id}-note`}>{word(locale,"Artwork notes (required for a revision)","הערות לתמונה (חובה בבקשת תיקון)")}</label><textarea id={`${id}-note`} value={note} maxLength={1200} rows={3} disabled={busy} required={decision==="needs_revision"} onChange={event=>{edited();setNote(event.target.value);}}/>
  <p>{word(locale,"Artwork instructions only—no client, contact or clinical information.","הנחיות לתמונה בלבד — ללא פרטי לקוחות, אנשי קשר או מידע קליני.")}</p>
  <label><input type="checkbox" checked={confirmed} disabled={busy||!imageVerified} onChange={event=>{edited();setConfirmed(event.target.checked);}}/>{word(locale,"I reviewed this complete exact image and its version.","בדקתי את התמונה המדויקת והמלאה ואת גרסתה.")}</label>
  {!imageVerified&&<p role="status">{word(locale,"Load the complete original before saving a review.","יש לטעון את המקור המלא לפני שמירת הבדיקה.")}</p>}
  <button type="submit" className="lsr-primary" disabled={busy||!confirmed||!imageVerified||decision==="needs_revision"&&!note.trim()}>{busy?word(locale,"Saving and reading back…","שומר וקורא מחדש…"):error==="unavailable"?word(locale,"Retry this exact save","ניסיון נוסף לאותה שמירה"):word(locale,"Save artwork review","שמירת בדיקת התמונה")}</button>
  {error&&<p role="alert">{error==="conflict"?word(locale,"The source changed elsewhere. Your notes are preserved. Compare the source and refreshed inventory before submitting a new decision; nothing was overwritten.","המקור השתנה במקום אחר. ההערות נשמרו כאן. יש להשוות עם המקור והמלאי המעודכן לפני שליחת החלטה חדשה; דבר לא נדרס."):word(locale,"The save is unconfirmed. Your notes are preserved. Retry this same save; do not assume the source was updated.","השמירה לא אומתה. ההערות נשמרו כאן. אפשר לנסות שוב את אותה שמירה; אין להניח שהמקור עודכן.")}</p>}
  {saved&&<p role="status">{word(locale,"Saved and read back from the canonical graphics register","נשמר ונקרא מחדש מרשם הגרפיקה המקורי")} · <time dir="ltr">{saved.savedAt}</time> · {word(locale,"Publishing remains held","הפרסום נשאר בהשהיה")}</p>}
 </form>;
}
