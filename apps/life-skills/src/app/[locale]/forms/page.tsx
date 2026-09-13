import { notFound } from "next/navigation";
import { isLocale } from "../../../lib/locale.ts";

const copy = {
  en: { eyebrow: "Private workspace", title: "Forms", lead: "Assigned forms use a versioned definition and protect every submitted answer.", empty: "Choose an authorized case to view current forms. Completed forms leave the action list; protected answers remain available only to the practitioner unless deliberately published.", boundary: "No score, developmental rating, or child account is created by a form." },
  he: { eyebrow: "מרחב פרטי", title: "טפסים", lead: "טפסים שהוקצו נשענים על הגדרה מתועדת ומגנים על כל תשובה שנשלחה.", empty: "יש לבחור תיק מורשה כדי לראות את הטפסים הנוכחיים. טפסים שהושלמו יורדים מרשימת הפעולות; התשובות המוגנות זמינות רק למטפל, אלא אם פורסמו במפורש.", boundary: "טופס אינו יוצר ציון, דירוג התפתחותי או חשבון לילד." },
} as const;

export default async function FormsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const text = copy[locale];
  return <main id="main-content" className="main-content">
    <header className="page-heading"><p className="eyebrow">{text.eyebrow}</p><h1>{text.title}</h1><p className="lead">{text.lead}</p></header>
    <section className="surface empty-state" aria-live="polite"><span className="empty-mark" aria-hidden="true">◇</span><h2>{text.title}</h2><p>{text.empty}</p></section>
    <p className="boundary">{text.boundary}</p>
  </main>;
}
