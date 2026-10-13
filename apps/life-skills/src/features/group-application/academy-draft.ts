import copy from "./presentation-copy.json" with {type:"json"};

/** Customer-only projection of reviewed LS-FISH-COPY-20261013-01.
 * Source copy SHA256 6f2d2839824c4658d6cd88fd2c86b338f32f91c844557e8e213f3b85e75e2256.
 * No private pricing, teacher guides, accounts or educational entitlements. */
type Pair={en:string;he:string};
const pair=(en:string,he:string):Pair=>({en,he});
export const academyLandingDraft={
 ...copy.academy,id:"sunday_fishing_academy" as const,slug:"",
 sectionBody:pair("The planned teaching sequence covers twelve modules over twelve weeks, moving from foundations to supervised field practice and advanced preparation. Each rank has four defined lesson or activity credits. Actual dates and outing completion are agreed separately before enrollment.","רצף הלימוד המתוכנן כולל שתים־עשרה יחידות לאורך שנים־עשר שבועות, מהיסודות דרך תרגול בשטח בהשגחה ועד להכנה מתקדמת. בכל דרגה ארבע יחידות זכאות לשיעור או לפעילות מוגדרים. המועדים בפועל והשלמת היציאות יסוכמו בנפרד לפני ההרשמה."),
 faqs:copy.academy.faqs.map<[Pair,Pair]>(entry=>[entry[0]!,entry[1]!]),
};
export const academyJourneyDraft={
 offer:pair("Private review, not an available agreement: a planned twelve-module teaching sequence over twelve weeks across three four-credit ranks. Rank A has three preparation credits and one planned supervised outing; Rank B has four defined supervised field credits; Rank C has three advanced preparation credits and one planned professionally captained and crewed offshore experience. Dates and outing completion are agreed separately. Discuss tuition and actual inclusions before any enrollment or payment; this rehearsal sells nothing.","לעיון פרטי, ולא הסכם זמין: רצף לימוד מתוכנן של שתים־עשרה יחידות לאורך שנים־עשר שבועות ובשלוש דרגות בנות ארבע יחידות זכאות. בדרגה A שלוש יחידות הכנה ויציאה מתוכננת אחת בהשגחה; בדרגה B ארבע יחידות שטח מוגדרות בהשגחה; בדרגה C שלוש יחידות הכנה מתקדמות והתנסות מתוכננת אחת בים הפתוח עם קברניט וצוות מקצועיים. המועדים והשלמת היציאות יסוכמו בנפרד. יש לדון בשכר הלימוד ובמה שייכלל בפועל לפני הרשמה או תשלום; הדוגמה אינה מוכרת דבר."),
 calendarInclusions:pair("The actual agreement must define each credit, its date/slot, inclusions, substitution/makeup, transfer/expiry and unused-service treatment. Four credits do not mean four consecutive Sundays. Included activity on an additional date is not a second purchase. Maximum offshore wait and actual terms remain unresolved; no policy is accepted in this rehearsal.","ההסכם בפועל חייב להגדיר כל יחידה, מועד ושעה, מה כלול, החלפה והשלמה, העברה ופקיעה וטיפול בשירות שלא סופק. ארבע יחידות אינן ארבעה ימי ראשון רצופים. פעילות כלולה במועד נוסף אינה רכישה שנייה. ההמתנה המרבית לים הפתוח והתנאים בפועל טרם הוסדרו; הדוגמה אינה מקבלת מדיניות."),
 enrollment:pair("No actual rank is purchased or allocated. A confirmed enrollment would identify the owned rank and exact agreement, supplied/remaining credits, completed learning, observed proficiency, separate instructor/guardian readiness and accepted activity timing. These are separate facts, not automatic clearance. Twelve elapsed weeks do not confirm an offshore departure.","לא נרכשה או הוקצתה דרגה בפועל. הרשמה מאושרת תזהה דרגה בבעלות והסכם מדויק, יחידות שסופקו ונותרו, למידה שהושלמה, יכולת מעשית שנצפתה, מוכנות נפרדת שנבדקה בידי המדריך וההורה ותזמון פעילות מוסכם. אלה עובדות נפרדות, ולא אישור אוטומטי. שנים־עשר שבועות שחלפו אינם מאשרים יציאה לים הפתוח."),
 access:pair("Proposed educational access: versioned lessons, assignments/submissions, objective knowledge marks, separately observed practical proficiency and parent-only progress. This path is not implemented. Parent verification, minimal learner data and separate educational permissions must precede access; clinical records remain isolated. Knowledge scores never clear a trip.","גישה חינוכית מוצעת: שיעורים לפי גרסה, מטלות והגשות, ציוני ידע עובדתי, יכולת מעשית שנצפתה בנפרד והתקדמות להורה בלבד. המסלול עדיין לא מומש. אימות הורה, מינימום מידע על הלומד והרשאות חינוכיות נפרדות חייבים להקדים גישה; רשומות קליניות נשארות מבודדות. ציוני ידע לעולם אינם מאשרים יציאה."),
};
// Presentation is the same; persistence and authentication remain mode-specific.
export const academyRollingLandingDraft=academyLandingDraft;
export const academyRollingJourneyDraft={
 ...academyJourneyDraft,
 creditState:pair("Illustrative only: 0 supplied / 4 remaining credits. No owned rank or credit ledger exists. Learning: no completion recorded. Proficiency: not assessed. Safety: not cleared. Timing: unconfirmed. This static example stores nothing and grants no access or trip permission.","המחשה בלבד: 0 יחידות שסופקו / 4 שנותרו. אין דרגה בבעלות או פנקס יחידות. למידה: לא נרשמה השלמה. יכולת מעשית: לא הוערכה. בטיחות: ללא אישור. תזמון: לא אושר. הדוגמה הקבועה אינה שומרת מידע או מעניקה גישה או אישור יציאה."),
};
export const academyLandingForMode=(mode:"native"|"sample")=>mode==="sample"?academyRollingLandingDraft:academyLandingDraft;
export const academyJourneyForMode=(mode:"native"|"sample")=>mode==="sample"?academyRollingJourneyDraft:academyJourneyDraft;
