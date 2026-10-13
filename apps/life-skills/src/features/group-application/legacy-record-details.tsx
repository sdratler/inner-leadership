import type {Locale} from "../../lib/locale.ts";
import type {IsraelReadableGroupApplicationFields} from "./contract.ts";

const observationLabels={
 intrinsicMotivation:["Intrinsic motivation","מוטיבציה פנימית"],expression:["Expressing thoughts and needs","הבעת מחשבות וצרכים"],
 selfGovernance:["Self-direction and decisions","הכוונה עצמית וקבלת החלטות"],valuesAndGoals:["Values and goals","ערכים ומטרות"],
 cooperation:["Cooperation","שיתוף פעולה"],socialConfidence:["Appropriate disagreement and social confidence","חוסר הסכמה מתאים וביטחון חברתי"],
 stressfulSituations:["Coping with stressful situations","התמודדות במצבים מלחיצים"],
} as const;
const observationValues={not_shared:["Not shared","לא נמסר"],going_well:["Generally going well","בדרך כלל הולך טוב"],sometimes_difficult:["Sometimes difficult","לפעמים קשה"],would_like_support:["Would like support","נשמח לתמיכה"]} as const;
const schedules={morning:["Morning","בוקר"],evening:["Evening","ערב"],flexible:["Flexible","גמיש"]} as const;
const screenAccess={not_shared:["Not shared","לא נמסר"],screens_at_home:["Screens at home","יש מסכים בבית"],no_screens_at_home:["No screens at home","אין מסכים בבית"],no_regular_access:["No regular access","אין גישה קבועה"],shared_device:["Shared device","מכשיר משותף"],own_device:["Own device","מכשיר אישי"]} as const;
const screenTimes={not_shared:["Not shared","לא נמסר"],none:["No screen time","ללא זמן מסך"],under_1_hour:["Under one hour","פחות משעה"],"1_to_2_hours":["1–2 hours","1–2 שעות"],"2_to_4_hours":["2–4 hours","2–4 שעות"],over_4_hours:["Over four hours","יותר מארבע שעות"],under_2_hours_weekly:["Under 2 hours weekly","פחות משעתיים בשבוע"],"2_to_5_hours_weekly":["2–5 hours weekly","2–5 שעות בשבוע"],"6_to_10_hours_weekly":["6–10 hours weekly","6–10 שעות בשבוע"],"11_to_20_hours_weekly":["11–20 hours weekly","11–20 שעות בשבוע"],over_20_hours_weekly:["Over 20 hours weekly","יותר מ־20 שעות בשבוע"],no_fixed_limit:["No fixed limit","ללא מגבלה קבועה"],not_sure:["Not sure","לא בטוחים"]} as const;

export function LegacyGroupApplicationDetails({fields,locale,className}:{fields:IsraelReadableGroupApplicationFields;locale:Locale;className?:string|undefined}){
 const index=locale==="he"?1:0,t=(en:string,he:string)=>locale==="he"?he:en;
 const observations=(Object.keys(observationLabels) as Array<keyof typeof observationLabels>).flatMap((key)=>{
  const value=fields.observations[key];
  return value===undefined?[]:[[key,value] as const];
 });
 return <>
  <p><strong>{t("Age","גיל")}:</strong> {fields.childAge} · <strong>{t("Preferred time","זמן מועדף")}:</strong> {schedules[fields.schedulePreference][index]}{fields.neighborhood?` · ${fields.neighborhood}`:""}</p>
  <details className={className}><summary>{t("Parent-provided application details","פרטים שנמסרו בבקשת ההורה")}</summary>
   {(fields.screenAccess||fields.screenTime)&&<p><strong>{t("Screens","מסכים")}:</strong> {[fields.screenAccess?screenAccess[fields.screenAccess][index]:null,fields.screenTime?screenTimes[fields.screenTime][index]:null].filter(Boolean).join(" · ")}</p>}
   {fields.interestedInEveningGroup!==undefined&&<p><strong>{t("Earlier evening-group preference","העדפת ערב מהטופס הקודם")}:</strong> {fields.interestedInEveningGroup?t("Yes","כן"):t("No","לא")}</p>}
   {observations.length>0&&<dl>{observations.map(([key,value])=><div key={key}><dt>{observationLabels[key][index]}</dt><dd>{observationValues[value][index]}</dd></div>)}</dl>}
   {fields.parentPriorities&&<div><strong>{t("What the parent most wants help with","במה ההורה מבקש סיוע במיוחד")}</strong><p>{fields.parentPriorities}</p></div>}
  </details>
 </>;
}
