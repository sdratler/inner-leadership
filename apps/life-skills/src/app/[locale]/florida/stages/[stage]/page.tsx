import {AcademyPublicRoute} from "../../../../../features/group-application/academy-route-context.tsx";
import {academyRouteMode} from "../../../../../features/group-application/academy-routing-server.ts";
import {academyMetadata} from "../../../../../features/group-application/academy-metadata.ts";
import {notFound} from "next/navigation";
import {isLocale} from "../../../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../../../features/group-application/candidate.ts";
import {AcademyStage} from "../../../../../features/group-application/academy-stage.tsx";
import {academyStages} from "../../../../../features/group-application/academy-public-program.ts";
export const dynamic="force-dynamic";
type Params=Promise<{locale:string;stage:string}>;
export async function generateMetadata({params}:{params:Params}){const {locale,stage}=await params,language=locale==="he"?"he":"en",item=academyStages.find(item=>item.slug===stage);const routeMode=await academyRouteMode();return academyMetadata(language,`/stages/${stage}`,item?.title[language],routeMode);}
export default async function Page({params}:{params:Params}){const {locale,stage}=await params;if(!isLocale(locale)||!academyStages.some(item=>item.slug===stage)||!publicGroupApplicationEnvironmentEnabled())notFound();return <AcademyPublicRoute mode={await academyRouteMode()}><AcademyStage locale={locale} slug={stage}/></AcademyPublicRoute>;}
