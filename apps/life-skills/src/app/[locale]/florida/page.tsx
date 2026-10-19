import {AcademyPublicRoute} from "../../../features/group-application/academy-route-context.tsx";
import {academyRouteMode} from "../../../features/group-application/academy-routing-server.ts";
import {academyMetadata} from "../../../features/group-application/academy-metadata.ts";
import {notFound} from "next/navigation";
import {isLocale} from "../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../features/group-application/candidate.ts";
import {GroupApplicationLanding} from "../../../features/group-application/landing.tsx";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params,language=locale==="he"?"he":"en";const routeMode=await academyRouteMode();return academyMetadata(language,"",undefined,routeMode);}
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <AcademyPublicRoute mode={await academyRouteMode()}><GroupApplicationLanding locale={locale} programId="sunday_fishing_academy"/></AcademyPublicRoute>;}
