"use client";
import type {Locale} from '../../lib/locale.ts';
import {academyExactCopy} from './academy-exact-copy.ts';
import {useAcademyHref} from './academy-route-context.tsx';
import styles from './academy-site.module.css';
export function AcademyOutingPrices({locale}:{locale:Locale}){
 const copy=academyExactCopy[locale].pricing.outings,href=useAcademyHref();
 return <section id="outings" className={`${styles.wrap} ${styles.section} ${styles.outingsCompact}`}>
  <p data-academy-outing="keys"><strong>{copy.keysTitle}</strong> — {copy.keysBody}</p>
  <p data-academy-outing="offshore"><strong>{copy.offshoreTitle}</strong> — {copy.offshoreBody}</p>
  <a href={href(locale)+'#keys-trip-faq'}>{copy.faqLink}</a>
 </section>;
}
