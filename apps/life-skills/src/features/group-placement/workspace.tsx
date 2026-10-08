"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {sessionInfo} from "../identity/client.ts";
import {draftGroupCommandSchema,moveProposedPlacementCommandSchema,proposedPlacementCommandSchema,type DraftGroupCommand,type GroupPlacementList,
 type MoveProposedPlacementCommand,type ProposedPlacementCommand,type ProposedPlacementRecord} from "./contract.ts";
import styles from "./workspace.module.css";

export function classifyGroupPlacementSaveFailure(requestStarted:boolean,status?:number,previouslyUncertain=false){
 if(status===401)return "reauth" as const;
 if(status!==undefined&&status>=400&&status<500)return "correctable" as const;
 if(previouslyUncertain)return "unconfirmed" as const;
 if(!requestStarted)return "reauth" as const;
 return "unconfirmed" as const;
}
export function availableGroupInterests(data:GroupPlacementList,groupId:string){
 const placed=new Set(data.proposedPlacements.filter(item=>item.draftGroupId===groupId).map(item=>item.serviceInterestId));
 return data.eligibleGroupInterests.filter(item=>!placed.has(item.id));
}
export function availableMoveDestinations(data:GroupPlacementList,source:ProposedPlacementRecord){
 const occupied=new Set(data.proposedPlacements.filter(item=>item.serviceInterestId===source.serviceInterestId).map(item=>item.draftGroupId));
 return source.proposalStatus==="current"?data.draftGroups.filter(group=>group.id!==source.draftGroupId&&!occupied.has(group.id)):[];
}
export function groupInterestProvenance(item:Pick<GroupPlacementList["eligibleGroupInterests"][number],"sourceInquiryId"|"sourceInquiryCreatedAt">,locale:Locale){
 const date=new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(item.sourceInquiryCreatedAt));
 return `${locale==="he"?"פנייה":"Inquiry"} ${date} · ${locale==="he"?"מזהה":"ref"} ${item.sourceInquiryId.slice(0,8)}`;
}
export function proposalMovementDate(value:string,locale:Locale){return new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-GB",
 {dateStyle:"short",timeStyle:"short",timeZone:"Asia/Jerusalem"}).format(new Date(value));}
export function GroupPlacementWorkspace({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const draftForm=useRef<HTMLFormElement>(null),draftPending=useRef<DraftGroupCommand|null>(null),placementPending=useRef<ProposedPlacementCommand|null>(null),
  movePending=useRef<MoveProposedPlacementCommand|null>(null);
 const [data,setData]=useState<GroupPlacementList|null>(null),[loadError,setLoadError]=useState(""),[draftBusy,setDraftBusy]=useState(false),
  [draftUncertain,setDraftUncertain]=useState(false),[draftError,setDraftError]=useState(""),[draftSaved,setDraftSaved]=useState(false),
  [placementBusy,setPlacementBusy]=useState(""),[placementUncertain,setPlacementUncertain]=useState(""),
  [placementError,setPlacementError]=useState<{groupId:string;message:string}|null>(null),[placementSaved,setPlacementSaved]=useState(""),
  [moveBusy,setMoveBusy]=useState(""),[moveUncertain,setMoveUncertain]=useState(""),
  [moveError,setMoveError]=useState<{proposalId:string;message:string}|null>(null),[moveSaved,setMoveSaved]=useState("");
 const load=useCallback(async()=>{
  try{const response=await fetch("/api/private/group-placement",{cache:"no-store"}),body=await response.json();if(!response.ok||!body.ok)throw new Error();
   setData(body.data);setLoadError("");
  }catch{setData(null);setLoadError(locale==="he"?"לא ניתן לטעון קבוצות טיוטה. זו אינה רשימה ריקה.":"Draft groups could not be loaded. This is not an empty list.");}
 },[locale]);
 useEffect(()=>{let active=true;fetch("/api/private/group-placement",{cache:"no-store"}).then(async response=>{
   const body=await response.json();if(!response.ok||!body.ok)throw new Error();return body.data as GroupPlacementList;
  }).then(result=>{if(active){setData(result);setLoadError("");}}).catch(()=>{if(active)setLoadError(locale==="he"?"לא ניתן לטעון קבוצות טיוטה. זו אינה רשימה ריקה.":"Draft groups could not be loaded. This is not an empty list.");});
  return()=>{active=false;};},[locale]);
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(draftPending.current||placementPending.current||movePending.current){event.preventDefault();event.returnValue="";}};
  window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[]);
 async function saveDraft(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(draftBusy)return;setDraftSaved(false);setDraftError("");const previouslyUncertain=draftUncertain;
  if(!draftPending.current){const values=new FormData(event.currentTarget),parsed=draftGroupCommandSchema.safeParse({action:"create_draft_group",operationId:crypto.randomUUID(),label:values.get("label")});
   if(!parsed.success){setDraftError(t("Enter a short administrative label.","יש להזין תווית מנהלית קצרה."));return;}draftPending.current=parsed.data;}
  setDraftBusy(true);let requestStarted=false;
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new Error();requestStarted=true;
   const response=await fetch("/api/private/group-placement",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(draftPending.current)});
   if(!response.ok&&classifyGroupPlacementSaveFailure(true,response.status,previouslyUncertain)!=="unconfirmed"){
    draftPending.current=null;setDraftUncertain(false);setDraftError(response.status===401?t("Sign in again, then review and save this draft group.","יש להתחבר מחדש, לבדוק ולשמור את קבוצת הטיוטה."):
     response.status===403?t("Your current account cannot create draft groups.","החשבון הנוכחי אינו מורשה ליצור קבוצות טיוטה."):
     response.status===409?t("This save conflicts with an earlier request. Review the label and save again.","השמירה מתנגשת בבקשה קודמת. בדקו את התווית ושמרו שוב."):
     t("The draft group was not saved. Check the label and try again.","קבוצת הטיוטה לא נשמרה. בדקו את התווית ונסו שוב."));return;}
   const body=await response.json();if(!response.ok||!body.ok||body.data?.saved!==true)throw new Error();
   draftPending.current=null;setDraftUncertain(false);draftForm.current?.reset();setDraftSaved(true);await load();
  }catch{if(classifyGroupPlacementSaveFailure(requestStarted,undefined,previouslyUncertain)==="reauth"){
    draftPending.current=null;setDraftUncertain(false);setDraftError(t("Sign in again, then review and save this draft group.","יש להתחבר מחדש, לבדוק ולשמור את קבוצת הטיוטה."));
   }else{setDraftUncertain(true);setDraftError(t("Save is unconfirmed. Keep this page open and retry the same draft group; no placement, message or payment is triggered.",
    "השמירה לא אומתה. השאירו את הדף פתוח ונסו שוב את אותה קבוצת טיוטה; לא נוצרים שיבוץ, הודעה או תשלום."));}}
  finally{setDraftBusy(false);}
 }
 async function savePlacement(event:FormEvent<HTMLFormElement>,draftGroupId:string){
  event.preventDefault();if(placementBusy)return;const placementForm=event.currentTarget;setPlacementSaved("");setPlacementError(null);const previouslyUncertain=placementUncertain===draftGroupId;
  if(!placementPending.current){const values=new FormData(event.currentTarget),parsed=proposedPlacementCommandSchema.safeParse({action:"propose_group_placement",operationId:crypto.randomUUID(),draftGroupId,serviceInterestId:values.get("serviceInterestId")});
   if(!parsed.success){setPlacementError({groupId:draftGroupId,message:t("Select one saved group service interest.","בחרו התעניינות שמורה אחת בשירות קבוצה.")});return;}placementPending.current=parsed.data;
  }else if(placementPending.current.draftGroupId!==draftGroupId)return;
  setPlacementBusy(draftGroupId);let requestStarted=false;
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new Error();requestStarted=true;
   const response=await fetch("/api/private/group-placement",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(placementPending.current)});
   if(!response.ok&&classifyGroupPlacementSaveFailure(true,response.status,previouslyUncertain)!=="unconfirmed"){
    placementPending.current=null;setPlacementUncertain("");setPlacementError({groupId:draftGroupId,message:response.status===401?t("Sign in again, then review and save this proposal.","יש להתחבר מחדש, לבדוק ולשמור את ההצעה."):
     response.status===403?t("Your current account cannot propose placements.","החשבון הנוכחי אינו מורשה להציע שיבוצים."):
     response.status===404?t("The draft group or saved group interest is no longer available. Refresh and choose again.","קבוצת הטיוטה או ההתעניינות השמורה אינן זמינות עוד. רעננו ובחרו שוב."):
     response.status===409?t("This save conflicts with an earlier request. Refresh before trying again.","השמירה מתנגשת בבקשה קודמת. רעננו לפני ניסיון נוסף."):
     t("The proposal was not saved. Check the selection and try again.","ההצעה לא נשמרה. בדקו את הבחירה ונסו שוב.")});return;}
   const body=await response.json();if(!response.ok||!body.ok||body.data?.saved!==true)throw new Error();
   placementPending.current=null;setPlacementUncertain("");placementForm.reset();setPlacementSaved(draftGroupId);await load();
  }catch{if(classifyGroupPlacementSaveFailure(requestStarted,undefined,previouslyUncertain)==="reauth"){
    placementPending.current=null;setPlacementUncertain("");setPlacementError({groupId:draftGroupId,message:t("Sign in again, then review and save this proposal.","יש להתחבר מחדש, לבדוק ולשמור את ההצעה.")});
   }else{setPlacementUncertain(draftGroupId);setPlacementError({groupId:draftGroupId,message:t("Save is unconfirmed. Keep this page open and retry the same proposal; no trial, enrollment, message or payment is triggered.",
    "השמירה לא אומתה. השאירו את הדף פתוח ונסו שוב את אותה הצעה; לא נוצרים ניסיון, הרשמה, הודעה או תשלום.")});}}
  finally{setPlacementBusy("");}
 }
 async function saveMove(event:FormEvent<HTMLFormElement>,source:ProposedPlacementRecord){
  event.preventDefault();if(moveBusy)return;const moveForm=event.currentTarget;setMoveSaved("");setMoveError(null);const previouslyUncertain=moveUncertain===source.id;
  if(!movePending.current){const values=new FormData(event.currentTarget),parsed=moveProposedPlacementCommandSchema.safeParse({action:"move_group_placement",
    operationId:crypto.randomUUID(),sourceProposedPlacementId:source.id,destinationDraftGroupId:values.get("destinationDraftGroupId")});
   if(!parsed.success){setMoveError({proposalId:source.id,message:t("Select one unused destination draft group.","בחרו קבוצת טיוטה פנויה אחת כיעד.")});return;}
   movePending.current=parsed.data;
  }else if(movePending.current.sourceProposedPlacementId!==source.id)return;
  setMoveBusy(source.id);let requestStarted=false;
  try{const session=await sessionInfo();if(session.role!=="practitioner")throw new Error();requestStarted=true;
   const response=await fetch("/api/private/group-placement",{method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:JSON.stringify(movePending.current)});
   if(!response.ok&&classifyGroupPlacementSaveFailure(true,response.status,previouslyUncertain)!=="unconfirmed"){
    movePending.current=null;setMoveUncertain("");setMoveError({proposalId:source.id,message:response.status===401?t("Sign in again, then review and move this proposal.","יש להתחבר מחדש, לבדוק ולהעביר את ההצעה."):
     response.status===403?t("Your current account cannot move proposals.","החשבון הנוכחי אינו מורשה להעביר הצעות."):
     response.status===404?t("The proposal or destination group is no longer available. Reload and choose again.","ההצעה או קבוצת היעד אינן זמינות עוד. טענו מחדש ובחרו שוב."):
     response.status===409?t("This proposal changed or the destination is no longer available. Reload before choosing another unused group.","ההצעה השתנתה או שקבוצת היעד אינה זמינה עוד. טענו מחדש לפני בחירת קבוצה פנויה אחרת."):
     t("The proposal was not moved. Review the destination and try again.","ההצעה לא הועברה. בדקו את קבוצת היעד ונסו שוב.")});
    if(response.status===404||response.status===409)await load();return;
   }
   const body=await response.json();if(!response.ok||!body.ok||body.data?.saved!==true)throw new Error();
   movePending.current=null;setMoveUncertain("");moveForm.reset();setMoveSaved(source.id);await load();
  }catch{if(classifyGroupPlacementSaveFailure(requestStarted,undefined,previouslyUncertain)==="reauth"){
    movePending.current=null;setMoveUncertain("");setMoveError({proposalId:source.id,message:t("Sign in again, then review and move this proposal.","יש להתחבר מחדש, לבדוק ולהעביר את ההצעה.")});
   }else{setMoveUncertain(source.id);setMoveError({proposalId:source.id,message:t("Save is unconfirmed. Keep this page open and retry the exact same move; no trial, enrollment, message or payment is triggered.",
    "השמירה לא אומתה. השאירו את הדף פתוח ונסו שוב את אותה העברה בדיוק; לא נוצרים ניסיון, הרשמה, הודעה או תשלום.")});}}
  finally{setMoveBusy("");}
 }
 return <section className={styles.planning} aria-labelledby="draft-groups-heading">
  <header className={styles.header}><div><p className={styles.eyebrow}>{t("Owner planning","תכנון הבעלים")}</p><h2 id="draft-groups-heading">{t("Draft groups and proposed placements","קבוצות טיוטה והצעות שיבוץ")}</h2></div>
   <button type="button" className="lsw-button lsw-button--secondary" disabled={draftBusy||Boolean(placementBusy)} onClick={()=>void load()}>{t("Refresh","רענון")}</button></header>
  <p className={styles.intro}>{t("Private planning only. A proposed placement is not a trial, enrollment, booking or financial obligation.",
   "תכנון פרטי בלבד. הצעת שיבוץ אינה ניסיון, הרשמה, הזמנה או התחייבות כספית.")}</p>
  {loadError&&<p role="alert">{loadError}</p>}
  {!data&&!loadError&&<p role="status">{t("Loading draft groups and proposals…","טוען קבוצות טיוטה והצעות…")}</p>}
  {data&&data.draftGroups.length===0&&<p className={styles.empty}>{t("No draft groups yet. Capacity, schedule, venue, fees and participation remain unset.",
   "עדיין אין קבוצות טיוטה. הקיבולת, לוח הזמנים, המקום, התשלום וההשתתפות אינם מוגדרים.")}</p>}
  {data?.draftGroups.map(group=>{const placements=data.proposedPlacements.filter(item=>item.draftGroupId===group.id),available=availableGroupInterests(data,group.id);
   return <article className={styles.group} key={group.id}><header><p className={styles.state}>{t("Draft group","קבוצת טיוטה")}</p><h3>{group.label}</h3></header>
    <p>{t("Schedule, venue, capacity, fees and participation: Unset.","לוח זמנים, מקום, קיבולת, תשלום והשתתפות: לא מוגדרים.")}</p>
    <h4>{t("Proposed placements","הצעות שיבוץ")}</h4>
    {placements.length===0?<p>{t("No proposed placements.","אין הצעות שיבוץ.")}</p>:<ul className={styles.placements}>{placements.map(item=>{
     const destinations=availableMoveDestinations(data,item),incoming=data.proposalMovements.find(move=>move.destinationProposedPlacementId===item.id),
      outgoing=data.proposalMovements.find(move=>move.sourceProposedPlacementId===item.id),
      previous=incoming?data.draftGroups.find(candidate=>candidate.id===incoming.sourceDraftGroupId):null,
      next=outgoing?data.draftGroups.find(candidate=>candidate.id===outgoing.destinationDraftGroupId):null;
     return <li id={`proposal-${item.id}`} key={item.id}><span>{item.personLabel} — {item.familyLabel}</span><small>{groupInterestProvenance(item,locale)}</small>
      <small className={item.proposalStatus==="moved"?styles.moved:styles.current}>{item.proposalStatus==="moved"?
       t("Moved proposal — not current, trial, or enrollment","הצעה שהועברה — אינה נוכחית, ניסיון או הרשמה"):
       t("Current proposed placement — not a trial or enrollment","הצעת שיבוץ נוכחית — לא ניסיון ולא הרשמה")}</small>
      {incoming&&<small>{t("Moved from","הועברה מתוך")} {previous?.label??t("an earlier draft group","קבוצת טיוטה קודמת")} · {proposalMovementDate(incoming.createdAt,locale)} · {t("practitioner ref","מזהה מטפל")} <bdi dir="ltr">{incoming.recordedBy.slice(0,8)}</bdi></small>}
      {outgoing&&<small>{t("Moved to","הועברה אל")} <a href={`#proposal-${outgoing.destinationProposedPlacementId}`}>{next?.label??t("the next draft group","קבוצת הטיוטה הבאה")}</a> · {proposalMovementDate(outgoing.createdAt,locale)} · {t("practitioner ref","מזהה מטפל")} <bdi dir="ltr">{outgoing.recordedBy.slice(0,8)}</bdi></small>}
      {moveError?.proposalId===item.id&&<p role="alert">{moveError.message}</p>}
      {moveSaved===item.id&&<p role="status">{t("Proposal movement saved and read back. The original remains in history; no trial, enrollment, message or payment was created.",
       "העברת ההצעה נשמרה ונקראה בחזרה. המקור נשמר בהיסטוריה; לא נוצרו ניסיון, הרשמה, הודעה או תשלום.")}</p>}
      {item.proposalStatus==="current"&&(destinations.length===0?<p className={styles.noMove}>{t("No unused draft group is available for this interest. Historical proposals cannot be reused as destinations.",
       "אין קבוצת טיוטה פנויה להתעניינות זו. לא ניתן להשתמש מחדש בהצעות היסטוריות כיעד.")}</p>:<details className={styles.moveAction}><summary>{t("Move proposal","העברת הצעה")}</summary>
       <p>{t("The original proposal stays in history. This does not create a trial or enrollment.","ההצעה המקורית נשמרת בהיסטוריה. פעולה זו אינה יוצרת ניסיון או הרשמה.")}</p>
       <form className={styles.compactForm} onSubmit={event=>void saveMove(event,item)}><label>{t("Unused destination draft group","קבוצת טיוטה פנויה כיעד")}<select name="destinationDraftGroupId" required disabled={moveUncertain===item.id}><option value="">{t("Select one","בחירה")}</option>{destinations.map(destination=><option key={destination.id} value={destination.id}>{destination.label}</option>)}</select></label>
        <button type="submit" className="lsw-button lsw-button--primary" disabled={Boolean(moveBusy)||moveUncertain!==""&&moveUncertain!==item.id}>{moveBusy===item.id?t("Saving…","שומר…"):moveUncertain===item.id?t("Retry exact same move","ניסיון חוזר לאותה העברה בדיוק"):t("Move proposal","העברת הצעה")}</button></form></details>)}
     </li>;
    })}</ul>}
    {placementError?.groupId===group.id&&<p role="alert">{placementError.message}</p>}
    {placementSaved===group.id&&<p role="status">{t("Proposed placement saved and read back. No trial, enrollment, message or payment was created.",
     "הצעת השיבוץ נשמרה ונקראה בחזרה. לא נוצרו ניסיון, הרשמה, הודעה או תשלום.")}</p>}
    {data.eligibleGroupInterests.length===0?<p>{t("Record a verified group service interest before proposing placement.","יש לרשום התעניינות מאומתת בשירות קבוצה לפני הצעת שיבוץ.")}</p>:available.length===0?<p>{t("Every saved group interest is already proposed for this draft group.","לכל ההתעניינויות השמורות בקבוצה כבר הוצע שיבוץ בקבוצת טיוטה זו.")}</p>:<details className={styles.action}><summary>{t("Propose placement","הצעת שיבוץ")}</summary>
     <form className={styles.compactForm} onSubmit={event=>void savePlacement(event,group.id)}><label>{t("Saved group service interest","התעניינות שמורה בשירות קבוצה")}<select name="serviceInterestId" required disabled={placementUncertain===group.id}><option value="">{t("Select one","בחירה")}</option>{available.map(item=><option key={item.id} value={item.id}>{item.personLabel} — {item.familyLabel} · {groupInterestProvenance(item,locale)}</option>)}</select></label>
      <button type="submit" className="lsw-button lsw-button--primary" disabled={Boolean(placementBusy)||placementUncertain!==""&&placementUncertain!==group.id}>{placementBusy===group.id?t("Saving…","שומר…"):placementUncertain===group.id?t("Retry same proposal","ניסיון חוזר לאותה הצעה"):t("Save proposed placement","שמירת הצעת שיבוץ")}</button></form></details>}
   </article>;})}
  {draftError&&<p role="alert">{draftError}</p>}{draftSaved&&<p role="status">{t("Draft group saved and read back. No placement, trial or enrollment was created.","קבוצת הטיוטה נשמרה ונקראה בחזרה. לא נוצרו שיבוץ, ניסיון או הרשמה.")}</p>}
  <details className={styles.action}><summary>{t("Add draft group","הוספת קבוצת טיוטה")}</summary><form ref={draftForm} className={styles.compactForm} onSubmit={saveDraft}>
   <label>{t("Administrative label","תווית מנהלית")}<input name="label" required maxLength={100} disabled={draftUncertain}/></label>
   <button type="submit" className="lsw-button lsw-button--primary" disabled={draftBusy}>{draftBusy?t("Saving…","שומר…"):draftUncertain?t("Retry same draft group","ניסיון חוזר לאותה קבוצת טיוטה"):t("Save draft group","שמירת קבוצת טיוטה")}</button></form></details>
 </section>;
}
