import bilingual from "./academy-bilingual-copy.json";
import copy from "./jlfa-core-copy.json";
export type AcademyText=Readonly<{en:string;he:string}>;
const text=(en:string,he:string):AcademyText=>({en,he});
const node=(index:number):AcademyText=>copy.nodes[index]!;

/** Curated PUBLIC Website03/V4 material only, never instructor keys or a native
 * cohort schedule. No approved map of 48 weekly venue/topic records was supplied.
 * Stage1's known opening and later grouped direction are kept distinct below. */
const legacyStages=[
 {slug:"foundation",number:1,title:text("Foundation Angler","דייג מתחיל"),theme:text("Making Connections, Tying Knots","יוצרים חיבורים, קושרים קשרים"),summary:text("Get to know your gear, organise your tackle and prepare for supervised fishing.","מכירים את הציוד, מארגנים את ארגז הדיג ומתכוננים לדיג בהשגחה."),paragraphs:[node(27),node(28),node(29),node(30)]},
 {slug:"independent",number:2,title:text("Independent Angler","דייג עצמאי"),theme:text("Free-lining, bottom fishing and changing conditions","דיג בחוט חופשי, דיג קרקעית ותנאים משתנים"),summary:text("Make more of your own setup decisions, compare approaches and explain your choices.","מקבלים יותר החלטות בהכנת הציוד, משווים גישות ומסבירים את הבחירות."),paragraphs:[node(32),node(33),node(34),node(35)]},
 {slug:"advanced",number:3,title:text("Advanced Angler","דייג מתקדם"),theme:text("Understanding the system","מבינים את המערכת"),summary:text("Read changing conditions, investigate what happened and adapt with a reasoned plan.","קוראים תנאים משתנים, בודקים מה קרה ומתאימים תוכנית מתוך שיקול דעת."),paragraphs:[node(37),node(38),node(39),node(40)]},
 {slug:"leadership",number:4,title:text("Leadership Angler","דייג מנהיג"),theme:text("Contributing without taking over","תורמים בלי להשתלט"),summary:text("Explain, demonstrate and support another learner while practising shared responsibility.","מסבירים, מדגימים ותומכים בלומד נוסף תוך תרגול אחריות משותפת."),paragraphs:[node(42),node(43),node(44),node(45)]},
] as const;
export const academyStages=legacyStages.map((stage,index)=>({...stage,...bilingual.stages[index]!,number:stage.number,paragraphs:stage.paragraphs}));
export type AcademyStage=(typeof academyStages)[number];
export const academyAgeDepth=[
 {label:text("Ages 8–10","גילי 8–10"),paragraphs:[text("Clear demonstrations, equipment care, concrete fishing challenges, cooperation and appropriate requests for help.","הדגמות ברורות, שמירה על ציוד, אתגרים מעשיים בדיג, שיתוף פעולה ובקשת עזרה.")]},
 {label:text("Ages 11–13","גילי 11–13"),paragraphs:[text("Compare methods, explain choices, troubleshoot tackle and practise collaboration.","השוואת שיטות, הסברת בחירות, פתרון בעיות בציוד ותרגול עבודת צוות.")]},
 {label:text("Ages 14–17","גילי 14–17"),paragraphs:[text("More demanding planning, adapting to conditions and helping peers appropriately under adult guidance.","תכנון מורכב יותר, התאמה לתנאים ועזרה נכונה לאחרים בליווי מבוגר.")]},
] as const;
export const academyVenues={
 salt:["Deerfield Beach International Fishing Pier","Pompano Beach Fisher Family Pier","Dania Beach Pier"],
 fresh:["Lake Ida West / East Parks","Burt Aaronson South County Regional Park","West Delray Regional Park"],
 more:["Oleta River State Park","East Greynolds Park","Amelia Earhart Park","South Pointe Park"],
} as const;
export const academyFoundationProgression=[
 {label:text("Meetings 1–2 · 2 hours each","מפגשים 1–2 · שעתיים כל אחד"),title:text("Start together at the park","מתחילים יחד בפארק"),body:text("Land-based initiation at a suitable approved park: meet the group, organize personal tackle, practise foundational knots and safe equipment handling. These are two separate preparation meetings.","פתיחה יבשתית בפארק מתאים ומאושר: היכרות עם הקבוצה, סידור ציוד אישי ותרגול קשרים בסיסיים ושימוש בטוח בציוד. אלו שני מפגשי הכנה נפרדים.")},
 {label:text("Meeting 3 · 3 hours","מפגש 3 · שלוש שעות"),title:text("Bass Pro Shops, Dania Beach","Bass Pro Shops, דניה ביץ׳"),body:text("A planned store learning visit, subject to confirmed access and arrangements. Connect equipment choices to what we will practise. The visit and practical arrangements are confirmed with families in advance.","ביקור לימודי מתוכנן בחנות, בכפוף לאישור גישה וסידורים. מחברים בין בחירת הציוד לבין התרגול. הביקור והסידורים המעשיים מאושרים עם המשפחות מראש.")},
 {label:text("Meeting 4 · 3 hours","מפגש 4 · שלוש שעות"),title:text("First supervised pier session","מפגש הדיג המפוקח הראשון במזח"),body:text("Deerfield is a candidate, subject to group-use permission, safety, capacity and current conditions. Pier fishing begins at the appropriate supervised part of the curriculum, not at initiation.","דירפילד הוא מיקום אפשרי, בכפוף לאישור שימוש קבוצתי, בטיחות, קיבולת ותנאים עדכניים. דיג במזח מתחיל בשלב המתאים והמפוקח של הלמידה, לא במפגשי הפתיחה.")},
 {label:text("Meetings 5–12","מפגשים 5–12"),title:text("Practise, reflect and build independence","מתרגלים, חושבים ומפתחים עצמאות"),body:text("Develop the group’s fishing and self-governance skills at suitable freshwater and saltwater locations. A safely confirmed pooled monthly Keys session replaces the participating group’s weekly meeting after the initial readiness ramp; it is not an extra tuition class or a guaranteed date.","מפתחים מיומנויות דיג והנהגה עצמית במקומות מתאימים במים מתוקים ומלוחים. לאחר תקופת ההכנה הראשונית, מפגש חודשי משותף בקיז שאושר כבטוח מחליף את המפגש השבועי של הקבוצה המשתתפת; אין זו תוספת שכר לימוד או הבטחה לתאריך.")},
] as const;
export const academyFishingSkills=[
 {title:text("Know your tackle","מכירים את הציוד"),body:text("Each boy maintains his own tackle box and fishing equipment. Learn to select, organise, inspect and care for what you use.","כל בן מתחזק את ארגז הדיג והציוד האישי שלו. לומדים לבחור, לארגן, לבדוק ולשמור על הציוד שבו משתמשים.")},
 {title:text("Rig, cast and adapt","מרכיבים, מטילים ומתאימים"),body:text("Practise knots, rigs, controlled casting, bait and lure selection. Explain what you chose, observe what happened and decide what to try next.","מתרגלים קשרים, ריגים, הטלה מבוקרת ובחירת פיתיונות ודמויים. מסבירים את הבחירה, מתבוננים במה שקרה ומחליטים מה לנסות בהמשך.")},
 {title:text("Read the water","קוראים את המים"),body:text("Connect habitat, tides, weather and season to the way we fish. Learn regulations and careful fish handling alongside practical technique.","מחברים בין בית הגידול, הגאות והשפל, מזג האוויר והעונה לשיטת הדיג. לומדים כללים וטיפול זהיר בדגים לצד המיומנות המעשית.")},
] as const;
export const academySelfGovernance=bilingual.gains;
export const academyQuestions=bilingual.questions;
