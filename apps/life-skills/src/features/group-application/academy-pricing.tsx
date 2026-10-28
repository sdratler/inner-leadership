"use client";
import type {Locale} from '../../lib/locale.ts';
import {useAcademyHref} from './academy-route-context.tsx';
import {useAcademyCampaign} from './academy-campaign-state.ts';
import {AcademyFounderCounter} from './academy-founder-counter.tsx';
import {founderPrice} from './academy-founder-contract.ts';
import {academyExactCopy} from './academy-exact-copy.ts';
import styles from './academy-pricing.module.css';
import {academyCoastalCopy} from './academy-coastal-copy.ts';
/** Exact editorial template; amounts always come from the commercial function. */
function PriceLine({template,value}:{template:string;value:number}){
 const [before,after]=template.split('{price}');
 return <>{before}<bdi dir="ltr">${value.toLocaleString('en-US')}</bdi>{after}</>;
}
export function AcademyRegistrationOffer({locale,childrenCount=1}:{locale:Locale;childrenCount?:number}){
 const pre=useAcademyCampaign()?.phase==='PRE_REGISTRATION',copy=academyExactCopy[locale].form;
 const offer=pre?copy.offerA:copy.offerB;
 return <details className={styles.formOffer} data-registration-price><summary>{academyCoastalCopy[locale].offerDetails}</summary><div>
  <p><PriceLine template={offer.primary} value={founderPrice('prepay',pre,false)}/></p>
  <p><PriceLine template={offer.sibling} value={founderPrice('prepay',pre,true)}/></p>
  <p><PriceLine template={offer.monthly} value={founderPrice('monthly_block',false,false)}/></p>
  {pre&&childrenCount===2&&<p data-registration-family-price><PriceLine template={copy.offerA.twoChildren} value={founderPrice('prepay',true,false)+founderPrice('prepay',true,true)}/></p>}
  <p className={styles.qualifier}>{offer.qualifier}</p>
 </div></details>;
}
export function AcademyPricing({locale,applicationHref}:{locale:Locale;applicationHref?:string}){
 if(locale!=='en'&&locale!=='he')throw new Error('ACADEMY_PRICING_UNAVAILABLE');
 const formHref='/'+locale+'/florida/apply';
 if(applicationHref!==undefined&&applicationHref!==formHref&&applicationHref!=='#apply')throw new Error('ACADEMY_PRICING_UNAVAILABLE');
 const href=useAcademyHref(),pre=useAcademyCampaign()?.phase==='PRE_REGISTRATION',copy=academyExactCopy[locale],p=copy.pricing;
 return <section id="pricing" data-academy-pricing className={styles.pricing} lang={locale} dir={locale==='he'?'rtl':'ltr'} aria-labelledby="academy-pricing-title"><div className={styles.inner}>
  <header className={styles.header}><h2 id="academy-pricing-title">{p.heading}</h2><p>{p.unit}</p></header>
  <div className={styles.pricePanel} data-price-group="actual">
   <p data-price-kind={pre?'founding-primary':'regular-prepay'}><PriceLine template={p.primaryTemplate} value={founderPrice('prepay',pre,false)}/></p>
   <p data-price-kind={pre?'founding-sibling':'ordinary-sibling'}><PriceLine template={p.siblingTemplate} value={founderPrice('prepay',pre,true)}/></p>
   <p data-price-kind="monthly-block"><PriceLine template={p.monthlyTemplate} value={founderPrice('monthly_block',false,false)}/></p>
  </div>
  {pre&&<p className={styles.qualifier}>{p.founderQualifier}</p>}
  <p>{pre?p.noPayment:p.ordinaryBelow}</p>
  <AcademyFounderCounter locale={locale}/>
  <div className={styles.actions}><a className={styles.primary} href={applicationHref??href(locale,'/apply')}>{pre?copy.nav.preRegister:copy.nav.register}</a></div>
 </div></section>;
}
