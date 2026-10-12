"use client";
import {useRef,useState} from "react";
import type {FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {IdentityClientError,sessionInfo} from "../identity/client.ts";
import {classifyGroupPlacementSaveFailure,fishingDraftLabels,fishingPracticeModuleKeys,isFishingDraftLabel,recordFishingPracticeCommandSchema,
 type DraftGroupRecord,type FishingPracticeModuleKey,type FishingPracticeRevisionRecord,type ProposedPlacementRecord,
 type RecordFishingPracticeCommand} from "./contract.ts";
import styles from "./workspace.module.css";

export type FishingDraftContext={
 label:string;
 fields:readonly {key:"participants"|"fees"|"dates"|"cadence"|"staffing"|"venue"|"attendance";label:string;value:string}[];
};

export function fishingDraftContext(locale:Locale):FishingDraftContext{
 const he=locale==="he",unset=he?"לא הוגדר":"Unset";
 return {label:he?fishingDraftLabels[1]:fishingDraftLabels[0],fields:[
  {key:"participants",label:he?"משתתפים":"Participants",value:he?"לא נוספו על ידי התבנית":"None added by this starter"},
  {key:"fees",label:he?"תשלום":"Fee",value:unset},
  {key:"dates",label:he?"תאריכים":"Dates",value:unset},
  {key:"cadence",label:he?"תדירות":"Cadence",value:unset},
  {key:"staffing",label:he?"צוות":"Staffing",value:unset},
  {key:"venue",label:he?"מקום":"Venue",value:unset},
  {key:"attendance",label:he?"נוכחות":"Attendance",value:he?"חסומה עד לאישור מועד ומשתתפים מורשים":"Blocked until an occurrence and authorized participants are confirmed"},
 ]};
}

export function FishingProgramStarter({locale,onPrepare,disabled,hasUnsavedLabel}:{locale:Locale;onPrepare:()=>void;disabled:boolean;hasUnsavedLabel:boolean}){
 const he=locale==="he",context=fishingDraftContext(locale),t=(en:string,hebrew:string)=>he?hebrew:en;
 return <section className={styles.programStarter} aria-labelledby="fishing-program-draft-heading">
  <div><p className={styles.eyebrow}>{t("Reusable program context","הקשר תוכנית לשימוש חוזר")}</p><h3 id="fishing-program-draft-heading">{t("Fishing program — planning draft","תוכנית דיג — טיוטת תכנון")}</h3></div>
  <p>{t("Start with the existing private group tools: a draft group, verified service interests, proposed placements and proposed occurrences. The starter fills only an administrative label.",
   "מתחילים בכלי הקבוצות הפרטיים הקיימים: קבוצת טיוטה, התעניינויות מאומתות בשירות, הצעות שיבוץ ומועדים מוצעים. התבנית ממלאת רק תווית מנהלית.")}</p>
  <dl>{context.fields.map(item=><div key={item.key}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
  <p className={styles.boundary}>{t("Planning only. Preparing this draft does not enroll, book, charge, message, confirm participation or record attendance.",
   "תכנון בלבד. הכנת הטיוטה אינה רושמת, קובעת, מחייבת, שולחת הודעה, מאשרת השתתפות או מתעדת נוכחות.")}</p>
  <div className={styles.starterActions}><button type="button" className="lsw-button lsw-button--secondary" aria-controls="draft-group-label" disabled={disabled||hasUnsavedLabel} onClick={onPrepare}>{t("Prepare fishing draft","הכנת טיוטת דיג")}</button>
   {hasUnsavedLabel&&<small>{t("The current unsaved label is preserved. Clear it before applying this starter.","התווית שלא נשמרה נשמרת. יש למחוק אותה לפני החלת התבנית.")}</small>}</div>
 </section>;
}

export const fishingPracticeModules:readonly {key:FishingPracticeModuleKey;en:string;he:string}[]=[
 {key:"knots",en:"Knot tying",he:"קשירת קשרים"},{key:"rod_rigging",en:"Rigging a rod",he:"הרכבת חכה"},
 {key:"terminal_tackle",en:"Sinkers, weights, leaders and hooks",he:"משקולות, עופרות, לידרים וקרסים"},
 {key:"field_casting",en:"Field casting",he:"הטלה בשטח"},{key:"fish_fighting",en:"Practising fighting a fish",he:"תרגול מאבק בדג"},
 {key:"equipment_selection",en:"Equipment selection",he:"בחירת ציוד"},
];
export function isFishingProgramGroup(group:Pick<DraftGroupRecord,"label">){return isFishingDraftLabel(group.label);}
type Draft={evidenceState:"practice_observed"|"no_evidence_yet";note:string};
type Notice={kind:"saved"|"error"|"uncertain";message:string};

export function FishingPracticeChecklist({locale,group,placements,revisions,reload}:{locale:Locale;group:DraftGroupRecord;
 placements:ProposedPlacementRecord[];revisions:FishingPracticeRevisionRecord[];reload:()=>Promise<void>}){
 const t=(en:string,he:string)=>locale==="he"?he:en,pending=useRef(new Map<string,RecordFishingPracticeCommand>());
 const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[notices,setNotices]=useState<Record<string,Notice>>({}),[busy,setBusy]=useState("");
 const key=(placementId:string,moduleKey:FishingPracticeModuleKey)=>`${placementId}:${moduleKey}`;
 const current=(placementId:string,moduleKey:FishingPracticeModuleKey)=>revisions.find(item=>item.proposedPlacementId===placementId&&item.moduleKey===moduleKey&&item.revisionStatus==="current")??null;
 const history=(placementId:string,moduleKey:FishingPracticeModuleKey)=>revisions.filter(item=>item.proposedPlacementId===placementId&&item.moduleKey===moduleKey)
  .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const change=(recordKey:string,patch:Partial<Draft>,fallback:Draft)=>setDrafts(value=>({...value,[recordKey]:{...(value[recordKey]??fallback),...patch}}));
 async function save(event:FormEvent<HTMLFormElement>,placement:ProposedPlacementRecord,moduleKey:FishingPracticeModuleKey){
  event.preventDefault();const recordKey=key(placement.id,moduleKey);if(busy)return;const existing=current(placement.id,moduleKey),values=new FormData(event.currentTarget),prior=pending.current.get(recordKey),
   parsed=prior?{success:true as const,data:prior}:recordFishingPracticeCommandSchema.safeParse({action:"record_fishing_practice",operationId:crypto.randomUUID(),
    draftGroupId:group.id,proposedPlacementId:placement.id,moduleKey,evidenceState:values.get("evidenceState"),note:values.get("note"),expectedRevisionId:existing?.id??null});
  if(!parsed.success){setNotices(value=>({...value,[recordKey]:{kind:"error",message:t("Review the bounded observation fields.","יש לבדוק את שדות התצפית המוגבלים.")}}));return;}
  const command=parsed.data,previouslyUncertain=Boolean(prior);if(!prior)pending.current.set(recordKey,command);setBusy(recordKey);setNotices(value=>{const copy={...value};delete copy[recordKey];return copy;});let requestStarted=false;
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new Error();requestStarted=true;const response=await fetch("/api/private/group-placement",{method:"POST",
    headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(command)});
   if(!response.ok){const failure=classifyGroupPlacementSaveFailure(true,response.status,previouslyUncertain);if(failure!=="unconfirmed")pending.current.delete(recordKey);
    if(response.status===409)await reload();setNotices(value=>({...value,[recordKey]:{kind:failure==="unconfirmed"?"uncertain":"error",message:
     failure==="unconfirmed"?t("Save is unconfirmed. Keep this page open and retry the exact same observation.","השמירה לא אומתה. יש להשאיר דף זה פתוח ולנסות שוב את אותה תצפית בדיוק."):
     response.status===401?t("Sign in again, then review and save this observation.","יש להתחבר מחדש, לבדוק ולשמור את התצפית."):
     response.status===403?t("Your current account cannot record practice evidence.","החשבון הנוכחי אינו מורשה לתעד ראיות תרגול."):
     response.status===404?t("This draft learner is no longer available. Refresh before recording evidence.","הלומד בטיוטה אינו זמין עוד. יש לרענן לפני תיעוד ראיות."):
     response.status===409?t("A newer correction was saved. Your edits remain here; review the current evidence and save again.","נשמר תיקון חדש יותר. העריכות נשארו כאן; יש לבדוק את הראיה העדכנית ולשמור שוב."):
     t("The observation was not saved. Review it and try again.","התצפית לא נשמרה. יש לבדוק ולנסות שוב.")}}));return;}
   const body=await response.json();if(!body.ok||body.data?.saved!==true)throw new Error();pending.current.delete(recordKey);setDrafts(value=>{const copy={...value};delete copy[recordKey];return copy;});
   setNotices(value=>({...value,[recordKey]:{kind:"saved",message:t("Practice evidence saved and read back. Placement, attendance, trip review and billing did not change.","ראיית התרגול נשמרה ונקראה בחזרה. השיבוץ, הנוכחות, בדיקת היציאה והתשלום לא השתנו.")}}));await reload();
  }catch(error){if(!requestStarted||error instanceof IdentityClientError&&error.code==="UNAUTHENTICATED")pending.current.delete(recordKey);
   const uncertain=requestStarted;setNotices(value=>({...value,[recordKey]:{kind:uncertain?"uncertain":"error",message:uncertain?
    t("Save is unconfirmed. Keep this page open and retry the exact same observation.","השמירה לא אומתה. יש להשאיר דף זה פתוח ולנסות שוב את אותה תצפית בדיוק."):
    t("Sign in again, then review and save this observation.","יש להתחבר מחדש, לבדוק ולשמור את התצפית.")}}));
  }finally{setBusy("");}
 }
 return <section className={styles.practice} aria-labelledby={`fishing-practice-heading-${group.id}`}>
  <header><p className={styles.eyebrow}>{t("Owner-only draft","טיוטה לבעלים בלבד")}</p><h4 id={`fishing-practice-heading-${group.id}`}>{t("Fishing practice checklist","רשימת תרגול דיג")}</h4></header>
  <p className={styles.boundary}>{t("Practical evidence for review only. No score or pass rule is set, and an empty check is not a failure.","ראיות מעשיות לבדיקה בלבד. לא הוגדרו ציון או כלל מעבר, וסימון ריק אינו כישלון.")}</p>
  {placements.length===0?<p className={styles.empty}>{t("No current proposed learner. Add a proposed placement before recording practice evidence.","אין לומד עם הצעת שיבוץ נוכחית. יש להוסיף הצעת שיבוץ לפני תיעוד ראיות תרגול.")}</p>:placements.map(placement=><article className={styles.learner} key={placement.id}>
   <header><h5>{placement.personLabel}</h5><p>{t("Proposed placement only — not enrolled","הצעת שיבוץ בלבד — ללא הרשמה")}</p></header>
   <div className={styles.tripReview}><strong>{t("Trip review","בדיקת יציאה")}</strong><span>{t("Not decided","טרם הוחלט")}</span><small>{t("Practice evidence does not authorize attendance or a trip.","ראיית תרגול אינה מאשרת נוכחות או יציאה.")}</small></div>
   <ol className={styles.modules}>{fishingPracticeModules.map(module=>{const recordKey=key(placement.id,module.key),saved=current(placement.id,module.key),draft=drafts[recordKey]??{evidenceState:saved?.evidenceState??"practice_observed",note:saved?.note??""},notice=notices[recordKey],items=history(placement.id,module.key);
    return <li key={module.key} data-module={module.key}><div className={styles.moduleHeading}><div><h6>{locale==="he"?module.he:module.en}</h6><small>{t("Planned criterion: Unset","קריטריון מתוכנן: לא הוגדר")}</small></div><strong className={saved?.evidenceState==="practice_observed"?styles.observed:styles.unrecorded}>{!saved?t("No evidence yet","עדיין אין ראיה"):saved.evidenceState==="practice_observed"?t("Practice observed","התרגול נצפה"):t("No evidence yet — correction recorded","עדיין אין ראיה — נשמר תיקון")}</strong></div>
     {saved?.note&&<p dir="auto" className={styles.practiceNote}>{saved.note}</p>}
     {notice&&<p role={notice.kind==="error"?"alert":"status"} className={notice.kind==="uncertain"?styles.uncertain:undefined}>{notice.message}</p>}
     <details className={styles.practiceAction}><summary>{saved?t("Record a correction","תיעוד תיקון"):t("Record observation","תיעוד תצפית")}</summary>
      <form onSubmit={event=>void save(event,placement,module.key)}><label>{t("Evidence state","מצב הראיה")}<select name="evidenceState" value={draft.evidenceState} onChange={event=>change(recordKey,{evidenceState:event.target.value as Draft["evidenceState"]},draft)} disabled={busy===recordKey||Boolean(pending.current.get(recordKey))}>
       <option value="practice_observed">{t("Practice observed","התרגול נצפה")}</option><option value="no_evidence_yet">{t("Correct to no evidence yet","תיקון לעדיין אין ראיה")}</option></select></label>
       <label>{t("Optional factual note","הערה עובדתית אופציונלית")}<textarea name="note" maxLength={500} value={draft.note} onChange={event=>change(recordKey,{note:event.target.value},draft)} disabled={busy===recordKey||Boolean(pending.current.get(recordKey))}/></label>
       <button type="submit" className="lsw-button lsw-button--primary" disabled={Boolean(busy)&&busy!==recordKey}>{busy===recordKey?t("Saving…","שומר…"):pending.current.has(recordKey)?t("Retry exact same save","ניסיון חוזר לאותה שמירה בדיוק"):saved?t("Save correction","שמירת תיקון"):t("Save observation","שמירת תצפית")}</button></form></details>
     {items.length>0&&<details className={styles.practiceHistory}><summary>{t("Observation history","היסטוריית תצפיות")}</summary><ol>{items.map(item=><li key={item.id}><strong>{item.evidenceState==="practice_observed"?t("Practice observed","התרגול נצפה"):t("No evidence yet","עדיין אין ראיה")}</strong><time dateTime={item.createdAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(item.createdAt))}</time><small>{t("Practitioner ref","מזהה מטפל")} <bdi dir="ltr">{item.recordedBy.slice(0,8)}</bdi></small>{item.note&&<span dir="auto">{item.note}</span>}</li>)}</ol></details>}
    </li>;})}</ol>
  </article>)}
 </section>;
}
