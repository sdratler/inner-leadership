import {academyCampaignSnapshot} from '../../../../features/group-application/academy-campaign-server.ts';
import {AcademyPublicRoute} from "../../../../features/group-application/academy-route-context.tsx";
import {academyRouteMode} from "../../../../features/group-application/academy-routing-server.ts";
import {academyMetadata} from "../../../../features/group-application/academy-metadata.ts";
import{notFound}from"next/navigation";
import{isLocale}from"../../../../lib/locale.ts";
import{publicGroupApplicationEnvironmentEnabled}from"../../../../features/group-application/candidate.ts";
import{AcademyIntakePage}from"../../../../features/group-application/academy-intake-page.tsx";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params,language=locale==="he"?"he":"en";const routeMode=await academyRouteMode();return academyMetadata(language,"/apply",language==="he"?"הרשמה חינמית לאקדמיה לדיג":"Free Registration for the Fishing Academy",routeMode,await academyCampaignSnapshot());}
export default async function Page({params}:{params:Promise<{locale:string}>}){const{locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <AcademyPublicRoute mode={await academyRouteMode()} campaign={await academyCampaignSnapshot()}><AcademyIntakePage locale={locale} privacyLinkEnabled={process.env.LS_BNA_PRIVACY_LINK_ENABLED==="true"}/></AcademyPublicRoute>;}
