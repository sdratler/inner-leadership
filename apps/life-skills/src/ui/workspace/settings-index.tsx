"use client";
import { useSearchParams } from "next/navigation";
import type { Locale } from "../../lib/locale.ts";
import { settingsItems, workspaceHref, type WorkspaceRole } from "./navigation-model.ts";
const descriptions = {
 en: { account: "Your account’s language preference.", notifications: "Choose channels, event types and quiet hours. Visibility stays unchanged.", coordination: "See who handles a shared practice task.", credits: "View appointment credit information and its recorded state.", availability: "Manage open and blocked times away from your daily calendar.", content_voice: "Read the current canonical writing guide and source revision." },
 he: { account: "העדפת השפה של החשבון שלכם.", notifications: "ערוצים, סוגי התראות ושעות שקטות. הרשאות הצפייה אינן משתנות.", coordination: "מי אחראי לתרגול המשפחתי המשותף.", credits: "מידע על יתרת המפגשים והמצב הרשום שלה.", availability: "ניהול זמני זמינות וחסימות, בנפרד מהיומן היומי.", content_voice: "צפייה במדריך הכתיבה הרשמי ובגרסת המקור הנוכחית." },
} as const;
export function SettingsIndex({ locale, role }: { locale: Locale; role: WorkspaceRole }) {
 const caseId = useSearchParams().get("caseId");
 return <main className="lsu-settings-content"><header className="lsw-page-header"><div><p className="lsw-eyebrow">{locale === "he" ? "החשבון שלכם" : "Your workspace"}</p><h1>{locale === "he" ? "הגדרות" : "Settings"}</h1><p>{locale === "he" ? "בחרו נושא. כל הגדרה נפתחת בעמוד משלה." : "Choose a category. Each opens on its own page."}</p></div></header><div className="lsu-settings-grid">{settingsItems(role).map(entry => <a className="lsu-settings-card" key={entry.key} href={workspaceHref(locale,entry.path,caseId)}><strong>{entry[locale]}</strong><p>{descriptions[locale][entry.key as keyof typeof descriptions.en]}</p><span>{locale === "he" ? "פתיחה" : "Open settings"} <span aria-hidden="true">{locale === "he" ? "←" : "→"}</span></span></a>)}</div></main>;
}
