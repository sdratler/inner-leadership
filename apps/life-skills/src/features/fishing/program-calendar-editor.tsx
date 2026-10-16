"use client";
import {useState,type FormEvent} from "react";
import {z} from "zod";
import type {Locale} from "../../lib/locale.ts";
import {Button,Input,Select,Textarea} from "../../ui/workspace/controls.tsx";
import {stageCommandSchema,type StageCommand} from "../fishing-stage/contract.ts";
import {floridaWallTimeCandidates,resolveFloridaWallTime} from "../fishing-stage/time.ts";
import type {NativeProgramCommandIntent} from "./native-program-contract.ts";
import type {FishingCalendarPlan} from "./program-calendar-contract.ts";

function wall(instant:string){const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(instant)).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
/** An unchanged native instant may contain seconds not shown by minute inputs.
 * Preserve it only with its exact original choice; edits use the strict resolver. */
export function resolveFishingEditorInstant(value:string,choice:string,original?:string):string{
 if(original!==undefined&&choice===original){
  const checked=z.iso.datetime({offset:true}).parse(original);
  if(wall(checked)===value)return new Date(checked).toISOString();
 }
 return resolveFloridaWallTime(value,choice||undefined);
}
function FloridaTime({id,label,value,choice,onChange,locale,locked}:{id:string;label:string;value:string;choice:string;onChange:(value:string,choice:string)=>void;locale:Locale;locked:boolean}){
 let values:string[]=[];try{if(value)values=floridaWallTimeCandidates(value);}catch{}
 return <div><Input id={id} label={label} type="datetime-local" required disabled={locked} value={value} onChange={e=>onChange(e.target.value,"")} help="America/New_York" error={value&&!values.length?(locale==="he"?"השעה אינה קיימת. בחרו שעה תקינה.":"This local time does not exist. Choose a valid time."):undefined}/>
 {values.length>1&&<Select id={id+"-offset"} label={locale==="he"?"בחירת המופע של השעה":"Choose the exact occurrence"} required disabled={locked} value={choice} onChange={e=>onChange(value,e.target.value)}><option value="">{locale==="he"?"בחירה מפורשת נדרשת":"Explicit choice required"}</option>{values.map(v=><option key={v} value={v}>{v}</option>)}</Select>}</div>;
}
/** Operator controls over current native references, never a local schedule or
 * a payment/enrollment decision. Parent controls live in the retained plan. */
export function FishingCalendarEditor({data,locale,initialOccurrenceId="",locked,onSave,onDirty,onCancel}:{data:FishingCalendarPlan;locale:Locale;initialOccurrenceId?:string;locked:boolean;
 onSave:(command:StageCommand,intent:NativeProgramCommandIntent)=>void;onDirty:(value:boolean)=>void;onCancel:()=>void}){
 const t=(en:string,he:string)=>locale==="he"?he:en,initial=data.view?.occurrences.find(o=>o.id===initialOccurrenceId);
 const [occurrenceId,setOccurrenceId]=useState(initialOccurrenceId),[action,setAction]=useState<StageCommand["action"]>(!data.view?"create":initial?"revise":"publish"),[reason,setReason]=useState("");
 const [base,setBase]=useState({stage:data.view?.revision??0,occurrence:initial?.revision??0});
 const [timed,setTimed]=useState(initial?.time.kind==="scheduled"),[start,setStart]=useState(initial?.time.kind==="scheduled"?wall(initial.time.startsAt):""),[startChoice,setStartChoice]=useState(initial?.time.kind==="scheduled"?initial.time.startsAt:"");
 const [end,setEnd]=useState(initial?.time.kind==="scheduled"?wall(initial.time.endsAt):""),[endChoice,setEndChoice]=useState(initial?.time.kind==="scheduled"?initial.time.endsAt:"");
 const [venueId,setVenueId]=useState(data.operator.venues.find(v=>initial&&(initial.location===v.label||initial.location===`${v.label}\n${v.address}`))?.id??"");
 const [directions,setDirections]=useState(initial?.directions??""),[equipment,setEquipment]=useState(initial?.equipment??""),[note,setNote]=useState(initial?.logisticalNote??""),[capacity,setCapacity]=useState(String(initial?.childCapacity??data.choice.childCapacity));
 const [enrollmentId,setEnrollmentId]=useState(""),[attendance,setAttendance]=useState<""|"present"|"late"|"absent"|"no_show">(""),[noticeId,setNoticeId]=useState(""),[fitId,setFitId]=useState(""),[error,setError]=useState(""),[draftDirty,setDraftDirty]=useState(false);
 const selected=data.view?.occurrences.find(o=>o.id===occurrenceId),venue=data.operator.venues.find(v=>v.id===venueId),notice=data.operator.makeupNotices.find(n=>n.id===noticeId);
 const fits=data.operator.makeupFits.filter(f=>f.learnerId===notice?.learnerId),fit=fits.find(f=>f.id===fitId);
 const changed=(data.view?.revision??0)!==base.stage||Boolean(selected&&selected.revision!==base.occurrence);
 function dirty(){setDraftDirty(true);onDirty(true);setError("");}
 function chooseOccurrence(id:string){
  if(draftDirty&&!window.confirm(t("Replace the unsaved session draft?","להחליף את טיוטת המפגש שלא נשמרה?")))return;
  const o=data.view?.occurrences.find(v=>v.id===id);setOccurrenceId(id);setBase({stage:data.view?.revision??0,occurrence:o?.revision??0});
  setTimed(o?.time.kind==="scheduled");setStart(o?.time.kind==="scheduled"?wall(o.time.startsAt):"");setStartChoice(o?.time.kind==="scheduled"?o.time.startsAt:"");setEnd(o?.time.kind==="scheduled"?wall(o.time.endsAt):"");setEndChoice(o?.time.kind==="scheduled"?o.time.endsAt:"");
  setVenueId(data.operator.venues.find(v=>o&&(o.location===v.label||o.location===`${v.label}\n${v.address}`))?.id??"");setDirections(o?.directions??"");setEquipment(o?.equipment??"");setNote(o?.logisticalNote??"");setCapacity(String(o?.childCapacity??data.choice.childCapacity));dirty();
 }
 const occurrenceAction=["revise","cancel","complete","attendance"].includes(action),allowed=!occurrenceAction||Boolean(selected&&(action==="complete"?selected.state==="published"&&selected.time.kind==="scheduled":selected.allowedActions.includes(action==="attendance"?"record_attendance":action==="cancel"?"cancel":"revise")));
 const missingReference=action==="confirm_makeup"?(!notice||!fit):action==="attendance"?(!attendance||!enrollmentId):action==="revise"&&timed?!venue:false;
 function submit(event:FormEvent){
  event.preventDefault();setError("");if(locked||changed||!allowed)return;
  try{
   const operationId=crypto.randomUUID(),common={operationId,expectedRevision:base.stage},specific={occurrenceId,expectedOccurrenceRevision:base.occurrence};
   let command:StageCommand;const intent:NativeProgramCommandIntent={operationId,resources:[],makeupFitDecisionId:null};
   if(action==="create")command={...common,action,templateVersion:data.choice.templateVersion,childCapacity:data.choice.childCapacity};
   else if(action==="publish")command={...common,action};
   else if(action==="revise"){
    if(timed&&!venue)throw Error("VENUE_REQUIRED");const original=selected?.time.kind==="scheduled"?selected.time:null,time=timed?{kind:"scheduled" as const,timeZone:"America/New_York" as const,startsAt:resolveFishingEditorInstant(start,startChoice,original?.startsAt),endsAt:resolveFishingEditorInstant(end,endChoice,original?.endsAt)}:{kind:"undated" as const,timeZone:"America/New_York" as const};
    command={...common,...specific,action,reason,details:{time,location:venue?.label??"",directions,equipment,logisticalNote:note,childCapacity:Number(capacity)}};
    if(timed)intent.resources=[{occurrenceId,expectedRevision:base.occurrence,venueId}];
   }else if(action==="cancel"||action==="complete")command={...common,...specific,action,reason};
   else if(action==="attendance"){
    if(!attendance||!data.operator.roster.some(r=>r.enrollmentId===enrollmentId))throw Error("CURRENT_ENROLLMENT_REQUIRED");command={...common,...specific,action,reason,enrollmentId,state:attendance};
   }else if(action==="confirm_makeup"){
    if(!notice||!fit)throw Error("EXISTING_SUITABILITY_REQUIRED");command={...common,action,reason,noticeId,replacementOccurrenceId:fit.occurrenceId,expectedReplacementRevision:fit.revision};intent.makeupFitDecisionId=fit.id;
   }else throw Error("UNSUPPORTED_OPERATOR_ACTION");
   onSave(stageCommandSchema.parse(command),intent);
  }catch{setError(t("Check the required fields, approved place and explicit Florida time. No change was sent.","בדקו את שדות החובה, המקום המאושר ובחירת השעה בפלורידה. לא נשלח שינוי."));}
 }
 return <form className="lsw-stack" onSubmit={submit} aria-label={t("Manage fishing stage","ניהול שלב הדיג")}>
  <p>{t("Changes, reasons and logistical instructions are visible to enrolled families. Keep private observations elsewhere. No message, charge or enrollment is created.","השינויים, הסיבות וההנחיות הלוגיסטיות מוצגים למשפחות הרשומות. שמרו תצפיות פרטיות בנפרד. לא נוצרים הודעה, חיוב או רישום לקורס.")}</p>
  {changed&&<div role="alert"><p>{t("A newer saved version is available. Your draft is retained. Review it before using the current revision.","קיימת גרסה שמורה חדשה יותר. הטיוטה נשמרה במסך. עיינו בה לפני שימוש בגרסה הנוכחית.")}</p><Button type="button" variant="secondary" disabled={locked} onClick={()=>{setBase({stage:data.view?.revision??0,occurrence:selected?.revision??0});dirty();}}>{t("Use current revision, keep my draft","שימוש בגרסה הנוכחית ושמירת הטיוטה")}</Button></div>}
  <Select id="fish-command" label={t("Action","פעולה")} value={action} disabled={locked} onChange={e=>{setAction(e.target.value as StageCommand["action"]);dirty();}}>
   {!data.view?<option value="create">{t("Create a twelve-session undated draft","יצירת טיוטה ללא מועדים ל־12 מפגשים")}</option>:<><option value="publish">{t("Publish the reviewed plan","פרסום התוכנית לאחר עיון")}</option><option value="revise">{t("Revise session","עדכון מפגש")}</option><option value="cancel">{t("Cancel session — retain undelivered obligation","ביטול מפגש ושמירת השירות שטרם סופק")}</option><option value="complete">{t("Mark session delivered","סימון שהמפגש התקיים")}</option><option value="attendance">{t("Record participant attendance","תיעוד נוכחות משתתף")}</option><option value="confirm_makeup">{t("Confirm a reviewed replacement place","אישור מקום להשלמה לאחר בדיקה")}</option></>}
  </Select>
  {occurrenceAction&&<Select id="fish-occurrence" label={t("Session","מפגש")} required value={occurrenceId} disabled={locked} onChange={e=>chooseOccurrence(e.target.value)}><option value="">{t("Select a session","בחירת מפגש")}</option>{data.view?.occurrences.map(o=><option key={o.id} value={o.id}>{o.ordinal} · {o.moduleId}</option>)}</Select>}
  {occurrenceAction&&!allowed&&<p role="status">{t("This action is not currently available for the selected session.","הפעולה אינה זמינה כרגע למפגש שנבחר.")}</p>}
  {action==="revise"&&<>
   <label><input type="checkbox" checked={timed} disabled={locked} onChange={e=>{setTimed(e.target.checked);dirty();}}/> {t("Choose actual approved dates and place","בחירת מועדים ומקום מאושרים בפועל")}</label>
   {timed&&<><FloridaTime id="fish-start" label={t("Start in Florida","התחלה בפלורידה")} value={start} choice={startChoice} locale={locale} locked={locked} onChange={(v,c)=>{setStart(v);setStartChoice(c);dirty();}}/><FloridaTime id="fish-end" label={t("End in Florida","סיום בפלורידה")} value={end} choice={endChoice} locale={locale} locked={locked} onChange={(v,c)=>{setEnd(v);setEndChoice(c);dirty();}}/>
    <Select id="fish-venue" label={t("Existing approved place","מקום קיים שאושר")} value={venueId} required disabled={locked} onChange={e=>{setVenueId(e.target.value);dirty();}}><option value="">{t("Choose an approved place","בחירת מקום מאושר")}</option>{data.operator.venues.map(v=><option key={v.id} value={v.id}>{v.label} · {v.capacity}</option>)}</Select>{venue?.address&&<p>{venue.address}</p>}
   </>}
   <Input id="fish-capacity" label={t("Child capacity","קיבולת ילדים")} required type="number" min={1} max={data.choice.childCapacity} value={capacity} disabled={locked} onChange={e=>{setCapacity(e.target.value);dirty();}}/>
   <Textarea id="fish-directions" label={t("Directions for enrolled families","הוראות הגעה למשפחות הרשומות")} maxLength={1200} value={directions} disabled={locked} onChange={e=>{setDirections(e.target.value);dirty();}}/>
   <Textarea id="fish-equipment" label={t("Equipment and preparation","ציוד והכנה")} maxLength={1200} value={equipment} disabled={locked} onChange={e=>{setEquipment(e.target.value);dirty();}}/>
   <Textarea id="fish-logistics" label={t("Family-visible logistical note","הערה לוגיסטית המוצגת למשפחות")} maxLength={1200} value={note} disabled={locked} onChange={e=>{setNote(e.target.value);dirty();}}/>
  </>}
  {action==="attendance"&&<><Select id="fish-attendee" label={t("Confirmed participant","משתתף שרישומו אושר")} required value={enrollmentId} disabled={locked} onChange={e=>{setEnrollmentId(e.target.value);dirty();}}><option value="">{t("Select a participant","בחירת משתתף")}</option>{data.operator.roster.map(r=><option key={r.enrollmentId} value={r.enrollmentId}>{r.displayName}</option>)}</Select><Select id="fish-attendance" label={t("Actual attendance","נוכחות בפועל")} required value={attendance} disabled={locked} onChange={e=>{setAttendance(e.target.value as typeof attendance);dirty();}}><option value="">{t("Choose actual attendance","בחירת הנוכחות בפועל")}</option>{[["present","Present","נוכח"],["late","Late","איחור"],["absent","Absent","נעדר"],["no_show","No show","לא הגיע"]].map(([id,en,he])=><option key={id} value={id}>{t(en!,he!)}</option>)}</Select></>}
  {action==="confirm_makeup"&&<><Select id="fish-makeup-notice" label={t("Outstanding participant notice","דיווח משתתף שממתין לטיפול")} required value={noticeId} disabled={locked} onChange={e=>{setNoticeId(e.target.value);setFitId("");dirty();}}><option value="">{t("Select a notice","בחירת דיווח")}</option>{data.operator.makeupNotices.map(n=><option key={n.id} value={n.id}>{data.operator.roster.find(r=>r.enrollmentId===n.enrollmentId)?.displayName} · {data.view?.notices.find(v=>v.id===n.id)?.receivedAt}</option>)}</Select>
   <Select id="fish-makeup-fit" label={t("Existing reviewed suitable replacement","מקום חלופי שנבדק ונמצא מתאים")} required value={fitId} disabled={locked||!notice} onChange={e=>{setFitId(e.target.value);dirty();}}><option value="">{t("Select a current suitability decision","בחירת בדיקת התאמה תקפה")}</option>{fits.map(f=><option key={f.id} value={f.id}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(f.startsAt))} · {f.label}</option>)}</Select>{notice&&!fits.length&&<p role="status">{t("No current suitability decision is recorded for this participant. A reviewed decision is required; no place has been reserved.","לא תועדה בדיקת התאמה תקפה למשתתף זה. נדרשת החלטה לאחר בדיקה; לא נשמר מקום.")}</p>}</>}
  {!["create","publish"].includes(action)&&<Textarea id="fish-change-reason" label={t("Reason visible to the enrolled family","סיבה המוצגת למשפחה הרשומה")} required maxLength={1200} value={reason} disabled={locked} onChange={e=>{setReason(e.target.value);dirty();}}/>}
  {action==="publish"&&<p>{t("Review all twelve entries first. Only scheduled published entries reserve instructor and venue capacity. Undated entries create no booking.","עיינו תחילה בכל 12 הרשומות. רק רשומות עם מועד שפורסמו שומרות קיבולת מדריך ומקום. רשומות ללא מועד אינן יוצרות הזמנה.")}</p>}
  {action==="cancel"&&<p role="alert">{t("Cancellation preserves the original record and undelivered service. It does not mark a child absent or create a fee.","הביטול שומר את הרשומה המקורית ואת השירות שטרם סופק. הוא אינו מסמן ילד כנעדר ואינו יוצר חיוב.")}</p>}
  {action==="complete"&&<p>{t("Only a scheduled session that has actually started can be marked delivered. The server verifies its current time and state; this does not record attendance.","רק מפגש מתוכנן שכבר החל יכול להיות מסומן כמפגש שהתקיים. השרת מאמת את השעה והמצב הנוכחיים; פעולה זו אינה מתעדת נוכחות.")}</p>}
  {missingReference&&<p role="status">{t("Select the required current participant, attendance, approved place or reviewed replacement before saving.","לפני שמירה יש לבחור את המשתתף, הנוכחות, המקום המאושר או ההשלמה שנבדקה בהתאם לפעולה.")}</p>}
  {error&&<p role="alert">{error}</p>}<div className="lsw-actions"><Button type="submit" disabled={locked||changed||!allowed||missingReference}>{t("Save deliberate action","שמירת הפעולה שנבחרה")}</Button><Button type="button" variant="secondary" disabled={locked} onClick={onCancel}>{t("Cancel editing","ביטול העריכה")}</Button></div>
 </form>;
}
