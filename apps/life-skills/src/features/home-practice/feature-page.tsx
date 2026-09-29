import { Breadcrumb } from "../../ui/workspace/surfaces.tsx";
import { PracticeList } from "./practice-list.tsx";
import { PracticeOccurrenceWorkspace } from "./occurrence-workspace.tsx";

const content = {
  en: {
    "home-practice": ["Home practice", "Published instructions stay tied to the version you received. Morning and evening are separate check-ins."],
    goals: ["Goals", "Goals connect the work to a clear, shared purpose."],
    commitments: ["Commitments", "Commitments turn a goal into a practical next step."],
    checkins: ["Check-ins", "Report your own assigned morning or evening practice. Corrections preserve the recorded history."],
  },
  he: {
    "home-practice": ["תרגול בבית", "ההנחיות שפורסמו נשארות מקושרות לגרסה שקיבלתם. בוקר וערב הם דיווחים נפרדים."],
    goals: ["מטרות", "המטרות מחברות את העבודה לכיוון משותף וברור."],
    commitments: ["מחויבויות", "מחויבות הופכת מטרה לצעד מעשי הבא."],
    checkins: ["דיווחים", "דיווח על תרגול הבוקר או הערב שהוקצה לך. תיקונים שומרים את היסטוריית הדיווחים."],
  },
} as const;

export function Ls040FeaturePage({ locale, kind, caseId, audienceId, assignmentId, role = "parent" }: {
  locale: "en" | "he";
  kind: "home-practice" | "goals" | "commitments" | "checkins";
  caseId?: string | undefined;
  audienceId?: string | undefined;
  assignmentId?: string | undefined;
  role?: "parent" | "adult_client" | "child" | "practitioner";
}) {
  const [title, description] = content[locale][kind];
  const base = `/${locale}/${role === "parent" ? "family" : role === "practitioner" ? "app" : "client"}`;
  const practiceQuery = new URLSearchParams({ ...(caseId ? {caseId} : {}), ...(audienceId ? {audienceId} : {}) });
  return <main className="lsw-stack lsw-feature-page" aria-labelledby="ls-practice-page-title">
    <Breadcrumb label={locale === "he" ? "מיקום" : "Location"} items={[
      { label: locale === "he" ? "תרגול" : "Practice", href: base + "/practice" + (practiceQuery.size ? "?" + practiceQuery : "") },
      { label: assignmentId ? (locale === "he" ? "הנחיה נוכחית" : "Current instruction") : title },
    ]} />
    <header className="lsw-page-header"><div>
      <p className="lsw-eyebrow">{locale === "he" ? "תרגול משותף" : "Shared practice"}</p>
      <h1 id="ls-practice-page-title">{title}</h1><p>{description}</p>
    </div></header>
    <section className="lsw-card" aria-labelledby="current-items">
      <h2 id="current-items">{locale === "he" ? "פריטים נוכחיים" : "Current items"}</h2>
      {kind === "checkins"
        ? <><p><a className="lsw-button lsw-button--secondary" href={base + "/practice" + (practiceQuery.size ? "?" + practiceQuery : "")}>{locale === "he" ? "חזרה להנחיות" : "Back to instructions"}</a></p><PracticeOccurrenceWorkspace locale={locale} role={role} caseId={caseId} audienceId={audienceId} /></>
        : <PracticeList locale={locale} kind={kind} caseId={caseId} audienceId={audienceId} selectedAssignmentId={assignmentId} role={role} />}
    </section>
    <aside className="lsw-attention" aria-label={locale === "he" ? "פרטיות" : "Privacy"}><div>
      <h2>{locale === "he" ? "מידע פרטי" : "Private information"}</h2>
      <p>{locale === "he" ? "רק משתתפים מורשים ואיש המקצוע יכולים לצפות במידע שפורסם לקהל הזה." : "Only authorized participants and the practitioner can view information published to this audience."}</p>
    </div></aside>
  </main>;
}
