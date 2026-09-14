import type { Locale } from "../../lib/locale.ts";

const copy = {
  en: {
    practitioner: { eyebrow: "Private practice", title: "Today’s work", lead: "Move through the core loop without turning contextual information into grades.", cards: [["app/calendar", "Calendar and attendance", "Appointments, replacement requests, attendance and credit effects."], ["home-practice", "Published practice", "Prepare the next family practice version and keep publication deliberate."], ["updates", "Parent examples", "Review attributed reports, reply, and prepare an adapted draft."], ["progress", "Four-week review", "Write qualitative summaries from authorized evidence and actual attended sessions."]] },
    parent: { eyebrow: "Family workspace", title: "Practice between sessions", lead: "See only the information deliberately shared with your authorized family audience.", cards: [["home-practice", "Current practice", "Open the practitioner-published instructions and report completion."], ["updates", "Share an example", "Send a contextual example and read published practitioner replies."], ["family/schedule", "Schedule", "Review appointments and replacement-request status."], ["resources", "Resources", "Open worksheets and resources shared for your family."]] },
  },
  he: {
    practitioner: { eyebrow: "קליניקה פרטית", title: "העבודה להיום", lead: "עוברים במעגל העבודה המרכזי בלי להפוך מידע הקשרי לציונים.", cards: [["app/calendar", "יומן ונוכחות", "פגישות, בקשות למועד חלופי, נוכחות והשפעות על יתרת המפגשים."], ["home-practice", "תרגול מפורסם", "מכינים את גרסת התרגול הבאה למשפחה ושומרים על פרסום מכוון."], ["updates", "דוגמאות מן ההורים", "קוראים דיווחים מיוחסים, משיבים ומכינים טיוטת התאמה."], ["progress", "סקירה של ארבעה שבועות", "כותבים סיכום איכותני מראיות מורשות וממפגשים שבהם הילד השתתף בפועל."]] },
    parent: { eyebrow: "מרחב המשפחה", title: "תרגול בין המפגשים", lead: "רואים רק מידע ששותף במכוון עם הקהל המשפחתי המורשה שלכם.", cards: [["home-practice", "התרגול הנוכחי", "פותחים את ההנחיות שפרסם המטפל ומדווחים על ביצוע."], ["updates", "שיתוף דוגמה", "שולחים דוגמה הקשרית וקוראים תשובות שפרסם המטפל."], ["family/schedule", "לוח זמנים", "בודקים פגישות ואת מצב הבקשה למועד חלופי."], ["resources", "משאבים", "פותחים דפי עבודה ומשאבים ששותפו עם המשפחה."]] },
  },
} as const;

export function CoreDashboard({ locale, role }: { locale: Locale; role: "parent" | "practitioner" }) {
  const t = copy[locale][role];
  return <><header className="lsw-page-header"><div><p className="lsw-eyebrow">{t.eyebrow}</p><h1>{t.title}</h1><p>{t.lead}</p></div></header><section className="lsw-content-grid" aria-label={t.title}>{t.cards.map(([path, title, description]) => <article className="lsw-card" key={path}><h2>{title}</h2><p>{description}</p><a className="lsw-button lsw-button--secondary" href={`/${locale}/${path}`}>{title}</a></article>)}</section></>;
}
