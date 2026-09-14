import type { ReactNode } from "react";
import type { Locale } from "../../lib/locale.ts";

type Role = "parent" | "practitioner";
const copy = {
  en: { brand: "Life Skills", practitioner: "Practitioner workspace", parent: "Family workspace", skip: "Skip to content", nav: "Application navigation", language: "עברית", unavailable: "This private workspace is unavailable. Sign in with an authorized account and try again.", retry: "Try again" },
  he: { brand: "Life Skills", practitioner: "מרחב המטפל", parent: "מרחב המשפחה", skip: "דילוג לתוכן", nav: "ניווט באפליקציה", language: "English", unavailable: "המרחב הפרטי אינו זמין. יש להתחבר באמצעות חשבון מורשה ולנסות שוב.", retry: "ניסיון נוסף" },
} as const;

const items = {
  practitioner: [
    ["app/calendar", "יומן", "Calendar"], ["home-practice", "תרגול ביתי", "Home practice"],
    ["updates", "עדכוני הורים", "Parent updates"], ["progress", "סקירות", "Reviews"],
    ["forms", "טפסים", "Forms"], ["payments", "תשלומים", "Payments"],
  ],
  parent: [
    ["family", "בית", "Home"], ["home-practice", "תרגול", "Practice"],
    ["updates", "עדכונים", "Updates"], ["family/schedule", "לוח זמנים", "Schedule"],
    ["resources", "משאבים", "Resources"], ["forms", "טפסים", "Forms"],
  ],
} as const;

export function CoreNavigation({ locale, role, children }: { locale: Locale; role: Role; children: ReactNode }) {
  const t = copy[locale], links = items[role];
  return <div className={`lsw lsw-shell lsw-shell--${role}`} lang={locale} dir={locale === "he" ? "rtl" : "ltr"}>
    <a className="lsw-skip" href="#lsw-main">{t.skip}</a>
    <header className="lsw-topbar"><div className="lsw-brand"><span aria-hidden="true" className="lsw-brand-mark">L</span><div><b translate="no" dir="ltr">{t.brand}</b><span>{role === "parent" ? t.parent : t.practitioner}</span></div></div><div className="lsw-header-actions"><a href={`/${locale === "he" ? "en" : "he"}/${role === "parent" ? "family" : "app"}`} lang={locale === "he" ? "en" : "he"}>{t.language}</a></div></header>
    {role === "practitioner" ? <aside className="lsw-sidebar"><p className="lsw-eyebrow">{t.practitioner}</p><nav aria-label={t.nav}>{links.map(([path, he, en]) => <a key={path} href={`/${locale}/${path}`}>{locale === "he" ? he : en}</a>)}</nav></aside> : <nav className="lsw-parent-nav" aria-label={t.nav}>{links.slice(0, 4).map(([path, he, en]) => <a key={path} href={`/${locale}/${path}`}>{locale === "he" ? he : en}</a>)}</nav>}
    <div className="lsw-workarea"><div id="lsw-main" tabIndex={-1} className="lsw-main">{children}</div></div>
    <nav className="lsw-mobile-nav" aria-label={t.nav}>{links.slice(0, 4).map(([path, he, en]) => <a key={path} href={`/${locale}/${path}`}>{locale === "he" ? he : en}</a>)}</nav>
  </div>;
}

export function PrivateWorkspaceUnavailable({ locale, role }: { locale: Locale; role: Role }) {
  const t = copy[locale];
  return <div className="lsw" lang={locale} dir={locale === "he" ? "rtl" : "ltr"}><main className="lsw-main"><section className="lsw-card" role="status"><h1>{role === "parent" ? t.parent : t.practitioner}</h1><p>{t.unavailable}</p><a className="lsw-button lsw-button--secondary" href={`/${locale}/${role === "parent" ? "family" : "app"}`}>{t.retry}</a></section></main></div>;
}
