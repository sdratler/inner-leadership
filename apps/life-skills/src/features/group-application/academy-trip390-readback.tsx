import type {Locale} from "../../lib/locale.ts";
import {TRIP390_INTEREST_VERSION,type Trip390Interest} from "./academy-trip390-contract.ts";
import styles from "./inquiry-review.module.css";

/** Saved interest only. Language and consent come from the stored submission. */
export function AcademyTrip390Readback({fields,reference,receivedAt,locale}:{fields:Trip390Interest;reference:string;receivedAt:string;locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const language={en:t("English","אנגלית"),he:t("Hebrew","עברית"),either:t("Either language","כל אחת מהשפות")};
 const experience={new:t("New to fishing","ללא ניסיון בדיג"),some:t("Some experience","מעט ניסיון"),experienced:t("Experienced","מנוסה"),not_sure:t("Not sure","לא בטוחים")};
 const yesNo=(v:boolean)=>v?t("Yes","כן"):t("No","לא");
 const notice=fields.acknowledgment;
 return <article className={`lsw-card ${styles.detail}`} data-trip390-interest={reference}>
  <h2><bdi>{fields.guardianName}</bdi></h2>
  <p>{fields.version===TRIP390_INTEREST_VERSION?t("Saved Fishing Academy reservation request","בקשת מקום שמורה לאקדמיית הדיג"):t("Saved Keys trip inquiry","פנייה שמורה לטיול לקיז")}</p>
  <dl className={styles.facts}>
   <dt>{t("Inquiry reference","מספר הפנייה")}</dt><dd><bdi dir="ltr">{reference}</bdi></dd>
   <dt>{t("Received (Florida time)","התקבלה (שעון פלורידה)")}</dt><dd><time dateTime={receivedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(receivedAt))}</time></dd>
   <dt>{t("Email","דוא״ל")}</dt><dd><bdi dir="ltr">{fields.email}</bdi></dd>
   {fields.phone&&<><dt>{t("Phone","טלפון")}</dt><dd><bdi dir="ltr">{fields.phone}</bdi></dd></>}
   <dt>{t("City / area","עיר / אזור")}</dt><dd><bdi>{fields.city}</bdi></dd>
   <dt>{t("ZIP code","מיקוד")}</dt><dd><bdi dir="ltr">{fields.postalCode}</bdi></dd>
   <dt>{t("Parent message language","שפת ההודעות להורה")}</dt><dd>{language[fields.messageLanguage]}</dd>
   <dt>{t("Preferred instruction language","שפת הדרכה מועדפת")}</dt><dd>{fields.instructionLanguage?language[fields.instructionLanguage]:t("Not specified","לא צוינה")}</dd>
  </dl>
  {'lessonDayDriving' in fields&&<><h3>{fields.version===TRIP390_INTEREST_VERSION?t("Total local-lesson driving time","זמן הנסיעה הכולל לשיעור מקומי"):t("Total Sunday driving time", "זמן הנסיעה הכולל ביום ראשון")}</h3><p>{({up_to_30:t('Up to 30 minutes total','עד 30 דקות בסך הכול'),up_to_60:t('Up to 60 minutes total','עד 60 דקות בסך הכול'),up_to_90:t('Up to 90 minutes total','עד 90 דקות בסך הכול'),up_to_120:t('Up to 120 minutes total','עד 120 דקות בסך הכול'),flexible:t('Flexible','גמיש')})[fields.lessonDayDriving.limit]}</p></>}
  <h3>{t("Children in this inquiry","הילדים בפנייה")}</h3>
  <ul className={styles.children}>{fields.children.map(child=><li key={child.id}><strong><bdi>{child.name}</bdi></strong> · {t("Age","גיל")} {child.ageYears} · {experience[child.experience]}<br/>{t("Child ID","מזהה ילד")} <bdi dir="ltr">{child.id}</bdi></li>)}</ul>
  {'notes' in fields&&fields.notes&&<><h3>{t("Parent notes","הערות ההורה")}</h3><p className={styles.notes}><bdi>{fields.notes}</bdi></p></>}
  <details><summary>{t("Saved acknowledgments and versions","אישורי ההורה והגרסאות שנשמרו")}</summary>
  <dl className={styles.facts}>
   <dt>{t("Conduct rules explained","כללי ההתנהגות הוסברו")}</dt><dd>{yesNo(notice.conductExplained)}</dd>
   <dt>{t("Interest, privacy and safety acknowledgment","אישור תנאי ההתעניינות, הפרטיות והבטיחות")}</dt><dd>{yesNo(notice.interestPrivacySafety)}</dd>
   <dt>{t("WhatsApp permission","הסכמה להודעות WhatsApp")}</dt><dd>{yesNo(notice.whatsapp)}</dd>
   <dt>{t("Acknowledgment language","שפת האישור")}</dt><dd>{language[notice.language]}</dd>
   <dt>{t("Notice version","גרסת ההודעה")}</dt><dd><bdi dir="ltr">{notice.version}</bdi></dd>
   <dt>{t("Interest form version","גרסת טופס ההתעניינות")}</dt><dd><bdi dir="ltr">{fields.version}</bdi></dd>
   <dt>{t("Offer version","גרסת ההצעה")}</dt><dd><bdi dir="ltr">{fields.offerVersion}</bdi></dd>
  </dl>
  {'programTerms' in notice&&<><h3>{t('Saved Program Terms and privacy acceptance','תנאי התוכנית ואישור הפרטיות שנשמרו')}</h3><p><bdi dir="ltr">{notice.programTerms.version} · {notice.programTerms.textDigest}</bdi></p><pre className={styles.notes}>{notice.programTerms.text}</pre></>}
  {'reservationNotice' in notice&&<><h3>{t('Saved nonbinding reservation and privacy acknowledgment','אישור בקשת המקום והפרטיות שנשמר')}</h3><p><bdi dir="ltr">{notice.reservationNotice.version} · {notice.reservationNotice.textDigest}</bdi></p><pre className={styles.notes}>{notice.reservationNotice.text}</pre></>}
  {'studentConduct' in notice&&<><h3>{t('Saved parent read-to-child attestation','הצהרת ההורה על קריאה לילדים שנשמרה')}</h3><p>{t('Parent attestation only. No child signature, financial acceptance or participation waiver was collected.','הצהרת הורה בלבד. לא נאספו חתימת ילד, הסכמה כספית או כתב ויתור להשתתפות.')}</p><p><bdi dir="ltr">{notice.studentConduct.version} · {notice.studentConduct.textDigest}</bdi></p><pre className={styles.notes}>{notice.studentConduct.text}</pre></>}
  {'studentAgreement' in notice&&<><h3>{t('Saved guardian attestation','הצהרת ההורה שנשמרה')}</h3><p><bdi>{notice.studentAgreement.guardianTypedName}</bdi></p><p>{t('Guardian attestation, not a child signature. Recorded at the received time above.','הצהרת ההורה, לא חתימת הילד. נרשמה במועד קבלת הפנייה המופיע למעלה.')}</p><p><bdi dir="ltr">{notice.studentAgreement.version} · {notice.studentAgreement.textDigest}</bdi></p><pre className={styles.notes}>{notice.studentAgreement.text}</pre></>}
  </details>
 </article>;
}
