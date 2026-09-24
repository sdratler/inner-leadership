import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { requireWorkspaceRole } from "@/features/integration/page-session.ts";
import { readContentVoiceSource } from "@/features/content-voice/source.ts";
import styles from "./source-viewer.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  try { await requireWorkspaceRole("practitioner"); } catch { return <main><h1>{locale === "he" ? "הגישה אינה זמינה" : "Access unavailable"}</h1></main>; }
  let source: Awaited<ReturnType<typeof readContentVoiceSource>> | null = null;
  try { source = await readContentVoiceSource(); } catch { /* A failed or changing source is never represented as current. */ }
  const he = locale === "he";
  return <main className="lsw-stack" lang={locale} dir={he ? "rtl" : "ltr"}>
    <header className="lsw-page-header"><div><p className="lsw-eyebrow">{he ? "העדפות כתיבה" : "Writing preferences"}</p><h1>{he ? "קול התוכן" : "Content Voice"}</h1><p>{he ? "מקור הכתיבה הרשמי נקרא ישירות מ־Drive בכל פתיחה של העמוד." : "The canonical writing guide is read directly from Drive whenever this page opens."}</p></div></header>
    {!source ? <section className="lsw-card" role="alert"><h2>{he ? "המקור אינו זמין כרגע" : "Source unavailable right now"}</h2><p>{he ? "אין להניח שכללים שמורים או עדכניים. נסו שוב מאוחר יותר." : "Do not assume the writing rules are saved or current. Please retry later."}</p></section> : <>
      <section className="lsw-card lsw-stack" aria-labelledby="voice-source-title">
        <h2 id="voice-source-title"><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.title}</a></h2>
        <dl className={styles.metadata}>
          <div><dt>{he ? "גרסה מוצהרת" : "Declared version"}</dt><dd>{source.declaredVersion ?? (he ? "לא צוינה" : "Not stated")}</dd></div>
          <div><dt>{he ? "גרסת Drive" : "Drive revision"}</dt><dd>{source.driveRevision}</dd></div>
          <div><dt>{he ? "עדכון אחרון ב־Drive" : "Drive last modified"}</dt><dd><time dateTime={source.modifiedAt}>{source.modifiedAt}</time></dd></div>
          <div><dt>{he ? "בדיקה אחרונה מהמקור" : "Last checked from source"}</dt><dd><time dateTime={source.checkedAt}>{source.checkedAt}</time></dd></div>
          <div><dt>SHA-256</dt><dd className={styles.hash}>{source.sha256}</dd></div>
        </dl>
        <p role="status">{he ? "קריאה עדכנית אומתה; זה אינו אישור לשמירת שינוי או לשימוש במחולל תשובות. זמן העדכון של Drive עשוי להשתנות גם בעקבות שינוי הרשאות." : "Fresh source read verified; this does not confirm a correction was saved or used by a reply generator. Drive's modified time can also change after permission updates."}</p>
        <p>{he ? "עדכון כללי הכתיבה מתוך האפליקציה ממתין למנגנון שמירה בטוח מול עריכות מקבילות." : "Updating writing rules from this app is pending a safe writer for concurrent edits."}</p>
      </section>
      <section className="lsw-card lsw-stack" aria-labelledby="voice-text-title"><h2 id="voice-text-title">{he ? "תוכן המקור הנוכחי" : "Current source text"}</h2><pre className={styles.sourceText}>{source.text}</pre></section>
    </>}
  </main>;
}
