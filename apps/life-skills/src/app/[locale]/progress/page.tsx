import { notFound } from "next/navigation";
import { isLocale } from "../../../lib/locale.ts";

const copy = {
  en: { eyebrow: "Qualitative history", title: "Four-week review", lead: "The practitioner reviews concrete examples, continuing difficulty, uncertainty, and the next useful adjustment.", empty: "Choose an authorized case to view published four-calendar-week narratives. Each review preserves its attributed parent reports, practice versions, and the real count of attended child sessions supplied by the calendar.", boundary: "This history has no rating scale, rank, composite score, invented improvement, or automatic clinical conclusion." },
  he: { eyebrow: "היסטוריה איכותנית", title: "סקירה של ארבעה שבועות", lead: "המטפל בוחן דוגמאות ממשיות, קושי מתמשך, אי־ודאות ואת ההתאמה המועילה הבאה.", empty: "יש לבחור תיק מורשה כדי לראות סקירות שפורסמו לתקופות של ארבעה שבועות קלנדריים. כל סקירה שומרת את דיווחי ההורים המיוחסים, גרסאות התרגול ואת המספר האמיתי של מפגשי הילד שבהם השתתף, כפי שסופק מן היומן.", boundary: "בהיסטוריה הזאת אין סולם דירוג, דרגה, ציון משוקלל, שיפור מומצא או מסקנה קלינית אוטומטית." },
} as const;

export default async function ProgressPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const text = copy[locale];
  return <main id="main-content" className="main-content">
    <header className="page-heading"><p className="eyebrow">{text.eyebrow}</p><h1>{text.title}</h1><p className="lead">{text.lead}</p></header>
    <section className="surface empty-state" aria-live="polite"><span className="empty-mark" aria-hidden="true">◇</span><h2>{text.title}</h2><p>{text.empty}</p></section>
    <p className="boundary">{text.boundary}</p>
  </main>;
}
