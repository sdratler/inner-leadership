import type {Locale} from "../../lib/locale.ts";
import type {AcademyIntake,AcademyDriveLimit} from "./academy-intake.ts";

export function academyDriveLabel(limit:AcademyDriveLimit,locale:Locale){
 if(typeof limit==="number")return locale==="he"?`עד ${limit} דקות`:`Up to ${limit} minutes`;
 const values={up_to_30:["Up to 30 minutes","עד 30 דקות"],up_to_45:["Up to 45 minutes","עד 45 דקות"],up_to_60:["Up to 60 minutes","עד 60 דקות"],over_60:["More than 60 minutes","יותר מ־60 דקות"]} as const;
 return values[limit][locale==="he"?1:0];
}
/** Current native inquiry preferences, not an entitlement or verified offer. */
export function AcademyIntakeReadback({intake,locale}:{intake:AcademyIntake;locale:Locale}){
 const he=locale==="he",t=(en:string,hebrew:string)=>he?hebrew:en;
 const grade={grade_3_5:t("Grades 3–5","כיתות ג׳–ה׳"),grade_6_8:t("Grades 6–8","כיתות ו׳–ח׳"),grade_9_12:t("Grades 9–12","כיתות ט׳–י״ב"),discuss:t("Discuss with me","לתיאום איתי")};
 const schooling={school:t("Attends school","לומד בבית ספר"),homeschool:t("Homeschool","חינוך ביתי"),discuss:t("Discuss with me","לתיאום איתי")};
 const tackle={ready:t("Has a personal tackle box","יש ארגז ציוד אישי"),need_advice:t("Needs tackle-box advice","נדרשת הכוונה לארגז ציוד"),not_sure:t("Not sure","לא בטוח/ה")};
 const languages={en:t("English","אנגלית"),he:t("Hebrew","עברית"),either:t("Either language","כל אחת מהשפות")};
 const stages={foundation:t("Foundation","יסודות"),independent:t("Independent","עצמאות"),advanced:t("Advanced","מתקדמים"),leadership:t("Leadership","מנהיגות"),discuss:t("Discuss with me","לתיאום איתי")};
 const keys={parent_drive:t("Parent drive","נסיעה עם הורה"),shuttle_interest:t("Interested in an optional shuttle","עניין בהסעה אופציונלית"),alternative:t("Interested in an alternative","עניין בחלופה"),discuss:t("Discuss with me","לתיאום איתי")};
 const offshore={interested:t("Interested","מעוניינים"),not_interested:t("Not interested","לא מעוניינים"),discuss:t("Discuss with me","לתיאום איתי")};
 return <details data-academy-intake lang={locale} dir={he?"rtl":"ltr"}>
  <summary>{t("Application preferences","העדפות הפנייה")}</summary>
  <dl>
   <dt>{t("Next step","הצעד הבא")}</dt><dd>{intake.nextStep==="callback"?t("Request a callback","בקשה לשיחה חוזרת"):t("Continue toward enrollment — request only","המשך לקראת הרשמה — בקשה בלבד")}</dd>
   <dt>{t("ZIP code","מיקוד")}</dt><dd><bdi dir="ltr">{intake.postalCode}</bdi></dd>
   <dt>{t("Maximum normal one-way drive","נסיעה רגילה מרבית לכיוון אחד")}</dt><dd>{academyDriveLabel(intake.driveLimit,locale)}</dd>
   <dt>{t("Preferred areas","אזורים מועדפים")}</dt><dd>{intake.preferredAreas??t("Not specified","לא נמסר")}</dd>
   <dt>{t("Preferred group language","שפה מועדפת לקבוצה")}</dt><dd>{languages[intake.preferredGroupLanguage]}</dd>
   <dt>{t("Stage interest — not placement","עניין בשלב — לא שיבוץ")}</dt><dd>{stages[intake.stagePreference]}</dd>
   <dt>{t("Keys travel interest — not booked","עניין בנסיעה לקיז — לא הזמנה")}</dt><dd>{keys[intake.keysTravel]}</dd>
   <dt>{t("Optional offshore interest — not booked","עניין בים הפתוח — לא הזמנה")}</dt><dd>{offshore[intake.offshoreInterest]}</dd>
   <dt>{t("Confirmation email — not a delivery receipt","דוא״ל לאישור הפנייה — לא אישור מסירה")}</dt><dd>{intake.confirmationEmail?<bdi dir="ltr">{intake.confirmationEmail}</bdi>:t("No separate confirmation address provided","לא נמסרה כתובת נפרדת לאישור הפנייה")}</dd>
   <dt>{t("Travel notes","הערות על נסיעה")}</dt><dd>{intake.travelNotes??t("Not specified","לא נמסר")}</dd>
  </dl>
  <ol aria-label={t("Learner preferences","העדפות הלומדים")}>{intake.learners.map((learner,index)=><li key={index} data-academy-intake-learner><h4>{t("Child","ילד")} {index+1}</h4><dl>
   {learner.ageYears!==undefined&&<><dt>{t("Age (years)","גיל בשנים")}</dt><dd>{learner.ageYears}</dd></>}<dt>{t("Grade band","טווח כיתות")}</dt><dd>{grade[learner.gradeBand]}</dd><dt>{t("Schooling","מסגרת לימודים")}</dt><dd>{schooling[learner.schooling]}</dd><dt>{t("Personal tackle box","ארגז ציוד אישי")}</dt><dd>{tackle[learner.tackleBox]}</dd>
  </dl></li>)}</ol>
  <p>{t("This saved inquiry does not enroll a child, reserve a founding-family place, confirm a group, book transport or authorize payment.","הפנייה שנשמרה אינה רושמת ילד, שומרת מקום למשפחה מייסדת, מאשרת קבוצה, מזמינה הסעה או מאשרת תשלום.")}</p>
 </details>;
}
