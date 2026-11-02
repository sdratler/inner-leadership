import type {Locale} from "../../lib/locale.ts";
import type {Trip390Interest} from "./academy-trip390-contract.ts";
import styles from "../group-interest/workspace.module.css";

/** Saved interest only. Language and consent come from the stored submission. */
export function AcademyTrip390Readback({fields,reference,receivedAt,locale}:{fields:Trip390Interest;reference:string;receivedAt:string;locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const language={en:t("English","אנגלית"),he:t("Hebrew","עברית"),either:t("Either language","כל אחת מהשפות")};
 const experience={new:t("New to fishing","ללא ניסיון בדיג"),some:t("Some experience","מעט ניסיון"),experienced:t("Experienced","מנוסה"),not_sure:t("Not sure","לא בטוחים")};
 const yesNo=(v:boolean)=>v?t("Yes","כן"):t("No","לא");
 const notice=fields.acknowledgment;
 return <article className={`lsw-card ${styles.record}`} data-trip390-interest={reference}>
  <h2><bdi>{fields.guardianName}</bdi></h2>
  <p>{t("Keys trip interest · awaiting owner review","התעניינות בטיול לקיז · ממתינה לבדיקת המנהל")}</p>
  <dl>
   <dt>{t("Inquiry reference","מספר הפנייה")}</dt><dd><bdi dir="ltr">{reference}</bdi></dd>
   <dt>{t("Received (Florida time)","התקבלה (שעון פלורידה)")}</dt><dd><time dateTime={receivedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(receivedAt))}</time></dd>
   <dt>{t("Email","דוא״ל")}</dt><dd><bdi dir="ltr">{fields.email}</bdi></dd>
   {fields.phone&&<><dt>{t("Phone","טלפון")}</dt><dd><bdi dir="ltr">{fields.phone}</bdi></dd></>}
   <dt>{t("City / area","עיר / אזור")}</dt><dd><bdi>{fields.city}</bdi></dd>
   <dt>{t("ZIP code","מיקוד")}</dt><dd><bdi dir="ltr">{fields.postalCode}</bdi></dd>
   <dt>{t("Parent message language","שפת ההודעות להורה")}</dt><dd>{language[fields.messageLanguage]}</dd>
   <dt>{t("Preferred instruction language","שפת הדרכה מועדפת")}</dt><dd>{fields.instructionLanguage?language[fields.instructionLanguage]:t("Not specified","לא צוינה")}</dd>
  </dl>
  <h3>{t("Children in this inquiry","הילדים בפנייה")}</h3>
  <ul>{fields.children.map(child=><li key={child.id}><strong><bdi>{child.name}</bdi></strong> · {t("Age","גיל")} {child.ageYears} · {experience[child.experience]}<br/>{t("Child ID","מזהה ילד")} <bdi dir="ltr">{child.id}</bdi></li>)}</ul>
  {fields.notes&&<><h3>{t("Parent notes","הערות ההורה")}</h3><p><bdi>{fields.notes}</bdi></p></>}
  <h3>{t("Saved acknowledgments","אישורי ההורה שנשמרו")}</h3>
  <dl>
   <dt>{t("Conduct rules explained","כללי ההתנהגות הוסברו")}</dt><dd>{yesNo(notice.conductExplained)}</dd>
   <dt>{t("Interest, privacy and safety acknowledgment","אישור תנאי ההתעניינות, הפרטיות והבטיחות")}</dt><dd>{yesNo(notice.interestPrivacySafety)}</dd>
   <dt>{t("WhatsApp permission","הסכמה להודעות WhatsApp")}</dt><dd>{yesNo(notice.whatsapp)}</dd>
   <dt>{t("Acknowledgment language","שפת האישור")}</dt><dd>{language[notice.language]}</dd>
   <dt>{t("Notice version","גרסת ההודעה")}</dt><dd><bdi dir="ltr">{notice.version}</bdi></dd>
   <dt>{t("Interest form version","גרסת טופס ההתעניינות")}</dt><dd><bdi dir="ltr">{fields.version}</bdi></dd>
   <dt>{t("Offer version","גרסת ההצעה")}</dt><dd><bdi dir="ltr">{fields.offerVersion}</bdi></dd>
  </dl>
 </article>;
}
