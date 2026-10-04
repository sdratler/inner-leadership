import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { requireWorkspaceRole } from "@/features/integration/page-session.ts";
import { CommunitySettingsPanel } from "@/features/community-reply/settings-panel.tsx";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; if (!isLocale(locale)) notFound();
  await requireWorkspaceRole("practitioner");
  return <main className="lsu-settings-content" lang={locale} dir={locale === "he" ? "rtl" : "ltr"}><header className="lsw-page-header"><div><p className="lsw-eyebrow">{locale === "he" ? "הגדרות" : "Settings"}</p><h1>{locale === "he" ? "Community Scout" : "Community Scout"}</h1><p>{locale === "he" ? "מקורות מותרים, בקשות להרצה ותקרות. ההגדרות החיות מוצגות בנפרד." : "Allowed sources, requested runs and ceilings. Actual runtime settings are shown separately."}</p></div></header><CommunitySettingsPanel locale={locale} /></main>;
}
