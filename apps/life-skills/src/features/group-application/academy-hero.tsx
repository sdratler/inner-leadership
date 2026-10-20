import type {Locale} from '../../lib/locale.ts';
import assets from './academy-hero-assets.json';
import styles from './academy-site.module.css';
/** Existing text-free source artwork only; all wording and the CTA are HTML. */
export function AcademyHero({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==='he'?he:en,{desktop,mobile}=assets.textFree;
 return <section className={styles.hero} aria-labelledby="academy-title" data-academy-hero><div className={styles.heroArt}>
  <picture><source media="(min-width:768px)" srcSet={desktop.publicPath} width={desktop.width} height={desktop.height}/><img src={mobile.publicPath} width={mobile.width} height={mobile.height} alt={t('An adult and a boy talking at a fishing bridge, with the deck and railing visible','מבוגר וילד משוחחים על גשר דיג, לצד משטח ההליכה והמעקה')} fetchPriority="high" decoding="async" data-academy-hero-image/></picture>
  <div className={styles.heroHtmlHeading}><h1 id="academy-title">{t('South Florida Jewish Leadership Fishing Academy','האקדמיה היהודית לדיג ולמנהיגות בדרום פלורידה')}</h1></div>
  <div aria-hidden="true" className={styles.heroPhotoSpace}/>
  <div className={styles.heroHtmlAction}><p>{t('A part-time enrichment program for boys','תוכנית העשרה במשרה חלקית לבנים')}</p><p>{t('Torah • Fishing • Self-Governance','תורה • דיג • הנהגה עצמית')}</p><a className={styles.heroCta} href="#pricing" data-jlfa-primary="true">{t('Reserve a Spot Now','לשמירת מקום')}</a></div>
 </div></section>;
}
