import { PracticeList } from "./practice-list.tsx";

const content = {
  en: {
    "home-practice": ["Home practice", "Published instructions stay tied to the version you received. Morning and evening are separate check-ins."],
    goals: ["Goals", "Goals connect the work to a clear, shared purpose."],
    commitments: ["Commitments", "Commitments turn a goal into a practical next step."],
    checkins: ["Check-ins", "A parent can report done, partly done, not done, rescheduled, or not applicable. Corrections keep their history."],
  },
  he: {
    "home-practice": ["תרגול בבית", "ההנחיות שפורסמו נשארות מקושרות לגרסה שקיבלתם. בוקר וערב הם דיווחים נפרדים."],
    goals: ["מטרות", "המטרות מחברות את העבודה לכיוון משותף וברור."],
    commitments: ["מחויבויות", "מחויבות הופכת מטרה לצעד מעשי הבא."],
    checkins: ["דיווחים", "הורה יכול לדווח: בוצע, בוצע חלקית, לא בוצע, נדחה או לא רלוונטי. תיקונים שומרים את ההיסטוריה."],
  },
} as const;

export function Ls040FeaturePage({ locale, kind, caseId, audienceId }: { locale: "en" | "he"; kind: "home-practice" | "goals" | "commitments" | "checkins"; caseId?: string | undefined; audienceId?: string | undefined }) {
  const [title, description] = content[locale][kind];
  const otherLocale = locale === "he" ? "en" : "he";
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{locale === "he" ? "דלגו לתוכן" : "Skip to content"}</a>
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true">L</span><span><b>Life Skills</b><span>{locale === "he" ? "אזור משפחתי פרטי" : "Private family space"}</span></span></div>
      <a className="language-link" href={`/${otherLocale}/${kind}`}>{locale === "he" ? "English" : "עברית"}</a>
    </header>
    <main id="main-content" className="main-content">
      <header className="page-heading"><p className="eyebrow">{locale === "he" ? "תרגול משפחתי" : "Family practice"}</p><h1>{title}</h1><p className="lead">{description}</p></header>
      <section className="surface empty-state" aria-labelledby="current-items">
        <span className="empty-mark" aria-hidden="true">◇</span><h2 id="current-items">{locale === "he" ? "פריטים נוכחיים" : "Current items"}</h2>
        {kind === "checkins" ? <p>{locale === "he" ? "בחרו תרגול מהמסך הראשי כדי לצפות בהיסטוריית הדיווחים." : "Choose a practice item from Home to view its check-in history."}</p>
          : <PracticeList locale={locale} kind={kind} caseId={caseId} audienceId={audienceId} />}
      </section>
      <aside className="notice" aria-label={locale === "he" ? "פרטיות" : "Privacy"}><span className="notice-symbol" aria-hidden="true">○</span><div>
        <h2>{locale === "he" ? "מידע פרטי" : "Private information"}</h2><p>{locale === "he" ? "רק הורים מורשים ואיש המקצוע יכולים לצפות במידע שפורסם לקהל הזה." : "Only authorized parents and the practitioner can view information published to this audience."}</p>
      </div></aside>
      <footer>{locale === "he" ? "ללא ציונים, דירוגים או ענישה אוטומטית." : "No scores, rankings or automatic penalties."}</footer>
    </main>
  </div>;
}
