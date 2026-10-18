import type {Locale} from "../../lib/locale.ts";
import assets from "./academy-hero-assets.json";
import styles from "./academy-site.module.css";

export function AcademyHero({locale}:{locale:Locale}){
 const desktop=assets.assets.find(asset=>asset.role==="desktop")!,mobile=assets.assets.find(asset=>asset.role==="mobile")!;
 return <section className={styles.hero} aria-labelledby="academy-title" data-academy-hero>
  <div className={styles.heroArt}><picture><source media="(min-width: 768px)" srcSet={desktop.publicPath} width={desktop.width} height={desktop.height}/>
   <img src={mobile.publicPath} width={mobile.width} height={mobile.height} alt={locale==="he"?"מבוגר וילד משוחחים ליד המים על גשר דיג":"An adult and a boy talking beside the water on a fishing bridge"} fetchPriority="high" decoding="async" data-academy-hero-image/>
  </picture>
  <div className={styles.heroSemantics} lang="en" dir="ltr" data-academy-hero-heading>
   <p className={styles.heroPlace}><span>South Florida</span></p><h1 id="academy-title">Jewish Leadership<br/>Fishing Academy</h1>
  </div>
  <div className={styles.heroSelectedAction} data-academy-hero-invitation>
   <p className={styles.heroSemantics} lang="en" dir="ltr">A part-time enrichment<br/>program for boys</p>
   <p className={styles.heroSemantics} lang="en" dir="ltr">Torah <span>•</span> Fishing <span>•</span> Self-governance</p>
   <a href="#pricing" className={styles.heroCta} data-jlfa-primary>{locale==="he"?"למחיר המשפחות המייסדות":"See Founding Pricing"}</a>
  </div></div>
 </section>;
}
