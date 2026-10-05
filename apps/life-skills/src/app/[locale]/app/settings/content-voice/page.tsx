import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { requireWorkspaceRole } from "@/features/integration/page-session.ts";
import { readContentVoiceSource } from "@/features/content-voice/source.ts";
import {ContentVoiceView} from '@/features/content-voice/source-view.tsx';

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
    <ContentVoiceView locale={locale} source={source}/>
  </main>;
}
