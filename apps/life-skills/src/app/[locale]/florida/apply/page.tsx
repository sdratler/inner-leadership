import {AcademyPublicRoute} from "../../../../features/group-application/academy-route-context.tsx";
import {academyRouteMode} from "../../../../features/group-application/academy-routing-server.ts";
import {academyMetadata} from "../../../../features/group-application/academy-metadata.ts";
import{notFound}from"next/navigation";
import{isLocale}from"../../../../lib/locale.ts";
import{publicGroupApplicationEnvironmentEnabled}from"../../../../features/group-application/candidate.ts";
import{AcademyIntakePage}from"../../../../features/group-application/academy-intake-page.tsx";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params,language=locale==="he"?"he":"en";const routeMode=await academyRouteMode();return academyMetadata(language,"/apply",language==="he"?"הרשמה לאקדמיה לדיג":"Register for the Fishing Academy",routeMode);}
export default async function Page({params}:{params:Promise<{locale:string}>}){const{locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <AcademyPublicRoute mode={await academyRouteMode()}><AcademyIntakePage locale={locale}/></AcademyPublicRoute>;}
