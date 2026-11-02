import {academyCampaignSnapshot} from '../../../../features/group-application/academy-campaign-server.ts';
import {AcademyPublicRoute} from "../../../../features/group-application/academy-route-context.tsx";
import {academyRouteMode} from "../../../../features/group-application/academy-routing-server.ts";
import {academyMetadata} from "../../../../features/group-application/academy-metadata.ts";
import{notFound}from"next/navigation";
import{isLocale}from"../../../../lib/locale.ts";
import{publicGroupApplicationEnvironmentEnabled}from"../../../../features/group-application/candidate.ts";
import{AcademyIntakePage}from"../../../../features/group-application/academy-intake-page.tsx";
import {AcademyTrip390Client} from "../../../../features/group-application/academy-trip390-client.tsx";
import {academyPublicOffer,trip390RouteMetadata} from "../../../../features/group-application/academy-trip390-transport.ts";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params,language=locale==="he"?"he":"en",mode=await academyRouteMode();
 const offer=academyPublicOffer(process.env);
 if(offer==='unavailable')notFound();
 return offer==='trip390'?trip390RouteMetadata(language,'/apply',mode):academyMetadata(language,"/apply",language==="he"?"הרשמה חינמית לאקדמיה לדיג":"Free Registration for the Fishing Academy",mode,await academyCampaignSnapshot());
}
export default async function Page({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params,offer=academyPublicOffer(process.env);
 if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled()||offer==='unavailable')notFound();
 if(offer==='trip390')return <AcademyTrip390Client locale={locale} openForm/>;
 return <AcademyPublicRoute mode={await academyRouteMode()} campaign={await academyCampaignSnapshot()}><AcademyIntakePage locale={locale} privacyLinkEnabled={process.env.LS_BNA_PRIVACY_LINK_ENABLED==="true"}/></AcademyPublicRoute>;
}
