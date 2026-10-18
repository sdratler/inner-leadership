import {notFound} from "next/navigation";
import {isLocale} from "../../../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../../../features/group-application/candidate.ts";
import {AcademyStage} from "../../../../../features/group-application/academy-stage.tsx";
import {academyStages} from "../../../../../features/group-application/academy-public-program.ts";
import {JLFA_NAME} from "../../../../../features/group-application/jlfa-brand.tsx";
export const dynamic="force-dynamic";
type Params=Promise<{locale:string;stage:string}>;
export async function generateMetadata({params}:{params:Params}){const {locale,stage}=await params,item=academyStages.find(item=>item.slug===stage),language=locale==="he"?"he":"en";return {title:item?`${item.title[language]} | ${JLFA_NAME}`:JLFA_NAME,robots:{index:false,follow:false}};}
export default async function Page({params}:{params:Params}){const {locale,stage}=await params;if(!isLocale(locale)||!academyStages.some(item=>item.slug===stage)||!publicGroupApplicationEnvironmentEnabled())notFound();return <AcademyStage locale={locale} slug={stage}/>;}
