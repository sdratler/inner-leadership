import type {AcademyAgreementBundle} from './academy-agreements.ts';
import type {Locale} from '../../lib/locale.ts';
const names={en:{participation_safety:'Participation & Safety Agreement',program:'Program Policies',privacy:'Privacy Notice',payment_cancellation:'Payment & Cancellation Terms',child_conduct:'Child Conduct Acknowledgment'},he:{participation_safety:'הסכם השתתפות ובטיחות',program:'מדיניות התוכנית',privacy:'הודעת פרטיות',payment_cancellation:'תנאי תשלום וביטול',child_conduct:'אישור כללי התנהגות לילד'}};
/** Exact imported text only. No substitute waiver or inferred child signature. */
export function AcademyAgreementFields({bundle,locale}:{bundle:AcademyAgreementBundle;locale:Locale}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 return <section lang={locale} dir={locale==='he'?'rtl':'ltr'} style={{fontSize:'12pt',overflowWrap:'anywhere'}} data-academy-agreements>
  <p>{t('Legal operator','המפעיל המשפטי')}: {bundle.legalOperator}</p><p>{t('Released parties','הצדדים המשוחררים')}: {bundle.releasedParties.join(', ')}</p>
  <p lang="en" dir="ltr" style={{fontSize:'18pt',fontWeight:800,whiteSpace:'pre-wrap',border:'3px solid currentColor',padding:'1rem'}}>{bundle.statutoryWarning}</p>
  {bundle.documents.filter(d=>d.language===locale).map(d=><details key={d.kind}><summary>{names[locale][d.kind]} · <bdi>{d.version}</bdi></summary><div style={{whiteSpace:'pre-wrap'}}>{d.body}</div></details>)}
  <label className="lsw-field">{t('Parent or authorized guardian signature (full name)','חתימת הורה או אפוטרופוס מורשה (שם מלא)')}<input className="lsw-input" name="parentSignature" required maxLength={160} autoComplete="name"/></label>
  <label className="lsw-field"><span><input type="checkbox" name="childAcknowledged" value="yes" required/> {t('This boy personally acknowledged the Child Conduct Acknowledgment shown above. This is separate from my parent agreement.','ילד זה אישר בעצמו את כללי ההתנהגות המוצגים לעיל. אישור זה נפרד מהסכמתי כהורה.')}</span></label>
  <label className="lsw-field"><span><input type="checkbox" name="guardianWitnessed" value="yes" required/> {t('I witnessed this child’s acknowledgment.','הייתי עד/ה לאישורו של ילד זה.')}</span></label>
 </section>;
}
