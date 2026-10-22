import type {Locale} from "../../lib/locale.ts";
import type {AccountRole} from "../identity/types.ts";
import {academySessionCreditPublicSummarySchema,type AcademySessionCreditPublicSummary} from '../fishing/academy-session-credit-public-contract.ts';

export type AcademySessionCreditSummaryProps=Readonly<{summary:AcademySessionCreditPublicSummary;locale:Locale;role:AccountRole;
 selectedEnrollmentId:string;selectedLearnerId:string}>;
/** Already authorized selected-child readback only. Root must discard stale
 * projections on selection/access changes. HTTP must use the public service
 * projection; private native records never enter these props. No fetch, policy
 * or booking action and no financial/source/reservation identifiers. */
export function AcademySessionCreditSummary({summary,locale,role,selectedEnrollmentId,selectedLearnerId}:AcademySessionCreditSummaryProps){
 const parsed=academySessionCreditPublicSummarySchema.safeParse(summary);if(role!=='parent'||!parsed.success||parsed.data.enrollmentId!==selectedEnrollmentId||parsed.data.learnerId!==selectedLearnerId)return null;
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <section className="lsw-stack" lang={locale} dir={locale==="he"?"rtl":"ltr"} data-academy-session-credit-summary
  aria-label={t("Original-session replacement credits","זכאות להשלמת המפגש המקורי")}>
  <h2>{t("Original-session replacement credits","זכאות להשלמת המפגש המקורי")}</h2>
  {parsed.data.credits.length===0?<p>{t("No replacement credit is recorded for this child.","לא נרשמה לילד זה זכאות להשלמה.")}</p>:<ol className="lsw-stack">
   {parsed.data.credits.map(credit=><li className="lsw-card" key={credit.id} data-academy-credit-id={credit.id} data-academy-credit-state={credit.state}>
    <h3>{t("Original session","המפגש המקורי")} {credit.originalOrdinal}</h3>
    <p>{credit.state==="delivered"?t("This original session has been fulfilled.","המפגש המקורי הזה סופק."):
     t("The replacement credit for this original session is preserved.","הזכאות להשלמת המפגש המקורי הזה נשמרת.")}</p>
    {credit.state==="replacement_reserved"?<p>{t("A replacement reservation is recorded. The session remains undelivered.","נרשמה הזמנה למפגש חלופי. המפגש טרם סופק.")}</p>:
     credit.state==="outstanding"?<p>{t("A suitable replacement still needs confirmation.","עדיין נדרש אישור למפגש חלופי מתאים.")}</p>:null}
    {credit.state!=="delivered"&&<p>{t("A particular date or seat is not guaranteed.","אין הבטחה לתאריך מסוים או למקום במפגש.")}</p>}
   </li>)}
  </ol>}
 </section>;
}
