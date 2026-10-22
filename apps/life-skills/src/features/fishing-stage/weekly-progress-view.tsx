import type {Locale} from "../../lib/locale.ts";
import type {WeeklyPublication} from "./weekly-progress.ts";

const skills={equipment_care:["Equipment care","שמירה על הציוד"],rod_reel_line:["Rod, reel and line","חכה, רולר וחוט"],basic_knots:["Basic knots","קשרים בסיסיים"],rig_construction:["Rig construction","הרכבת מערך דיג"],casting_control:["Casting control","שליטה בהטלה"],safe_hook_handling:["Safe hook handling","שימוש בטוח בקרסים"],bait_terminal_tackle:["Bait and tackle","פיתיון ואביזרי קצה"],reading_conditions:["Reading the conditions","קריאת תנאי השטח"],fish_identification_handling:["Fish identification and handling","זיהוי דגים וטיפול בהם"],teamwork:["Teamwork","עבודת צוות"],listening:["Listening","הקשבה"],communication:["Communication","תקשורת"],persistence:["Persistence","התמדה"],self_governance:["Self-governance","הנהגה עצמית"]} as const;
export function weeklySkillLabel(skill:keyof typeof skills,locale:Locale){return skills[skill][locale==="he"?1:0];}
export function weeklyLevelLabel(level:"introduced"|"practicing"|"demonstrated",locale:Locale){return {introduced:["Introduced","היכרות"],practicing:["Practicing","בתרגול"],demonstrated:["Demonstrated","הודגם"]}[level][locale==="he"?1:0];}

/** Only the server's family-scoped, deliberately published safe DTO reaches here. */
export function WeeklyProgressView({updates,locale}:{updates:WeeklyPublication[];locale:Locale}){
 if(!updates.length)return null;
 const t=(en:string,he:string)=>locale==="he"?he:en;
 return <section aria-label={t("Published weekly fishing updates","עדכוני דיג שבועיים שפורסמו")} data-fishing-weekly-updates>
  <h3>{t("This week's fishing progress","ההתקדמות השבועית בדיג")}</h3>
  {updates.map(update=><article className="lsw-card" key={update.id+":"+update.version} lang={update.locale} dir={update.locale==="he"?"rtl":"ltr"}>
   <h4>{t("Weekly update","עדכון שבועי")} · <time dateTime={update.publishedAt}>{new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{timeZone:"America/New_York",year:"numeric",month:"short",day:"numeric"}).format(new Date(update.publishedAt))}</time></h4>
   <p>{update.groupWork}</p>
   <ul aria-label={t("Observed fishing skills","מיומנויות דיג שנצפו")}>{update.skills.map(skill=><li key={skill.skillId}>{weeklySkillLabel(skill.skillId,locale)} — {weeklyLevelLabel(skill.level,locale)}</li>)}</ul>
   <p>{update.nextStep}</p>{update.gearReminder&&<p><strong>{t("Bring next time:","לפעם הבאה:")}</strong> {update.gearReminder}</p>}
   {update.questionInvitation&&<p>{update.questionInvitation}</p>}
  </article>)}
 </section>;
}
