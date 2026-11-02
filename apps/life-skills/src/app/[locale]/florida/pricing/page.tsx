import {academyCampaignSnapshot} from '../../../../features/group-application/academy-campaign-server.ts';
import {AcademyPublicRoute} from "../../../../features/group-application/academy-route-context.tsx";
import {academyRouteMode} from "../../../../features/group-application/academy-routing-server.ts";
import {academyMetadata} from "../../../../features/group-application/academy-metadata.ts";
import {notFound,redirect} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../../features/group-application/candidate.ts";
import {AcademySiteFrame} from "../../../../features/group-application/academy-site-frame.tsx";
import {AcademyPricing} from "../../../../features/group-application/academy-pricing.tsx";
import {AcademyOutingPrices} from "../../../../features/group-application/academy-outing-prices.tsx";
import styles from "../../../../features/group-application/academy-site.module.css";
import {academyPublicOffer,trip390AliasLocation,trip390RouteMetadata} from '../../../../features/group-application/academy-trip390-transport.ts';
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params,language=locale==="he"?"he":"en";const routeMode=await academyRouteMode(),offer=academyPublicOffer(process.env);
 if(offer==='unavailable')notFound();
 if(offer==='trip390')return trip390RouteMetadata(language,'',routeMode);
 return academyMetadata(language,"/pricing",language==="he"?"מחירים ויציאות":"Pricing & outings",routeMode,await academyCampaignSnapshot());}
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();
 const offer=academyPublicOffer(process.env);
 if(offer==='unavailable')notFound();
 if(offer==='trip390')redirect(trip390AliasLocation(locale,'included',await academyRouteMode()));
 return <AcademyPublicRoute mode={await academyRouteMode()} campaign={await academyCampaignSnapshot()}><AcademySiteFrame locale={locale} path="/pricing"><main id="main"><h1 className={styles.pricingPageTitle}>{locale==="he"?"מחירי התוכנית ויציאות מיוחדות":"Program pricing & outings"}</h1><AcademyPricing locale={locale}/><AcademyOutingPrices locale={locale}/></main></AcademySiteFrame></AcademyPublicRoute>;}
