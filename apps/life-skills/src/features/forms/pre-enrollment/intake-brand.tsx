"use client";

import { createContext, useContext, useRef, useState } from "react";
import styles from "./intake-brand.module.css";

// Chrome and unmodified approved artwork from the live Life Skills website.
// Public links carry no family information; new tabs preserve unfinished answers.
const homeBase = "https://bneineviimacademy.org/life-skills/";
const whatsapp = "https://wa.me/972534932631";
const external = { target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" } as const;
const navigation = [["#teaching-he", "#teaching-en", "מה לומדים", "What we teach"], ["#founder-he", "#founder-en", "על שלמה", "About Shlomo"], ["#faq-he", "#faq-en", "שאלות נפוצות", "FAQ"]] as const;
type IntakeLocale = "he" | "en";
const LocaleContext = createContext<{ locale: IntakeLocale; setLocale: (locale: IntakeLocale) => void; locked: boolean; setLocked: (locked: boolean) => void }>({ locale: "he", setLocale: () => undefined, locked: false, setLocked: () => undefined });
export function useIntakeLocale() { return useContext(LocaleContext); }
const whatsappPath = "M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232";
function WhatsAppIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d={whatsappPath} /></svg>; }
function BrandLockup({ compact = false, locale = "he" }: { compact?: boolean; locale?: IntakeLocale }) {
  return <span className={`${styles.lockup} ${compact ? styles.compact : ""}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- approved local artwork, unchanged */}
    <img className={styles.hebrewLogo} alt={locale === "he" ? "כישורי חיים — לחיים שלמים" : "Life Skills — for fuller lives"} src="/intake-brand/life-skills-logo.png" />
    <span className={styles.words} lang="en" dir="ltr"><strong>Life Skills</strong></span>
  </span>;
}
export function IntakeBrand({ children, locale = "he" }: { children: React.ReactNode; locale?: IntakeLocale }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeLocale, setActiveLocale] = useState<IntakeLocale>(locale);
  const [locked, setLocked] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const englishMode = activeLocale === "en";
  const he = !englishMode;
  const home = `${homeBase}?lang=${activeLocale}`;
  const label = (heText: string, enText: string) => he ? heText : enText;
  const switchLocale = (next: IntakeLocale) => { if (!locked) setActiveLocale(next); };
  return <LocaleContext.Provider value={{ locale: activeLocale, setLocale: switchLocale, locked, setLocked }}><div className={styles.page} dir={englishMode ? "ltr" : "rtl"} lang={activeLocale}>
    <a className={styles.skipLink} href="#intake-main">{englishMode ? "Skip to content" : "דילוג לתוכן"}</a>
    <header className={styles.header} onKeyDown={event => { if (event.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); } }}>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <a className={styles.brand} href={home} aria-label={label("כישורי חיים — חזרה לאתר", "Life Skills — return to website")} {...external}><BrandLockup compact locale={activeLocale} /></a>
        <button className={styles.mobileLanguage} disabled={locked} type="button" lang={englishMode ? "he" : "en"} aria-label={englishMode ? "עברית" : "View this form in English"} onClick={() => switchLocale(englishMode ? "he" : "en")}>{englishMode ? "HE" : "EN"}</button>
        <nav className={styles.desktopNav} aria-label={label("ניווט ראשי", "Main navigation")}>{navigation.map(([heHash, enHash, heLabel, enLabel]) => <a key={heHash} href={home + (he ? heHash : enHash)} {...external}>{label(heLabel, enLabel)}</a>)}</nav>
        <div className={styles.headerActions}>
          <div className={styles.languageSwitch} role="group" aria-label="שפה / Language"><button disabled={locked} type="button" lang="he" aria-pressed={!englishMode} onClick={() => switchLocale("he")}>HE</button><span aria-hidden="true">/</span><button disabled={locked} type="button" lang="en" dir="ltr" aria-pressed={englishMode} onClick={() => switchLocale("en")}>EN</button></div>
          <a className={`${styles.button} ${styles.headerButton}`} href={whatsapp} {...external}>{label("WhatsApp", "WhatsApp")}</a>
        </div>
        <button ref={menuButton} type="button" className={styles.menuButton} aria-expanded={menuOpen} aria-controls="intake-mobile-menu" aria-label={menuOpen ? label("סגירת תפריט", "Close menu") : label("פתיחת תפריט", "Open menu")} onClick={() => setMenuOpen(value => !value)}><span /><span /><span /></button>
      </div>
      <div id="intake-mobile-menu" className={styles.mobileMenu} hidden={!menuOpen}><nav className={styles.container} aria-label={label("ניווט ראשי בנייד", "Mobile main navigation")}>
        {navigation.map(([heHash, enHash, heLabel, enLabel]) => <a key={heHash} href={home + (he ? heHash : enHash)} {...external} onClick={() => setMenuOpen(false)}>{label(heLabel, enLabel)}</a>)}
        <div className={styles.mobileLanguages} role="group" aria-label="שפה / Language"><button disabled={locked} type="button" lang="he" aria-pressed={he} onClick={() => switchLocale("he")}>עברית</button><button disabled={locked} type="button" lang="en" dir="ltr" aria-pressed={englishMode} onClick={() => switchLocale("en")}>English</button></div>
        <a className={`${styles.button} ${styles.lightButton}`} href={whatsapp} {...external}>{label("שלחו הודעה בוואטסאפ", "Message us on WhatsApp")}</a>
      </nav></div>
    </header>
    <main id="intake-main" className={styles.main}><a className={styles.backLink} href={home} {...external}>{label("חזרה לאתר כישורי חיים ↗", "Back to Life Skills website ↗")}</a>{children}</main>
    <footer className={styles.footer}><div className={`${styles.container} ${styles.footerInner}`}>
      <BrandLockup locale={activeLocale} />
      <div className={styles.footerContact} aria-label={label("יצירת קשר", "Contact")}><a className={styles.footerWhatsapp} href={whatsapp} aria-label={label("יצירת קשר בוואטסאפ", "Contact us on WhatsApp")} {...external}><WhatsAppIcon /></a><a className={styles.footerPhone} href="tel:+972534932631"><bdi dir="ltr">053-493-2631</bdi></a></div>
      <p className={styles.relationship}>{label("כישורי חיים הוא מיזם של Bnei Neviim Academy, ארגון ללא כוונת רווח בניו ג׳רזי, הפועל לקידום ההתפתחות הרגשית והחינוכית של ילדים יהודים, עצמאותם וצמיחה מתוך הכוונה עצמית.", "Life Skills is a Bnei Neviim Academy initiative, a New Jersey nonprofit supporting Jewish children’s emotional and educational development, independence, and self-directed growth.")}</p>
      <a className={styles.bnaLink} href="https://bneineviimacademy.org/" aria-label="Bnei Neviim Academy" {...external}>
        {/* eslint-disable-next-line @next/next/no-img-element -- same logo as the source website */}
        <img alt="" width="120" height="32" loading="lazy" src="/intake-brand/bna-logo.png" />
      </a>
      <nav aria-label={label("מידע נוסף", "Additional information")}><a href={home + `#terms-${activeLocale}`} {...external}>{label("תנאי השירות", "Terms of service")}</a><span aria-hidden="true">·</span><a href={home + `#terms-${activeLocale}`} {...external}>{label("פרטיות", "Privacy")}</a></nav>
    </div></footer>
    <a className={styles.floatingWhatsapp} href={whatsapp} aria-label={label("יצירת קשר ב־WhatsApp", "Contact us on WhatsApp")} title={label("יצירת קשר ב־WhatsApp", "Contact us on WhatsApp")} {...external}><WhatsAppIcon /></a>
  </div></LocaleContext.Provider>;
}
