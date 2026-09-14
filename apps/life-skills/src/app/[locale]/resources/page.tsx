import { notFound } from "next/navigation";
import { isLocale } from "../../../lib/locale.ts";

const copy = {
  en: { eyebrow: "Private workspace", title: "Forms and resources", lead: "Worksheets, audio, video, links, text, and digital forms stay in one deliberately shared resource library.", empty: "Choose an authorized case to view resources published for that exact audience. A title-only audience never receives the protected description or reference.", boundary: "Opening or completing a resource is a practical activity record, not a grade or clinical conclusion." },
  he: { eyebrow: "מרחב פרטי", title: "טפסים ומשאבים", lead: "דפי עבודה, שמע, וידאו, קישורים, טקסט וטפסים דיגיטליים נשמרים בספריית משאבים אחת ומשותפים במכוון.", empty: "יש לבחור תיק מורשה כדי לראות משאבים שפורסמו בדיוק לקהל שלו. קהל של כותרת והשלמה בלבד אינו מקבל את התיאור או ההפניה המוגנים.", boundary: "פתיחה או השלמה של משאב היא תיעוד פעילות מעשי, לא ציון או מסקנה קלינית." },
} as const;

export default async function ResourcesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const text = copy[locale];
  return <main id="main-content" className="main-content">
    <header className="page-heading"><p className="eyebrow">{text.eyebrow}</p><h1>{text.title}</h1><p className="lead">{text.lead}</p></header>
    <section className="surface empty-state" aria-live="polite"><span className="empty-mark" aria-hidden="true">◇</span><h2>{text.title}</h2><p>{text.empty}</p></section>
    <p className="boundary">{text.boundary}</p>
  </main>;
}
