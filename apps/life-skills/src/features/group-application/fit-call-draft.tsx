"use client";
import {useState} from "react";
import type {Locale} from "../../lib/locale.ts";
import type {GroupApplicationRecord,FloridaGroupApplicationFields} from "./contract.ts";
import {journeyProgramName} from "./journey-preview-model.ts";

/** Manual preparation from a native saved inquiry. No stage transition or delivery is claimed. */
export function fitCallDraft(item:GroupApplicationRecord&{fields:FloridaGroupApplicationFields},locale:Locale){
 return locale==="he"?`שלום ${item.fields.parentName}, תודה על הפנייה לגבי ${journeyProgramName(item.fields.programId,locale)}. נשמח לתאם שיחת התאמה של 15–20 דקות. מהו זמן נוח עבורכם ובאיזה אזור זמן? אין עדיין מועד או קישור מאושרים לשיחה. הפנייה אינה שומרת מקום ואינה מחייבת בתשלום.\nמספר פנייה: ${item.id}`:
 `Hello ${item.fields.parentName}, thank you for your inquiry about ${journeyProgramName(item.fields.programId,locale)}. We would like to arrange a 15–20 minute fit conversation. What time and time zone work for you? No call time or meeting link is confirmed yet. Your inquiry does not reserve a place or require payment.\nInquiry reference: ${item.id}`;
}
export function FitCallDraft({item,locale}:{item:GroupApplicationRecord&{fields:FloridaGroupApplicationFields};locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [draft,setDraft]=useState(()=>fitCallDraft(item,locale)),[status,setStatus]=useState<"idle"|"copied"|"failed">("idle");
 return <details><summary>{t("Prepare a manual fit-call draft","הכנת טיוטה ידנית לשיחת התאמה")}</summary>
  <p>{t("Unsent draft for this inquiry only. Confirm the recipient and wording before manually using your existing contact channel. Copying does not send, book or mark this inquiry reviewed.","טיוטה שלא נשלחה, עבור הפנייה הזו בלבד. בדקו את הנמען והנוסח לפני שימוש ידני בערוץ הקשר הקיים. העתקה אינה שולחת, קובעת פגישה או מסמנת שהפנייה נבדקה.")}</p>
  <p>{t("Recipient to verify","נמען לבדיקה")}: <bdi dir="ltr">{item.fields.contact}</bdi></p>
  <label style={{display:"grid",gap:8}}>{t("Editable draft","טיוטה לעריכה")}<textarea value={draft} maxLength={2000} rows={7} onChange={event=>{setDraft(event.target.value);setStatus("idle");}} style={{font:"inherit",padding:12,inlineSize:"100%",minBlockSize:140}}/></label>
  <button type="button" className="lsw-button lsw-button--secondary" disabled={!draft.trim()} onClick={async()=>{try{await navigator.clipboard.writeText(draft);setStatus("copied");}catch{setStatus("failed");}}}>{t("Copy draft — no send","העתקת טיוטה — ללא שליחה")}</button>
  {status==="copied"&&<p role="status">{t("Draft copied. Nothing was sent; review is still pending.","הטיוטה הועתקה. דבר לא נשלח; הבדיקה עדיין ממתינה.")}</p>}
  {status==="failed"&&<p role="alert">{t("Copy failed. Select the draft text and copy it manually, or try again.","ההעתקה נכשלה. סמנו את הטיוטה והעתיקו ידנית, או נסו שוב.")}</p>}
 </details>;
}
