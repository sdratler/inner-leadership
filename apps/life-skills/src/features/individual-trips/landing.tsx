'use client';

import { useState } from 'react';
import { TRIP_LANDING_COPY, TRIP_LOCKED_LOGO, tripLandingUrls, type ApprovedTripPhoto, type TripLandingLocale } from './metadata.ts';
import styles from './landing.module.css';

export type IndividualTripLandingProps = { locale: TripLandingLocale; publicUrl: string; photo: ApprovedTripPhoto };
const copy = {
  en: {
    academy: 'Jewish Leadership Fishing Academy', region: 'South Florida', eyebrow: 'With Rabbi Shlomo Dratler',
    title: 'Learn to fish. Grow in responsibility.',
    intro: 'Time on the water. Real skills. A chance for your son to think, try and take responsibility—with Torah at the heart of it.',
    choose: 'Choose possible trip dates', free: 'Free adult account. No payment to register your interest.',
    whatsapp: 'WhatsApp Rabbi Shlomo', draft: 'Hi Rabbi Shlomo, I’d like to hear about Fishing Academy trips and possible dates for my boys.',
    expectation: 'Tell us which dates could work. We’ll confirm the actual trip, pickup and details before you accept a place.',
    gainsTitle: 'More than a day of fishing.', gainsIntro: 'Practical skills and everyday character, learned together.',
    gains: [
      ['Fishing skills', 'Prepare a rod, tie a dependable knot and learn to cast with control.'],
      ['Independent thinking', 'Notice what happened, try a solution and explain the next step.'],
      ['Self-governance', 'Pause when things get frustrating and choose how to respond.'],
      ['Communication', 'Ask for help, listen to another idea and work through disagreement.'],
      ['Responsibility', 'Prepare your gear, care for shared spaces and follow through.'],
      ['Leadership', 'Help another boy learn without taking the task away from him.'],
    ],
    learningTitle: 'Skills to build on.', learningIntro: 'Fishing technique, care for living things and good judgment belong together.',
    skills: ['Rods and reels', 'Knots and rigs', 'Hooks and bait', 'Casting', 'Reading the water', 'Fish and equipment care'],
    plansTitle: 'Find the dates that work for your family.',
    plansBody: 'Explore possible Sunday local outings and Keys trips. You can ask for all the dates you select, or one of several alternatives. A request is an expression of interest, not a confirmed place.',
    seasonTitle: 'Thinking about Summer or Pesach?',
    seasonBody: 'Add free seasonal interest in the same account—even if you haven’t chosen a Sunday. You can include trips during Pesach and dates you’re not sure about yet.',
    seasonAction: 'Add Summer or Pesach interest',
    shareTitle: 'Know a family who would enjoy this?', share: 'Share on WhatsApp', copy: 'Copy link', copied: 'Link copied.', copyFallback: 'Select and copy the public link below.', link: 'Public page link',
    foot: 'Questions are welcome. Open a WhatsApp draft to Rabbi Shlomo:',
  },
  he: {
    academy: 'האקדמיה לדיג ולמנהיגות יהודית', region: 'דרום פלורידה', eyebrow: 'עם הרב שלמה דרטלר',
    title: 'לומדים לדוג. צומחים באחריות.',
    intro: 'זמן ליד המים, מיומנויות אמיתיות והזדמנות לבן שלכם לחשוב, להתנסות ולקחת אחריות — ברוח התורה.',
    choose: 'בחירת תאריכים אפשריים לטיול', free: 'חשבון חינם להורה. אין תשלום על הבעת התעניינות.',
    whatsapp: 'וואטסאפ לרב שלמה', draft: 'שלום הרב שלמה, אשמח לשמוע על טיולי האקדמיה לדיג והתאריכים האפשריים לבנים שלי.',
    expectation: 'ספרו לנו אילו תאריכים יכולים להתאים. לפני אישור מקום נסכם את הטיול, האיסוף וכל הפרטים.',
    gainsTitle: 'הרבה מעבר ליום של דיג.', gainsIntro: 'מיומנויות מעשיות ומידות טובות, שנלמדות יחד.',
    gains: [
      ['מיומנויות דיג', 'מכינים חכה, קושרים קשר אמין ולומדים להטיל בשליטה.'],
      ['חשיבה עצמאית', 'שמים לב למה שקרה, מנסים פתרון ומסבירים את הצעד הבא.'],
      ['הנהגה עצמית', 'עוצרים כשמשהו מתסכל ובוחרים איך להגיב.'],
      ['תקשורת', 'מבקשים עזרה, מקשיבים לרעיון אחר ומתמודדים עם מחלוקת.'],
      ['אחריות', 'מכינים ציוד, שומרים על המרחב המשותף ועומדים בהתחייבויות.'],
      ['מנהיגות', 'עוזרים לילד אחר ללמוד בלי לקחת ממנו את המשימה.'],
    ],
    learningTitle: 'מיומנויות שנבנות עם ההתנסות.', learningIntro: 'טכניקת דיג, שמירה על בעלי חיים ושיקול דעת הולכים יחד.',
    skills: ['חכות ורולרים', 'קשרים ומערכי דיג', 'קרסים ופיתיון', 'הטלה', 'הבנת תנאי המים', 'טיפול בדגים ובציוד'],
    plansTitle: 'מוצאים תאריכים שמתאימים למשפחה.',
    plansBody: 'אפשר להביע עניין ביציאות דיג מקומיות בימי ראשון ובטיולים לקיז. בחרו את כל התאריכים שתרצו, או תאריך אחד מתוך כמה חלופות. הבקשה היא הבעת התעניינות, לא אישור מקום.',
    seasonTitle: 'חושבים על הקיץ או על פסח?',
    seasonBody: 'אפשר להוסיף התעניינות עונתית ללא עלות באותו חשבון, גם בלי לבחור יום ראשון. אפשר לציין טיולים במהלך פסח וגם תאריכים שעדיין לא בטוחים לגביהם.',
    seasonAction: 'התעניינות בקיץ או בפסח',
    shareTitle: 'מכירים משפחה שזה יכול להתאים לה?', share: 'שיתוף בוואטסאפ', copy: 'העתקת קישור', copied: 'הקישור הועתק.', copyFallback: 'אפשר לסמן ולהעתיק את הקישור הציבורי שמופיע כאן.', link: 'קישור לעמוד הציבורי',
    foot: 'אפשר לשאול כל שאלה. לפתיחת טיוטת וואטסאפ לרב שלמה:',
  },
} as const;

/** Candidate localized presentation. Root admits the exact genuine photograph
 * before mounting this component; neither props nor a fixture proves approval. */
export function IndividualTripLanding({ locale, publicUrl, photo }: IndividualTripLandingProps) {
  const imageUrl = new URL(photo.src, publicUrl).href;
  const urls = tripLandingUrls({ locale, publicUrl, photo: { ...photo, src: imageUrl } });
  const t = copy[locale], entry = `/${locale}/trips`;
  const [notice, setNotice] = useState(''), [showFallback, setShowFallback] = useState(false);
  const contact = `https://wa.me/13054278909?text=${encodeURIComponent(t.draft)}`;
  const invitation = `${TRIP_LANDING_COPY[locale].invitation} ${urls.publicUrl}`;
  async function copyLink() {
    try { await navigator.clipboard.writeText(urls.publicUrl); setNotice(t.copied); setShowFallback(false); }
    catch { setNotice(t.copyFallback); setShowFallback(true); }
  }
  return <main className={styles.page} lang={locale} dir={locale === 'he' ? 'rtl' : 'ltr'}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element -- exact locked logo, no image transformation */}
          <img src={TRIP_LOCKED_LOGO} width="76" height="76" alt={t.academy} />
          <div><strong>{t.academy}</strong><span>{t.region}</span></div>
        </div>
        <a className={styles.headerContact} href={contact} target="_blank" rel="noopener noreferrer">{t.whatsapp} <span aria-hidden="true">↗</span></a>
      </header>
      <section className={styles.hero} aria-labelledby="trip-landing-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{t.eyebrow}</p>
          <h1 id="trip-landing-title">{t.title}</h1>
          <p className={styles.pillars} dir="ltr">Torah • Fishing • Self-Governance</p>
          <p className={styles.lead}>{t.intro}</p>
        </div>
        <figure className={styles.photo}>
          {/* eslint-disable-next-line @next/next/no-img-element -- consume approved original bytes with no proxy or crop */}
          <img src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} fetchPriority="high" decoding="async" />
          <figcaption dir="ltr">Bass Fishing Seminar / Sunday 11/22/26 • Boca Raton</figcaption>
        </figure>
        <div className={styles.heroActions}>
          <a className={styles.primary} href={entry}>{t.choose}<span aria-hidden="true">↗</span></a>
          <p className={styles.free}>{t.free}</p>
          <p className={styles.expectation}>{t.expectation}</p>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="trip-gains-title">
        <p className={styles.eyebrow}>{t.academy}</p><h2 id="trip-gains-title">{t.gainsTitle}</h2><p className={styles.sectionLead}>{t.gainsIntro}</p>
        <div className={styles.gains}>{t.gains.map(([title, text], index) => <article key={title}><span className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>
      <section className={styles.learning} aria-labelledby="trip-learning-title">
        <div><h2 id="trip-learning-title">{t.learningTitle}</h2><p>{t.learningIntro}</p></div>
        <ul>{t.skills.map(skill => <li key={skill}><span aria-hidden="true">✓</span>{skill}</li>)}</ul>
      </section>
      <section className={styles.plan} aria-labelledby="trip-plan-title"><h2 id="trip-plan-title">{t.plansTitle}</h2><p>{t.plansBody}</p><a className={styles.primary} href={entry}>{t.choose}<span aria-hidden="true">↗</span></a></section>
      <section className={styles.seasons} aria-labelledby="trip-season-title"><h2 id="trip-season-title">{t.seasonTitle}</h2><p>{t.seasonBody}</p><a className={styles.textLink} href={entry}>{t.seasonAction}<span aria-hidden="true">↗</span></a></section>
      <section className={styles.share} aria-labelledby="trip-share-title"><h2 id="trip-share-title">{t.shareTitle}</h2>
        <div className={styles.shareActions}><a className={styles.secondary} href={`https://wa.me/?text=${encodeURIComponent(invitation)}`} target="_blank" rel="noopener noreferrer">{t.share}</a><button className={styles.secondary} type="button" onClick={() => void copyLink()}>{t.copy}</button></div>
        <p className={styles.notice} role="status" aria-live="polite">{notice}</p>
        {showFallback && <label className={styles.fallback}>{t.link}<input type="text" dir="ltr" readOnly value={urls.publicUrl} onFocus={event => event.currentTarget.select()} /></label>}
      </section>
      <footer className={styles.footer}><p>{t.foot}</p><a href={contact} target="_blank" rel="noopener noreferrer"><span dir="ltr">305-427-8909</span><span aria-hidden="true">↗</span></a></footer>
    </div>
  </main>;
}
export const TripLanding = IndividualTripLanding;
