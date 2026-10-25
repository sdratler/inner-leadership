import {academyTripCopy} from './academy-trip-copy.ts';
import bilingual from "./academy-bilingual-copy.json";
import copy from "./jlfa-core-copy.json";
export type AcademyText=Readonly<{en:string;he:string}>;
const text=(en:string,he:string):AcademyText=>({en,he});
// Apply the current public amendment without rewriting the historical source.
const node=(index:number):AcademyText=>{const n=copy.nodes[index]!;return text(n.en.replaceAll('teaching a knot without taking over','teaching a knot through encouragement, guidance and teamwork').replaceAll('help another learner without taking over','help other boys develop their skills through encouragement, guidance, and teamwork').replaceAll('helping someone without taking over','helping others develop their skills through encouragement, guidance, and teamwork').replaceAll('Contributing without taking over','Encouragement, guidance and teamwork'),n.he.replaceAll('לימוד קשר בלי להשתלט על המשימה','לימוד קשר באמצעות עידוד, הכוונה ועבודת צוות').replaceAll('עוזרים ללומד אחר בלי להשתלט','עוזרים לבנים אחרים לפתח את המיומנויות שלהם באמצעות עידוד, הכוונה ועבודת צוות').replaceAll('עזרה למישהו בלי להשתלט','עזרה לאחרים לפתח מיומנויות באמצעות עידוד, הכוונה ועבודת צוות').replaceAll('תורמים בלי להשתלט','עידוד, הכוונה ועבודת צוות'));};

/** Curated PUBLIC Website03/V4 material only, never instructor keys or a native
 * cohort schedule. No approved map of 48 weekly venue/topic records was supplied.
 * Stage1's known opening and later grouped direction are kept distinct below. */
const legacyStages=[
 {slug:"foundation",number:1,title:text("Foundation Angler","דייג מתחיל"),theme:text("Making Connections, Tying Knots","יוצרים חיבורים, קושרים קשרים"),summary:text("Get to know your gear, organise your tackle and prepare for supervised fishing.","מכירים את הציוד, מארגנים את ארגז הדיג ומתכוננים לדיג בהשגחה."),paragraphs:[node(27),node(28),node(29),node(30)]},
 {slug:"independent",number:2,title:text("Independent Angler","דייג עצמאי"),theme:text("Free-lining, bottom fishing and changing conditions","דיג בחוט חופשי, דיג קרקעית ותנאים משתנים"),summary:text("Make more of your own setup decisions, compare approaches and explain your choices.","מקבלים יותר החלטות בהכנת הציוד, משווים גישות ומסבירים את הבחירות."),paragraphs:[node(32),node(33),node(34),node(35)]},
 {slug:"advanced",number:3,title:text("Advanced Angler","דייג מתקדם"),theme:text("Understanding the system","מבינים את המערכת"),summary:text("Read changing conditions, investigate what happened and adapt with a reasoned plan.","קוראים תנאים משתנים, בודקים מה קרה ומתאימים תוכנית מתוך שיקול דעת."),paragraphs:[node(37),node(38),node(39),node(40)]},
 {slug:"leadership",number:4,title:text("Leadership Angler","דייג מנהיג"),theme:text("Encouragement, guidance and teamwork","עידוד, הכוונה ועבודת צוות"),summary:text("Explain, demonstrate and support another learner while practising shared responsibility.","מסבירים, מדגימים ותומכים בלומד נוסף תוך תרגול אחריות משותפת."),paragraphs:[node(42),node(43),node(44),node(45)]},
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
 {label:text("Meetings 1–2 · 2 hours each","מפגשים 1–2 · שעתיים כל אחד"),title:text("Start together at the park","מתחילים יחד בפארק"),body:text("Land-based initiation at a suitable approved park: meet the group, organize personal tackle, practise foundational knots and safe equipment handling. These are two separate preparation meetings. "+academyTripCopy.firstMeeting.en,"פתיחה יבשתית בפארק מתאים ומאושר: היכרות עם הקבוצה, סידור ציוד אישי ותרגול קשרים בסיסיים ושימוש בטוח בציוד. אלו שני מפגשי הכנה נפרדים. "+academyTripCopy.firstMeeting.he)},
 {label:text("Meeting 3 · 3 hours","מפגש 3 · שלוש שעות"),title:text("Bass Pro Shops, Dania Beach","Bass Pro Shops, דניה ביץ׳"),body:text("A planned store learning visit, subject to confirmed access and arrangements. Connect equipment choices to what we will practise. The visit and practical arrangements are confirmed with families in advance.","ביקור לימודי מתוכנן בחנות, בכפוף לאישור גישה וסידורים. מחברים בין בחירת הציוד לבין התרגול. הביקור והסידורים המעשיים מאושרים עם המשפחות מראש.")},
 {label:text("Meeting 4 · 3 hours","מפגש 4 · שלוש שעות"),title:text("First supervised pier session","מפגש הדיג המפוקח הראשון במזח"),body:text("Deerfield is a candidate, subject to group-use permission, safety, capacity and current conditions. Pier fishing begins at the appropriate supervised part of the curriculum, not at initiation.","דירפילד הוא מיקום אפשרי, בכפוף לאישור שימוש קבוצתי, בטיחות, קיבולת ותנאים עדכניים. דיג במזח מתחיל בשלב המתאים והמפוקח של הלמידה, לא במפגשי הפתיחה.")},
 {label:text("Meetings 5–12","מפגשים 5–12"),title:text("Practise, reflect and build independence","מתרגלים, חושבים ומפתחים עצמאות"),body:text("Develop the group’s fishing and self-governance skills at suitable freshwater and saltwater locations. A safely confirmed pooled monthly Keys session replaces the participating group’s weekly meeting after the initial readiness ramp; it is not an extra tuition class or a guaranteed date.","מפתחים מיומנויות דיג והנהגה עצמית במקומות מתאימים במים מתוקים ומלוחים. לאחר תקופת ההכנה הראשונית, מפגש חודשי משותף בקיז שאושר כבטוח מחליף את המפגש השבועי של הקבוצה המשתתפת; אין זו תוספת שכר לימוד או הבטחה לתאריך.")},
] as const;

/** Current public syllabus grouped without an invented dated itinerary.
 * Website21 paragraphs69996/77368 retain the public topics in core nodes32-45. */
export const academyStageProgression:Readonly<Record<string,readonly {title:AcademyText;body:AcademyText}[]>>={
 independent:[
  {title:text("Connections and casting","חיבורים והטלה"),body:text("Practise braid-to-leader connections, including Double Uni and Albright, and improve casting placement.","מתרגלים חיבורי חוט קלוע לחוט מוביל, ובהם Double Uni ו־Albright, ומשפרים את דיוק ההטלה.")},
  {title:text("Presentation and conditions","הצגת הפיתיון והתנאים"),body:text("Compare bait, sinker and retrieve choices, free-lining and bottom rigs. Investigate line twist, excess slack and tackle problems.","משווים בחירות של פיתיון, משקולת ואופן החזרת הפיתיון, דיג בחוט חופשי וריגי קרקעית. בוחנים פיתול בחוט, חוט רפוי מדי ותקלות בציוד.")},
  {title:text("Communication and shared decisions","תקשורת והחלטות משותפות"),body:text("Compare explanations, make a specific request for help and work through disagreements while keeping the shared task moving.","משווים הסברים, מבקשים עזרה באופן ממוקד ומתמודדים עם חילוקי דעות תוך קידום המשימה המשותפת.")},
 ],
 advanced:[
  {title:text("Evidence and equipment","תצפיות וציוד"),body:text("Investigate how the rod and line respond, why a connection failed and when to change a plan. Distinguish observations from assumptions.","בוחנים כיצד החכה והחוט מגיבים, מדוע חיבור נכשל ומתי לשנות תוכנית. מבחינים בין תצפיות לבין הנחות.")},
  {title:text("Controlled cast-net practice","תרגול מבוקר ברשת הטלה"),body:text("Begin with cast-net anatomy, line management and controlled dry practice. Actual water use requires a separate instructor check of the learner, equipment and location.","מתחילים בהכרת מבנה רשת ההטלה, בניהול החבלים ובתרגול יבש ומבוקר. שימוש ממשי במים דורש בדיקה נפרדת של הלומד, הציוד והמקום בידי המדריך.")},
  {title:text("Responsible fish-to-table learning","למידה אחראית מדג לשולחן"),body:text("Learn identification, lawful source and cold storage, with an adult-led preparation demonstration in an appropriate setting.","לומדים זיהוי, מקור חוקי ושמירה בקירור, לצד הדגמת הכנה בהובלת מבוגר בסביבה מתאימה.")},
 ],
 leadership:[
  {title:text("Explain and demonstrate","מסבירים ומדגימים"),body:text("Explain a setup, help organize equipment, teach a knot, support accuracy practice and present a reasoned conditions plan.","מסבירים כיצד להכין את המערך, עוזרים לארגן ציוד, מלמדים קשר, מסייעים בתרגול דיוק ומציגים תוכנית מנומקת בהתאם לתנאים.")},
  {title:text("Help others learn","עוזרים לאחרים ללמוד"),body:text("Listen, offer a manageable next step and give the learner room to try. Know when to involve an adult; a learning role never makes a student responsible for supervising other children.","מקשיבים, מציעים צעד הבא שאפשר להתמודד איתו ונותנים ללומד מקום לנסות. יודעים מתי לערב מבוגר; תפקיד לימודי אינו הופך תלמיד לאחראי להשגחה על ילדים אחרים.")},
  {title:text("Review demonstrated progress","סקירת התקדמות שהודגמה"),body:text("Review demonstrated fishing skills, critical thinking, communication, collaboration and responsibility with the instructor, then choose a next practical goal. Progress is not based on the size of a fish caught.","סוקרים עם המדריך מיומנויות דיג, חשיבה ביקורתית, תקשורת, שיתוף פעולה ואחריות שהודגמו, ובוחרים יעד מעשי להמשך. ההתקדמות אינה מבוססת על גודל הדג שנתפס.")},
 ],
};

export const academyFishingSkills=[
 {title:text("Know your tackle","מכירים את הציוד"),body:text("Each boy maintains his own tackle box and fishing equipment. Learn to select, organise, inspect and care for what you use.","כל בן מתחזק את ארגז הדיג והציוד האישי שלו. לומדים לבחור, לארגן, לבדוק ולשמור על הציוד שבו משתמשים.")},
 {title:text("Rig, cast and adapt","מרכיבים, מטילים ומתאימים"),body:text("Practise knots, rigs, controlled casting, bait and lure selection. Explain what you chose, observe what happened and decide what to try next.","מתרגלים קשרים, ריגים, הטלה מבוקרת ובחירת פיתיונות ודמויים. מסבירים את הבחירה, מתבוננים במה שקרה ומחליטים מה לנסות בהמשך.")},
 {title:text("Read the water","קוראים את המים"),body:text("Connect habitat, tides, weather and season to the way we fish. Learn regulations and careful fish handling alongside practical technique.","מחברים בין בית הגידול, הגאות והשפל, מזג האוויר והעונה לשיטת הדיג. לומדים כללים וטיפול זהיר בדגים לצד המיומנות המעשית.")},
] as const;
export const academySelfGovernance=bilingual.gains;
export const academyQuestions=bilingual.questions.map((q,index)=>index===7?{...q,answer:academyTripCopy.keysDetails}:index===8?{...q,answer:academyTripCopy.offshoreSummary}:index===10?{question:text("How does registration and payment work?","כיצד פועלים ההרשמה והתשלום?"),answer:text("Submitting the form creates no tuition obligation, class seat or start date. Confirm your interest by email. A suitable group and a separately approved offer come before payment. Existing founding-family entitlements remain attached to the family. Each four-lesson monthly block is purchased separately; there is no automatic future charge.","שליחת הטופס אינה יוצרת התחייבות לשכר לימוד, מקום בכיתה או מועד פתיחה. מאשרים התעניינות בדוא״ל. קבוצה מתאימה והצעה מאושרת נפרדת קודמות לתשלום. זכאות קיימת של משפחות מייסדות נשארת משויכת למשפחה. כל מקבץ חודשי בן ארבעה שיעורים נרכש בנפרד; אין חיוב עתידי אוטומטי.")}:q);
