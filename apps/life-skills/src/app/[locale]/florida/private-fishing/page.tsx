import {notFound} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../../features/group-application/candidate.ts";
import {GroupApplicationLanding} from "../../../../features/group-application/landing.tsx";
import copy from "../../../../features/group-application/presentation-copy.json";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params,language=locale==="he"?"he":"en";return {title:copy.metadata.vipTitle[language],description:copy.metadata.vipDescription[language],robots:{index:false,follow:false}};}
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <GroupApplicationLanding locale={locale} programId="private_fishing_life_skills"/>;}
