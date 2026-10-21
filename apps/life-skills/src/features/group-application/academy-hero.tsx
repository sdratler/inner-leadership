import type {Locale} from '../../lib/locale.ts';
import assets from './academy-hero-assets.json';
import styles from './academy-site.module.css';
/** Source-faithful localized raster typography; only the CTA is visible HTML. */
export function AcademyHero({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==='he'?he:en,{desktop,mobile}=assets.current[locale];
 return <section className={styles.hero} aria-labelledby="academy-title" data-academy-hero><div className={styles.heroArt}>
  <picture><source media="(min-width:768px)" srcSet={desktop.publicPath} width={desktop.width} height={desktop.height}/><img src={mobile.publicPath} width={mobile.width} height={mobile.height} alt={t('An adult and a boy talking at a fishing bridge, with the deck and railing visible','מבוגר וילד משוחחים על גשר דיג, לצד משטח ההליכה והמעקה')} fetchPriority="high" decoding="async" data-academy-hero-image/></picture>
  <div className={styles.heroSemantics}><h1 id="academy-title" lang="en" dir="ltr">South Florida Jewish Leadership Fishing Academy</h1><p>{t('A part-time enrichment program for boys','תוכנית העשרה במשרה חלקית לבנים')}</p><p>{t('Torah • Fishing • Self-governance','תורה • דיג • הנהגה עצמית')}</p></div>
  <div className={styles.heroSelectedAction}><a className={styles.heroCta} href="#pricing" data-jlfa-primary="true">{t('Reserve a Spot Now','לשמירת מקום')}</a></div>
 </div></section>;
}
