import type {Locale} from "../../lib/locale.ts";
import type {AccountRole} from "../identity/types.ts";
import {academySessionPolicyNativeVersion,type AcademySessionCreditFamilySummary} from "../fishing/academy-session-policy-native-contract.ts";

export type AcademySessionCreditSummaryProps=Readonly<{summary:AcademySessionCreditFamilySummary;locale:Locale;role:AccountRole;
 selectedEnrollmentId:string;selectedLearnerId:string}>;
const present=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value===value.trim();
/** Already authorized selected-child readback only. Root must discard stale
 * projections on selection/access changes. No fetch, policy or booking action;
 * purchase, guardian, inquiry, source evidence and reservation IDs stay hidden. */
export function AcademySessionCreditSummary({summary,locale,role,selectedEnrollmentId,selectedLearnerId}:AcademySessionCreditSummaryProps){
 if(role!=="parent"||summary?.version!==academySessionPolicyNativeVersion||!present(selectedEnrollmentId)||!present(selectedLearnerId)||
  summary.enrollmentId!==selectedEnrollmentId||summary.learnerId!==selectedLearnerId||!Array.isArray(summary.credits)||summary.credits.length>1000)return null;
 const ids=new Set<string>(),originals=new Set<string>();
 for(const credit of summary.credits){
  if(!credit||!present(credit.id)||ids.has(credit.id)||credit.enrollmentId!==selectedEnrollmentId||!credit.anchor||credit.anchor.learnerId!==selectedLearnerId||
   ![credit.anchor.workspaceId,credit.anchor.cohortId,credit.anchor.stageId,credit.anchor.occurrenceId,credit.anchor.moduleId,credit.anchor.moduleVersion,credit.anchor.activityId].every(present)||
   !Number.isInteger(credit.anchor.ordinal)||credit.anchor.ordinal<1||credit.anchor.ordinal>12||originals.has(credit.anchor.occurrenceId)||
   !["outstanding","replacement_reserved","delivered"].includes(credit.state)||
   credit.state==="replacement_reserved"&&!present(credit.replacementReservationId)||credit.state==="outstanding"&&credit.replacementReservationId!==null)return null;
  ids.add(credit.id);originals.add(credit.anchor.occurrenceId);
 }
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <section className="lsw-stack" lang={locale} dir={locale==="he"?"rtl":"ltr"} data-academy-session-credit-summary
  aria-label={t("Original-session replacement credits","זכאות להשלמת המפגש המקורי")}>
  <h2>{t("Original-session replacement credits","זכאות להשלמת המפגש המקורי")}</h2>
  {summary.credits.length===0?<p>{t("No replacement credit is recorded for this child.","לא נרשמה לילד זה זכאות להשלמה.")}</p>:<ol className="lsw-stack">
   {summary.credits.map(credit=><li className="lsw-card" key={credit.id} data-academy-credit-id={credit.id} data-academy-credit-state={credit.state}>
    <h3>{t("Original session","המפגש המקורי")} {credit.anchor.ordinal}</h3>
    <p>{credit.state==="delivered"?t("This original session has been fulfilled.","המפגש המקורי הזה סופק."):
     t("The replacement credit for this original session is preserved.","הזכאות להשלמת המפגש המקורי הזה נשמרת.")}</p>
    {credit.state==="replacement_reserved"?<p>{t("A replacement reservation is recorded. The session remains undelivered.","נרשמה הזמנה למפגש חלופי. המפגש טרם סופק.")}</p>:
     credit.state==="outstanding"?<p>{t("A suitable replacement still needs confirmation.","עדיין נדרש אישור למפגש חלופי מתאים.")}</p>:null}
    {credit.state!=="delivered"&&<p>{t("A particular date or seat is not guaranteed.","אין הבטחה לתאריך מסוים או למקום במפגש.")}</p>}
   </li>)}
  </ol>}
 </section>;
}
