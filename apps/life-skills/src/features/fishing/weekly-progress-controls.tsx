"use client";
import {useState,type FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {Button,Select,Textarea} from "../../ui/workspace/controls.tsx";
import type {FishingCalendarPlan} from "./program-calendar-contract.ts";
import type {NativeProgramCommandIntent} from "./native-program-contract.ts";
import type {StageCommand} from "../fishing-stage/contract.ts";
import {weeklyCommandSchema,weeklySkillIds,type WeeklyCommand} from "../fishing-stage/weekly-progress.ts";
import {weeklyLevelLabel,weeklySkillLabel} from "../fishing-stage/weekly-progress-view.tsx";

type Level="introduced"|"practicing"|"demonstrated";
type Skill=typeof weeklySkillIds[number];
/** Existing Calendar command/replay transport owns the one deliberate save. */
export function WeeklyProgressControls({data,locale,locked,onDirty,onSave,onCancel}:{data:FishingCalendarPlan;locale:Locale;locked:boolean;onDirty:(dirty:boolean)=>void;onSave:(command:StageCommand,intent:NativeProgramCommandIntent)=>void;onCancel:()=>void}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const [action,setAction]=useState<WeeklyCommand["action"]>("observe_skills"),[occurrenceId,setOccurrence]=useState(""),[enrollmentId,setEnrollment]=useState("");
 const [base,setBase]=useState(data.view?.revision??0),[dirty,setDirty]=useState(false),[error,setError]=useState(""),[reviewed,setReviewed]=useState(false);
 const [entries,setEntries]=useState<{skillId:Skill;level:Level;evidence:string}[]>([{skillId:"equipment_care",level:"practicing",evidence:""},{skillId:"basic_knots",level:"practicing",evidence:""}]);
 const [groupWork,setGroupWork]=useState(""),[nextStep,setNextStep]=useState(""),[gearReminder,setGearReminder]=useState(""),[invitation,setInvitation]=useState("");
 const state=data.view?.weeklyOperator??{observations:[],recaps:[]},selected=data.view?.occurrences.find(o=>o.id===occurrenceId),participant=data.operator.roster.find(row=>row.enrollmentId===enrollmentId);
 const attendance=data.view?.attendance.filter(a=>a.occurrenceId===occurrenceId&&a.enrollmentId===enrollmentId).at(-1),attended=attendance?.state==="present"||attendance?.state==="late";
 const observations=state.observations.filter(o=>o.occurrenceId===occurrenceId&&o.enrollmentId===enrollmentId),latestSkills=[...new Map(observations.map(o=>[o.skillId,o])).values()];
 const latest=state.recaps.filter(r=>r.occurrenceId===occurrenceId&&r.enrollmentId===enrollmentId).at(-1),changed=(data.view?.revision??0)!==base;
 const mark=()=>{setDirty(true);onDirty(true);setReviewed(false);};
 function target(kind:"occurrence"|"enrollment",value:string){if(dirty&&!window.confirm(t("Discard the unsaved weekly draft for this participant?","לוותר על טיוטת העדכון שלא נשמרה למשתתף הזה?")))return;
  if(kind==="occurrence")setOccurrence(value);else setEnrollment(value);setBase(data.view?.revision??0);setDirty(false);onDirty(false);setError("");setReviewed(false);setGroupWork("");setNextStep("");setGearReminder("");setInvitation("");setEntries(previous=>previous.map(e=>({...e,evidence:""})));}
 function submit(event:FormEvent){event.preventDefault();setError("");if(locked||changed||!selected||!participant||!attended)return;
  try{const operationId=crypto.randomUUID(),common={operationId,expectedRevision:base,occurrenceId:selected.id,expectedOccurrenceRevision:selected.revision,enrollmentId:participant.enrollmentId};let input:unknown;
   if(action==="observe_skills")input={...common,action,observations:entries.filter(e=>e.evidence.trim()).map(e=>({...e,evidence:e.evidence.trim()}))};
   else if(action==="draft_weekly_recap")input={...common,action,expectedRecapVersion:latest?.version??0,locale,groupWork,observationIds:latestSkills.map(o=>o.id),nextStep,gearReminder,questionInvitation:invitation};
   else{if(!latest||!reviewed)throw Error("REVIEW_REQUIRED");input={...common,action,recapId:latest.id,expectedRecapVersion:latest.version};}
   onSave(weeklyCommandSchema.parse(input),{operationId,resources:[],makeupFitDecisionId:null});
  }catch{setError(t("Check this participant, the observed skills and the required update fields. Nothing was saved.","בדקו את המשתתף, המיומנויות שנצפו ושדות העדכון הנדרשים. לא נשמר שינוי."));}}
 const validStage=selected?.state==="completed"&&selected.time.kind==="scheduled",ready=validStage&&participant&&attended;
 const reviewing=action==="review_weekly_recap"||action==="publish_weekly_recap",validRecap=latest&&(action==="review_weekly_recap"?latest.state==="draft":latest.state==="reviewed");
 return <form className="lsw-card lsw-stack" aria-label={t("Fishing skills and weekly update","מיומנויות דיג ועדכון שבועי")} onSubmit={submit}>
  <h3>{t("Skills and weekly update","מיומנויות ועדכון שבועי")}</h3>
  <Select id="weekly-occurrence" label={t("Delivered fishing session","מפגש דיג שהתקיים")} required disabled={locked} value={occurrenceId} onChange={e=>target("occurrence",e.target.value)}><option value="">{t("Choose a delivered session","בחירת מפגש שהתקיים")}</option>{data.view?.occurrences.filter(o=>o.state==="completed").map(o=><option key={o.id} value={o.id}>{t("Session","מפגש")} {o.ordinal} · {o.moduleId}</option>)}</Select>
  <Select id="weekly-enrollment" label={t("Participant for this weekly update","משתתף לעדכון השבועי")} required disabled={locked} value={enrollmentId} onChange={e=>target("enrollment",e.target.value)}><option value="">{t("Choose a confirmed participant","בחירת משתתף רשום")}</option>{data.operator.roster.map(row=><option key={row.enrollmentId} value={row.enrollmentId}>{row.displayName}</option>)}</Select>
  {selected&&participant&&!attended&&<p role="status">{t("Record this participant's actual attendance before recording skills or a weekly update.","יש לתעד את הנוכחות בפועל של המשתתף לפני תיעוד מיומנויות או עדכון שבועי.")}</p>}
  <Select id="weekly-action" label={t("Weekly action","פעולה בעדכון השבועי")} disabled={locked} value={action} onChange={e=>{setAction(e.target.value as WeeklyCommand["action"]);setReviewed(false);}}>
   <option value="observe_skills">{t("Record observed skills","תיעוד מיומנויות שנצפו")}</option><option value="draft_weekly_recap">{t("Write weekly update draft","כתיבת טיוטת עדכון שבועי")}</option><option value="review_weekly_recap">{t("Review weekly update","בדיקת עדכון שבועי")}</option><option value="publish_weekly_recap">{t("Publish reviewed weekly update","פרסום עדכון שבועי שנבדק")}</option>
  </Select>
  <fieldset disabled={locked||!ready}>
   {action==="observe_skills"&&<><p>{t("Record what you actually observed. Instructor evidence stays private; family wording is reviewed separately.","תעדו את מה שנצפה בפועל. ראיות המדריך נשארות פרטיות; הנוסח למשפחה נבדק בנפרד.")}</p>{entries.map((entry,index)=><fieldset key={index}><legend>{t("Observation","תצפית")} {index+1}</legend>
    <Select id={`weekly-skill-${index}`} label={t("Fishing skill","מיומנות דיג")} value={entry.skillId} onChange={e=>{setEntries(old=>old.map((o,i)=>i===index?{...o,skillId:e.target.value as Skill}:o));mark();}}>{weeklySkillIds.map(skill=><option key={skill} value={skill}>{weeklySkillLabel(skill,locale)}</option>)}</Select>
    <Select id={`weekly-level-${index}`} label={t("Observed level","רמת התצפית")} value={entry.level} onChange={e=>{setEntries(old=>old.map((o,i)=>i===index?{...o,level:e.target.value as Level}:o));mark();}}>{(["introduced","practicing","demonstrated"] as const).map(level=><option key={level} value={level}>{weeklyLevelLabel(level,locale)}</option>)}</Select>
    <Textarea id={`weekly-evidence-${index}`} label={t("Private instructor evidence","ראיה פרטית למדריך")} maxLength={600} value={entry.evidence} onChange={e=>{setEntries(old=>old.map((o,i)=>i===index?{...o,evidence:e.target.value}:o));mark();}}/>
   </fieldset>)}</>}
   {action==="draft_weekly_recap"&&<><p>{t("Selected skills come from this participant's saved observations for this delivered session.","המיומנויות שנבחרו נלקחות מהתצפיות השמורות למשתתף במפגש שהתקיים.")}</p><ul>{latestSkills.map(o=><li key={o.id}>{weeklySkillLabel(o.skillId,locale)} — {weeklyLevelLabel(o.level,locale)}</li>)}</ul>
    <Textarea id="weekly-work" label={t("What the group worked on","מה הקבוצה תרגלָה")} required maxLength={600} value={groupWork} onChange={e=>{setGroupWork(e.target.value);mark();}}/>
    <Textarea id="weekly-next" label={t("Next lesson or trip","השיעור או הטיול הבא")} required maxLength={400} value={nextStep} onChange={e=>{setNextStep(e.target.value);mark();}}/>
    <Textarea id="weekly-gear" label={t("Gear reminder","תזכורת ציוד")} maxLength={300} value={gearReminder} onChange={e=>{setGearReminder(e.target.value);mark();}}/>
    <Textarea id="weekly-question" label={t("Invitation for a parent question","הזמנה לשאלת הורה")} maxLength={200} value={invitation} onChange={e=>{setInvitation(e.target.value);mark();}}/>
   </>}
   {reviewing&&<>{latest?<div aria-label={t("Family update preview","תצוגה מקדימה לעדכון המשפחה")}><p>{latest.groupWork}</p><ul>{latest.skills.map(skill=><li key={skill.skillId}>{weeklySkillLabel(skill.skillId,locale)} — {weeklyLevelLabel(skill.level,locale)}</li>)}</ul><p>{latest.nextStep}</p><p>{latest.gearReminder}</p><p>{latest.questionInvitation}</p></div>:<p>{t("Save a weekly draft first.","יש לשמור טיוטת עדכון תחילה.")}</p>}
    {validRecap?<label><input type="checkbox" checked={reviewed} onChange={e=>{setReviewed(e.target.checked);setDirty(true);onDirty(true);}}/> {t("I reviewed this child's update and it is accurate and safe to share with this family.","בדקתי את העדכון לילד זה והוא מדויק ומתאים לשיתוף עם המשפחה הזאת.")}</label>:<p role="status">{t("This draft is not in the required review state. Reload the current saved update.","הטיוטה אינה במצב הבדיקה הנדרש. טענו את העדכון השמור הנוכחי.")}</p>}
   </>}
  </fieldset>
  {changed&&<div role="alert"><p>{t("The saved stage changed. Your unsaved draft is retained.","השלב השמור השתנה. הטיוטה שלא נשמרה נשמרת במסך.")}</p><Button variant="secondary" disabled={locked} onClick={()=>{setBase(data.view?.revision??0);setReviewed(false);}}>{t("Use current revision, keep my weekly draft","שימוש בגרסה הנוכחית ושמירת טיוטת העדכון")}</Button></div>}
  {error&&<p role="alert">{error}</p>}
  <div className="lsw-actions"><Button type="submit" disabled={locked||changed||!ready||reviewing&&(!validRecap||!reviewed)||action==="draft_weekly_recap"&&!latestSkills.length}>{action==="observe_skills"?t("Save observed skills","שמירת מיומנויות שנצפו"):action==="draft_weekly_recap"?t("Save weekly draft","שמירת טיוטה שבועית"):action==="review_weekly_recap"?t("Approve this weekly update","אישור העדכון השבועי"):t("Publish in this family's account","פרסום בחשבון המשפחה הזאת")}</Button><Button variant="secondary" disabled={locked} onClick={onCancel}>{t("Close","סגירה")}</Button></div>
 </form>;
}
