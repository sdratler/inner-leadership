"use client";
import type {Locale} from "../../lib/locale.ts";
import type {ReactNode} from "react";
import type {z} from "zod";
import type {academyFitSchema} from "./contract.ts";
import styles from "./application-form.module.css";

export function AcademyFitFields({locale,count,onCount,hideLegacyDrive=false,learnerDetails}:{locale:Locale;count:number;onCount:(count:number)=>void;hideLegacyDrive?:boolean;learnerDetails?:readonly ReactNode[]|undefined}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <fieldset className={styles.fit}><legend>{t("Who would like to join?","מי מעוניין להצטרף?")}</legend>
  <p>{t("Approximate ages and equipment/experience only. Do not enter child names, medical or emergency details.","גילים משוערים, ציוד וניסיון בלבד. אין למסור שמות ילדים או פרטים רפואיים ופרטי חירום.")}</p>
  <label>{t("Number of children, including siblings","מספר ילדים, כולל אחים")}<select name="learnerCount" value={count} onChange={event=>onCount(Number(event.target.value))}>
   {Array.from({length:10},(_,i)=><option value={i+1} key={i}>{i+1}</option>)}
  </select></label>
  {Array.from({length:count},(_,i)=><fieldset className={styles.fitLearner} key={i} data-academy-fit-learner><legend>{t("Child","ילד")} {i+1}</legend>
   <label>{t("Approximate age","גיל משוער")}<input name={`learnerAge-${i}`} type="number" min={0} max={17} step={1} required/></label>
   <label>{t("Personal rod/reel/tackle","חכה, רולר וציוד אישי")}<select name={`learnerGear-${i}`} defaultValue="not_sure">
    <option value="not_sure">{t("Not sure","לא בטוח/ה")}</option><option value="has_gear">{t("Has suitable gear","יש ציוד מתאים")}</option><option value="needs_advice">{t("Needs equipment advice","נדרשת הכוונה לגבי ציוד")}</option>
   </select></label>
   <label>{t("Fishing experience","ניסיון בדיג")}<select name={`learnerExperience-${i}`} defaultValue="not_sure">
    <option value="not_sure">{t("Not sure","לא בטוח/ה")}</option><option value="new">{t("New to fishing","חדש בדיג")}</option><option value="some">{t("Some experience","ניסיון מסוים")}</option><option value="experienced">{t("Experienced","מנוסה")}</option>
   </select></label>
   {learnerDetails?.[i]}
  </fieldset>)}
  {!hideLegacyDrive&&<label>{t("Maximum comfortable one-way drive, in minutes (optional)","זמן נסיעה מרבי נוח לכיוון אחד, בדקות (לא חובה)")}<input name="maximumDriveMinutes" type="number" min={0} max={240} step={1}/></label>}
  <label>{t("Can you arrange parent dropoff/pickup?","האם תוכלו להסדיר הבאה ואיסוף על ידי הורה?")}<select name="parentDropoff" defaultValue="discuss">
   <option value="discuss">{t("Discuss with me","לתיאום איתי")}</option><option value="yes">{t("Yes","כן")}</option><option value="no">{t("No","לא")}</option>
  </select></label>
 </fieldset>;
}
export function academyFitFromForm(values:FormData){
 const count=Number(values.get("learnerCount")),drive=values.get("maximumDriveMinutes");
 if(!Number.isInteger(count)||count<1||count>10)return null;
 return {version:"RM-FIT-20261014-04-v1",learners:Array.from({length:count},(_,i)=>({
  approximateAge:values.get(`learnerAge-${i}`)===null||values.get(`learnerAge-${i}`)===""?NaN:Number(values.get(`learnerAge-${i}`)),
  gear:values.get(`learnerGear-${i}`),experience:values.get(`learnerExperience-${i}`)})),
  ...(typeof drive==="string"&&drive.trim()?{maximumDriveMinutes:Number(drive)}:{}),parentDropoff:values.get("parentDropoff")};
}
export function AcademyFitReadback({fit,locale,driveLabel}:{fit:z.infer<typeof academyFitSchema>;locale:Locale;driveLabel?:string|undefined}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const gear={has_gear:t("Has gear","יש ציוד"),needs_advice:t("Equipment advice","הכוונה לציוד"),not_sure:t("Not sure","לא בטוח/ה")};
 const experience={new:t("New","חדש"),some:t("Some experience","ניסיון מסוים"),experienced:t("Experienced","מנוסה"),not_sure:t("Not sure","לא בטוח/ה")};
 return <details className={styles.fitReadback} data-academy-fit-readback><summary>{t("Group fit","התאמה לקבוצה")} · {fit.learners.length} {t("children","ילדים")}</summary>
  <ul>{fit.learners.map((learner,i)=><li key={i}>{t("Child","ילד")} {i+1} · {t("Approximate age","גיל משוער")} {learner.approximateAge} · {gear[learner.gear]} · {experience[learner.experience]}</li>)}</ul>
  <p>{t("One-way drive preference","העדפת נסיעה לכיוון אחד")}: {driveLabel??(fit.maximumDriveMinutes===undefined?t("Not specified","לא נמסר"):`${fit.maximumDriveMinutes} ${t("minutes","דקות")}`)} · {t("Parent dropoff","הבאה על ידי הורה")}: {fit.parentDropoff==="yes"?t("Yes","כן"):fit.parentDropoff==="no"?t("No","לא"):t("Discuss","לתיאום")}</p>
 </details>;
}
