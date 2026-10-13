import type {Locale} from "../../lib/locale.ts";
import type {FloridaSchoolInquiryFields} from "./contract.ts";

export const schoolAgeLabels={under_8:["Under 8","מתחת לגיל 8"],"8_10":["8–10","8–10"],"11_13":["11–13","11–13"],"14_17":["14–17","14–17"],mixed:["Mixed ages","גילים מעורבים"],undecided:["Undecided","טרם הוחלט"]} as const;
export const schoolWeekdayLabels={monday:["Monday","יום שני"],tuesday:["Tuesday","יום שלישי"],wednesday:["Wednesday","יום רביעי"],thursday:["Thursday","יום חמישי"],friday:["Friday","יום שישי"],flexible:["Flexible","גמיש"]} as const;
export const schoolTransportLabels={yes:["Yes","כן"],no:["No","לא"],undecided:["Undecided","טרם הוחלט"]} as const;
export function SchoolInquiryDetails({fields,locale}:{fields:FloridaSchoolInquiryFields;locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en,index=locale==="he"?1:0;
 return <><p>{t("School/institution inquiry — Florida Fishing Academy","פניית בית ספר/מוסד — אקדמיית הדיג בפלורידה")}</p><p>{fields.contactName} · {fields.staffRole} · {fields.cityArea} · <bdi dir="ltr">{fields.contact}</bdi></p><p>{t("Approximate age band","טווח גילים משוער")}: <bdi dir="ltr">{schoolAgeLabels[fields.ageBand][index]}</bdi> · {t("Estimated group size","גודל קבוצה משוער")}: {fields.groupSize}</p><p>{t("Preferred weekday","יום מועדף")}: {schoolWeekdayLabels[fields.preferredWeekday][index]} · {t("School arranges transport","בית הספר מסדיר הסעה")}: {schoolTransportLabels[fields.schoolTransport][index]}</p><p>{t("Separate school decisionmaker conversation/quote review pending. Estimates are not capacity or availability. No guardian consent, family credit, student account, case, booking, payment or activity clearance is created.","ממתינה לשיחה נפרדת ולבדיקת הצעת מחיר עם הגורם המחליט בבית הספר. ההערכות אינן קיבולת או זמינות. לא נוצרו הסכמת הורה, יחידה משפחתית, חשבון תלמיד, תיק, הזמנה, תשלום או אישור לפעילות.")}</p></>;
}
