import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  contact as contactCopy,
  en as englishCopy,
  he as hebrewCopy,
} from '../website/redesign-copy.json';
import FloatingWhatsAppButton from './FloatingWhatsAppButton.jsx';

const redesignCopy = {contact: contactCopy, en: englishCopy, he: hebrewCopy};

const ASSETS = 'assets/';
const MODULE_IMAGES = {
  W01: 'images/LS-WEB-04__p03__r01.webp',
  W02: 'images/LS-CUR-W02__p03__r01.webp',
  W03: 'images/LS-CUR-W03__p02__r01.webp',
  W04: 'images/LS-CUR-W04__p03__r01.webp',
  W05: 'images/LS-WEB-02__p02__r01.webp',
  W06: 'images/LS-WEB-03__p03__r01.webp',
  W07: 'images/LS-CUR-W07__p03__r01.webp',
  W08: 'images/LS-AD-A07__p03__r01.webp',
  W09: 'images/LS-CUR-W09__p03__r01.webp',
  W10: 'images/LS-CUR-W10__p03__r01.webp',
  W11: 'images/LS-CUR-W11__p03__r01.webp',
  W12: 'images/LS-WEB-04__p03__r01.webp',
};

const MODULE_ALTS = {
  he: {
    W01: 'איור של ילדים עוסקים בפעילויות שונות במרחב ירוק',
    W02: 'איור של ילד ומבוגר משוחחים ליד שולחן מול נוף פתוח',
    W03: 'איור של ילד עוזר לערוך שולחן בבית',
    W04: 'איור של ילד ומבוגר משוחחים בחצר',
    W05: 'איור של משפחה משוחחת יחד סביב שולחן',
    W06: 'איור של ילד ומבוגר הולכים ומשוחחים יחד',
    W07: 'איור של ילד עומד מול כמה אפשרויות במרחב פתוח',
    W08: 'איור של ילד לוקח אחריות על משימה יום־יומית',
    W09: 'איור של ילד ומבוגר בוחנים יחד מצב ליד שולחן',
    W10: 'איור של ילד יושב בשקט ומתבונן בסביבתו',
    W11: 'איור של ילד משוחח עם מבוגר במטבח ביתי',
    W12: 'איור רחב של ילדים לומדים ופועלים במרחב ירוק',
  },
  en: {
    W01: 'Illustration of children engaged in different activities in a green courtyard',
    W02: 'Illustration of a child and adult talking at a table with an open view',
    W03: 'Illustration of a child helping to set a table at home',
    W04: 'Illustration of a child and adult talking in a courtyard',
    W05: 'Illustration of a family talking together around a table',
    W06: 'Illustration of a child and adult walking and talking together',
    W07: 'Illustration of a child standing where several options are possible',
    W08: 'Illustration of a child taking responsibility for an everyday task',
    W09: 'Illustration of a child and adult considering a situation together at a table',
    W10: 'Illustration of a child sitting quietly and noticing his surroundings',
    W11: 'Illustration of a child talking with an adult in a home kitchen',
    W12: 'Wide illustration of children learning and taking part in a green courtyard',
  },
};

const ICONS = {
  self_governance: 'self-governance.svg',
  emotional_regulation: 'emotional-regulation.svg',
  responsibility: 'responsibility.svg',
};

const META = {
  he: {
    title: 'כישורי חיים | טיפול רגשי לבנים בגילאי 8–12',
    description: 'טיפול רגשי לבנים בגילאי 8–12, בשילוב הדרכת הורים מעשית.',
    preview: 'תצוגה לבדיקת האתר — לא אתר שפורסם.',
    benefitsLabel: 'מה הילד מפתח',
    approachLabel: 'דרך העבודה',
    teachingLabel: 'מה לומדים',
    paceLabel: 'הקצב מותאם לילד',
    parentLabel: 'להורים',
    faqLabel: 'מידע מעשי',
    closingLabel: 'הצעד הראשון',
    heroAlt: 'שלמה דרטלר וילד יושבים יחד על חומת אבן ומביטים זה בזה',
    founderAlt: 'שלמה דרטלר יושב על הדשא עם קבוצת ילדים',
    navLabel: 'ניווט ראשי',
    terms: ['תנאים מעשיים ופרטיות', 'ביטול או שינוי מועד: בהודעה של לפחות 24 שעות, נשמר זיכוי למפגש ומתאמים מועד חלופי לפי זמינות משותפת. בהודעה קצרה יותר או באי־הגעה, מנוצל זיכוי אחד ללא החלפה אוטומטית, בכפוף לזכויות מחייבות ולשיקול דעת במקרים חריגים. מומלץ שבפנייה הראשונה יופיעו רק גיל, אזור כללי, זמינות ותיאור כללי של הצורך, בלי שמות ילדים או פרטים רגישים. שיחת המעקב השבועית בת 15 הדקות כלולה; פגישה ממושכת יותר עם ההורים מחייבת הסכמה נפרדת מראש.'],
    termsLink: 'תנאי השירות',
    privacyLink: 'פרטיות',
  },
  en: {
    title: 'Life Skills | Emotional Therapy for Boys Ages 8–12',
    description: 'Emotional therapy for boys ages 8–12, together with practical parent guidance.',
    preview: 'Website review preview — not a published service page.',
    benefitsLabel: 'What a child develops',
    approachLabel: 'The approach',
    teachingLabel: 'What children learn',
    paceLabel: 'Pace adapts to the child',
    parentLabel: 'For parents',
    faqLabel: 'Practical information',
    closingLabel: 'The first step',
    heroAlt: 'Shlomo Dratler and a boy seated together on a stone wall, looking at each other',
    founderAlt: 'Shlomo Dratler seated on the grass with a group of children',
    navLabel: 'Main navigation',
    terms: ['Practical terms and privacy', 'Cancellation or rescheduling: with at least 24 hours’ notice, the session credit is retained and an alternative is arranged subject to mutual availability. With shorter notice or non-attendance, one credit is used without automatic replacement, subject to applicable rights and discretion in exceptional cases. In a first message, include only age, general area, availability and a general description of the need—without children’s names or sensitive details. The weekly 15-minute check-in is included; a longer parent meeting requires separate prior agreement.'],
    termsLink: 'Terms',
    privacyLink: 'Privacy',
  },
};

function approvedContact() {
  const config = window.LIFE_SKILLS_CONFIG || {};
  return config.whatsappVerified === true && /^[1-9][0-9]{7,14}$/.test(config.whatsappNumber || '')
    ? `https://wa.me/${config.whatsappNumber}`
    : redesignCopy.contact.whatsapp_url;
}

function BrandLockup({brand, locale, compact = false}) {
  if (locale === 'he') {
    return <span className={`brand-lockup brand-lockup-he ${compact ? 'brand-lockup-compact' : ''}`}>
      <img src={ASSETS + 'images/LS_LOGO_HE_LEAF_APPROVED_20260910-transparent.png'} alt="כישורי חיים — לחיים שלמים"/>
    </span>;
  }
  return <span className={`brand-lockup brand-lockup-en ${compact ? 'brand-lockup-compact' : ''}`}>
    <span className="english-leaf" aria-hidden="true"/>
    <span className="brand-words"><strong>{brand.name}</strong></span>
  </span>;
}

function Reveal({children, className = ''}) {
  return <div className={`reveal ${className}`.trim()}>{children}</div>;
}

export function OrganicBulletList({items}) {
  return <ul className="organic-list">{items.map((item, index) =>
    <li key={index}><span aria-hidden="true" className="leaf-bullet"/><span>{item.text}</span></li>
  )}</ul>;
}

export function ModuleImageGallery({image, alt}) {
  return <figure className="module-media">
    <img src={ASSETS + image} alt={alt} width="1536" height="1024" loading="lazy"/>
  </figure>;
}

export function CurriculumModule({module, index, locale, exampleLabel}) {
  const key = module.internal_theme_key;
  return <article className={`curriculum-module ${index % 2 ? 'module-reverse' : ''} ${(index + 1) % 4 === 0 ? 'module-teal' : ''}`} data-theme-key={key} aria-label={`${index + 1} / 12`}>
    <ModuleImageGallery image={MODULE_IMAGES[key]} alt={MODULE_ALTS[locale][key]}/>
    <div className="module-copy">
      <span className="module-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <h3>{module.title}</h3>
      <OrganicBulletList items={module.bullets}/>
      <div className="module-example">
        <span>{exampleLabel}</span>
        <p>{module.example}</p>
      </div>
    </div>
  </article>;
}

function ArrowIcon({direction}) {
  return <svg viewBox="0 0 32 20" aria-hidden="true" focusable="false" className={`arrow-icon arrow-${direction}`}>
    <path d="M2 10h26M20 2l8 8-8 8"/>
  </svg>;
}

export function CurriculumCarousel({modules, locale, exampleLabel}) {
  const trackRef = useRef(null);
  const slideRefs = useRef([]);
  const frameRef = useRef(null);
  const [current, setCurrent] = useState(0);

  function goTo(index) {
    const next = Math.max(0, Math.min(modules.length - 1, index));
    setCurrent(next);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    slideRefs.current[next]?.scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center'});
  }

  function syncCurrent() {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const track = trackRef.current;
      if (!track) return;
      const center = track.getBoundingClientRect().left + track.clientWidth / 2;
      let nearest = 0;
      let distance = Number.POSITIVE_INFINITY;
      slideRefs.current.forEach((slide, index) => {
        if (!slide) return;
        const rect = slide.getBoundingClientRect();
        const nextDistance = Math.abs(rect.left + rect.width / 2 - center);
        if (nextDistance < distance) {
          distance = nextDistance;
          nearest = index;
        }
      });
      setCurrent(nearest);
    });
  }

  useEffect(() => () => frameRef.current && cancelAnimationFrame(frameRef.current), []);

  const previousLabel = locale === 'he' ? 'למפגש הקודם' : 'Previous session';
  const nextLabel = locale === 'he' ? 'למפגש הבא' : 'Next session';
  const carouselLabel = locale === 'he' ? 'שנים עשר מפגשים' : 'Twelve sessions';
  return <div className="curriculum-carousel" role="region" aria-label={carouselLabel} aria-roledescription="carousel">
    <div className="carousel-toolbar">
      <button type="button" className="carousel-arrow carousel-previous" onClick={() => goTo(current - 1)} disabled={current === 0} aria-label={previousLabel}>
        <ArrowIcon direction="previous"/>
      </button>
      <p className="carousel-status" aria-live="polite"><bdi dir="ltr">{current + 1} / {modules.length}</bdi></p>
      <button type="button" className="carousel-arrow carousel-next" onClick={() => goTo(current + 1)} disabled={current === modules.length - 1} aria-label={nextLabel}>
        <ArrowIcon direction="next"/>
      </button>
    </div>
    <div ref={trackRef} className="curriculum-track" onScroll={syncCurrent} tabIndex="0" onKeyDown={event => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goTo(locale === 'he' ? current + 1 : current - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goTo(locale === 'he' ? current - 1 : current + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goTo(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        goTo(modules.length - 1);
      }
    }}>
      {modules.map((module, index) => <div className="curriculum-slide" key={module.internal_theme_key} ref={node => { slideRefs.current[index] = node; }}>
        <CurriculumModule module={module} index={index} locale={locale} exampleLabel={exampleLabel}/>
      </div>)}
    </div>
    <div className="carousel-dots" role="group" aria-label={locale === 'he' ? 'בחירת מפגש' : 'Choose a session'}>
      {modules.map((module, index) => <button key={module.internal_theme_key} type="button" className={index === current ? 'is-active' : ''} onClick={() => goTo(index)} aria-label={`${locale === 'he' ? 'מפגש' : 'Session'} ${index + 1}`} aria-current={index === current ? 'true' : undefined}/>) }
    </div>
  </div>;
}

export function CampaignHero({section, benefits, locale, contact, meta}) {
  const lines = locale === 'he' ? ['בכל ילד', 'יש גיבור.'] : ['There’s a hero', 'in every child.'];
  return <section className="hero-shell" aria-labelledby={`hero-${locale}`}>
    <div className="hero-layout container hero">
      <div className="hero-copy">
        <h1 id={`hero-${locale}`}>{lines.map(line => <span key={line}>{line}</span>)}</h1>
        <span className="hero-divider" aria-hidden="true"/>
        <h2 className="hero-service-title">{section.service_title}</h2>
        <div className="hero-service-details">{section.service_details.map((line, index) => <p key={line}>
          {index === 0 ? <>{locale === 'he' ? 'בגילאי ' : 'Ages '}<bdi dir="ltr">8–12</bdi></> : line}
        </p>)}</div>
      </div>
      <figure className="hero-photo">
        <picture>
          <source media="(max-width: 760px)" srcSet={ASSETS + 'images/founder-boy-hero-mobile.webp'}/>
          <img src={ASSETS + 'images/founder-boy-hero-desktop.webp'} alt={meta.heroAlt} width="2400" height="1600"/>
        </picture>
      </figure>
      <div className="hero-action">
        <a className="button button-light" href={contact} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{redesignCopy[locale].cta.button}</a>
      </div>
      <ul className="hero-benefits" aria-label={meta.benefitsLabel}>{benefits.items.map(item => <li key={item.id}>
        <img src={`${ASSETS}icons/${ICONS[item.id]}`} alt="" aria-hidden="true"/>
        <span>{item.title}</span>
      </li>)}</ul>
    </div>
  </section>;
}

export function OutcomeCards({section, meta}) {
  return <section className="section benefits container" aria-labelledby="benefits-title">
    <div className="section-heading centered">
      <p className="eyebrow">{meta.benefitsLabel}</p>
      <h2 id="benefits-title">{section.heading}</h2>
    </div>
    <div className="benefit-grid">{section.items.map(item =>
      <article className="benefit-card" key={item.id}>
        <img className="service-icon" src={`${ASSETS}icons/${ICONS[item.id]}`} alt="" aria-hidden="true"/>
        <h3>{item.title}</h3><p>{item.body}</p>
      </article>
    )}</div>
  </section>;
}

function ApproachIntro({section, meta, locale}) {
  return <section id={`approach-${locale}`} className="approach-band" aria-labelledby={`approach-title-${locale}`}>
    <div className="container approach-layout">
      <div>
        <p className="eyebrow">{meta.approachLabel}</p>
        <h2 id={`approach-title-${locale}`}>{section.heading}</h2>
      </div>
      <div className="approach-copy">
        <p className="approach-lede">{section.body}</p>
        <p className="principles-intro">{section.principles_intro}</p>
        <dl className="principle-grid">{section.principles.map(principle => <div key={principle.id}>
          <dt>{principle.title}</dt><dd>{principle.body}</dd>
        </div>)}</dl>
        <p className="approach-methods">{section.methods}</p>
        <ul className="practice-lines">{section.practice_lines.map(line => <li key={line}>{line}</li>)}</ul>
      </div>
    </div>
  </section>;
}

function ParentGuidance({section, meta}) {
  return <section className="parent-guidance">
    <div className="container parent-layout">
      <img src={ASSETS + 'icons/parent-guidance.svg'} alt="" aria-hidden="true"/>
      <div><p className="eyebrow">{meta.parentLabel}</p><h2>{section.heading}</h2><p>{section.body}</p></div>
    </div>
  </section>;
}

export function FounderSection({section, locale, meta}) {
  return <section id={`founder-${locale}`} className="founder" aria-labelledby={`founder-title-${locale}`}>
    <figure className="founder-photo" aria-hidden="true">
      <img src={ASSETS + 'images/founder-grass-group.webp'} alt="" width="1600" height="1068" loading="lazy"/>
    </figure>
    <div className="founder-overlay" aria-hidden="true"/>
    <div className="container founder-layout">
      <div className="founder-copy">
        <p className="eyebrow">{section.eyebrow}</p>
        <span className="founder-divider" aria-hidden="true"/>
        <h2 id={`founder-title-${locale}`}>{section.name}</h2>
        <div className="founder-paragraphs">{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
      </div>
    </div>
  </section>;
}

export function PrivateTestimonial({locale}) {
  const label = locale === 'he' ? 'עדות משפחתית פרטית' : 'Private family testimonial';
  return <section className="testimonial" aria-label={label}>
    <div className="container testimonial-inner">
      <figure className="testimonial-portrait">
        <img src={ASSETS + 'images/l-bars-2024.png'} alt="LB" width="2000" height="2000" loading="lazy"/>
      </figure>
      <blockquote>
        <p lang="en" dir="ltr">“Medication is no longer relevant…”</p>
        <footer><cite>LB</cite><time dateTime="2024">2024</time></footer>
      </blockquote>
    </div>
  </section>;
}

export function FAQAccordion({section, locale, meta}) {
  const items = [...section.items, {id: 'terms_privacy', question: meta.terms[0], answer: meta.terms[1]}];
  return <section id={`faq-${locale}`} className="section faq container" aria-labelledby={`faq-title-${locale}`}>
    <div className="section-heading"><p className="eyebrow">{meta.faqLabel}</p><h2 id={`faq-title-${locale}`}>{section.heading}</h2></div>
    <div className="faq-list">{items.map((item, index) =>
      <details key={item.id} id={item.id === 'terms_privacy' ? `terms-${locale}` : undefined} className={index === items.length - 1 ? 'terms-disclosure' : ''}>
        <summary>{item.question}</summary><p>{item.answer}</p>
      </details>
    )}</div>
  </section>;
}

function Header({c, locale, meta, contact, reviewPreview}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  const menuLabel = locale === 'he' ? 'פתיחת תפריט' : 'Open menu';
  const closeLabel = locale === 'he' ? 'סגירת תפריט' : 'Close menu';
  const ctaLabel = redesignCopy[locale].cta.button;
  return <><a className="skip-link" href="#main-content">{c.accessibility.skip_to_content}</a>
    {reviewPreview ? <div className="preview-bar"><p>{meta.preview}</p></div> : null}
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand" href={`?lang=${locale}`} aria-label={c.brand.name}><BrandLockup brand={c.brand} locale={locale} compact/></a>
        <nav className="desktop-nav" aria-label={meta.navLabel}>{c.navigation.map(item => <a key={item.target} href={`#${item.target}-${locale}`}>{item.label}</a>)}</nav>
        <div className="header-actions">
          <div className="language-switch" role="group" aria-label="שפה / Language">
            <a href="?lang=he" lang="he" aria-current={locale === 'he' ? 'page' : undefined}>HE</a>
            <span aria-hidden="true">/</span>
            <a href="?lang=en" lang="en" dir="ltr" aria-current={locale === 'en' ? 'page' : undefined}>EN</a>
          </div>
          <a className="button button-header" href={contact} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp</a>
        </div>
        <button type="button" className="menu-button" aria-expanded={menuOpen} aria-controls="mobile-menu" aria-label={menuOpen ? closeLabel : menuLabel} onClick={() => setMenuOpen(open => !open)}>
          <span/><span/><span/>
        </button>
      </div>
      <div id="mobile-menu" className={`mobile-menu ${menuOpen ? 'is-open' : ''}`} hidden={!menuOpen}>
        <nav className="container" aria-label={meta.navLabel}>
          {c.navigation.map(item => <a key={item.target} href={`#${item.target}-${locale}`} onClick={() => setMenuOpen(false)}>{item.label}</a>)}
          <div className="mobile-language-switch" role="group" aria-label="שפה / Language">
            <a href="?lang=he" lang="he" aria-current={locale === 'he' ? 'page' : undefined}>עברית</a>
            <a href="?lang=en" lang="en" dir="ltr" aria-current={locale === 'en' ? 'page' : undefined}>English</a>
          </div>
          <a className="button button-light mobile-menu-cta" href={contact} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{ctaLabel}</a>
        </nav>
      </div>
    </header>
  </>;
}

function ClosingCTA({section, locale, meta, contact}) {
  return <section id={`contact-${locale}`} className="closing">
    <div className="container closing-inner">
      <p className="eyebrow">{meta.closingLabel}</p>
      <h2>{section.heading}</h2>
      <a className="button button-light" href={contact} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{section.button}</a>
      <p className="closing-location">{section.region_line}</p>
    </div>
  </section>;
}

function Footer({c, locale, meta}) {
  return <footer className="page-footer">
    <div className="container footer-inner">
      <BrandLockup brand={c.brand} locale={locale}/>
      <p className="footer-relationship">{c.footer.relationship}</p>
      <a className="bna-footer-link" href="https://bneineviimacademy.org/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label="Bnei Neviim Academy">
        <img src={ASSETS + 'images/bna-logo-nobg.png'} alt="" width="120" height="32" loading="lazy"/>
      </a>
      <nav aria-label={locale === 'he' ? 'מידע נוסף' : 'More information'}>
        <a href={`#terms-${locale}`}>{meta.termsLink}</a><span aria-hidden="true">·</span>
        <a href={`#terms-${locale}`}>{meta.privacyLink}</a><span aria-hidden="true">·</span>
        <a href={c.footer.phone_href}><bdi dir="ltr">{c.footer.phone_display}</bdi></a>
      </nav>
    </div>
  </footer>;
}

function App() {
  const requested = new URLSearchParams(window.location.search).get('lang');
  const locale = requested === 'en' ? 'en' : 'he';
  const c = redesignCopy[locale];
  const meta = META[locale];
  const contact = approvedContact();
  const reviewPreview = window.LIFE_SKILLS_CONFIG?.reviewPreview === true;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = c.direction;
    document.documentElement.dataset.locale = locale;
    document.title = meta.title;
    document.querySelector('meta[name="description"]').content = meta.description;
    const requestedAnchor = window.location.hash.slice(1);
    if (requestedAnchor) requestAnimationFrame(() => document.getElementById(requestedAnchor)?.scrollIntoView());
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const observer = reduceMotion ? null : new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }), {rootMargin: '0px 0px -8% 0px', threshold: .06});
    document.querySelectorAll('.reveal').forEach(node => observer ? observer.observe(node) : node.classList.add('is-visible'));
    return () => observer?.disconnect();
  }, [locale, c, meta]);

  return <><Header c={c} locale={locale} meta={meta} contact={contact} reviewPreview={reviewPreview}/><main id="main-content" tabIndex="-1">
    <CampaignHero section={c.hero} benefits={c.benefits} locale={locale} contact={contact} meta={meta}/>
    <ApproachIntro section={c.teaching.approach_intro} meta={meta} locale={locale}/>
    <section id={`teaching-${locale}`} className="section teaching">
      <div className="container">
        <div className="section-heading teaching-heading">
          <p className="eyebrow">{c.teaching.eyebrow}</p>
          <h2>{c.teaching.heading}</h2>
          <p className="teaching-intro">{c.teaching.intro}</p>
          <p className="teaching-support">{c.teaching.intro_support}</p>
        </div>
        <p className="pace-note"><strong>{meta.paceLabel}</strong><span>{c.teaching.pace_note}</span></p>
        <CurriculumCarousel modules={c.teaching.modules} locale={locale} exampleLabel={c.teaching.example_label}/>
      </div>
    </section>
    <ParentGuidance section={c.parent_guidance} meta={meta}/>
    <FounderSection section={c.founder} locale={locale} meta={meta}/>
    <FAQAccordion section={c.faq} locale={locale} meta={meta}/>
    <ClosingCTA section={c.closing_cta} locale={locale} meta={meta} contact={contact}/>
    <PrivateTestimonial locale={locale}/>
  </main><Footer c={c} locale={locale} meta={meta}/><FloatingWhatsAppButton locale={locale} corner="left"/></>;
}

createRoot(document.getElementById('life-skills-root')).render(<App/>);
