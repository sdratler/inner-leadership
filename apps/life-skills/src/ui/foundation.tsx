import type { Locale } from "../lib/locale.ts";
import { otherLocale } from "../lib/locale.ts";
import { copy } from "./copy.ts";
import { EmptyState, Notice, Surface } from "./primitives.tsx";
export type PreviewRole = "parent" | "practitioner";
export function FoundationPreview({ locale, view }: { locale: Locale; view: PreviewRole }) {
  const t = copy(locale), practitioner = view === "practitioner";
  return <div className={`app-shell ${practitioner ? "app-shell--practitioner" : ""}`}>
    <a className="skip-link" href="#main">{t.skip}</a>
    <header className="app-header"><div className="brand"><span aria-hidden="true" className="brand-mark">L</span><div><b dir="ltr">{t.brand}</b><span>{practitioner ? t.practitioner : t.space}</span></div></div>
      <a className="language-link" href={`/${otherLocale(locale)}/foundation?view=${view}`} lang={otherLocale(locale)} hrefLang={otherLocale(locale)}>{t.language}</a></header>
    {practitioner && <aside className="sidebar"><p className="eyebrow">{t.structure}</p><nav aria-label={t.navigation}><a href={`/${locale}/foundation?view=practitioner`} aria-current="page">{t.foundation}</a></nav><p className="sidebar-note">{t.safeLabel}</p></aside>}
    <main id="main" className="main-content" tabIndex={-1}>
      <div className="page-heading"><p className="eyebrow">{t.preview}</p><h1>{practitioner ? t.practitionerTitle : t.intro}</h1><p className="lead">{practitioner ? t.practitionerDescription : t.description}</p></div>
      <div className="workspace-context"><span aria-hidden="true" className="status-dot"/><span>{t.context}</span></div>
      <Surface labelledBy="empty-title"><EmptyState title={practitioner ? t.practitionerEmpty : t.emptyTitle}>{practitioner ? t.practitionerEmptyBody : t.emptyBody}</EmptyState></Surface>
      <Notice title={t.privacyTitle}>{t.privacyBody}</Notice>
      <p className="boundary">{t.boundary}</p>
      <nav className="preview-switch" aria-label={t.navigation}><a href={`/${locale}/foundation?view=parent`} aria-current={!practitioner ? "page" : undefined}>{t.viewParent}</a><a href={`/${locale}/foundation?view=practitioner`} aria-current={practitioner ? "page" : undefined}>{t.viewPractitioner}</a></nav>
      <footer>{t.footer}</footer>
    </main>
  </div>;
}
