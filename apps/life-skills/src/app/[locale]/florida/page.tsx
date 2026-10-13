import {notFound} from "next/navigation";
import {isLocale} from "../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../features/group-application/candidate.ts";
import {GroupApplicationLanding} from "../../../features/group-application/landing.tsx";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params;return {title:locale==="he"?"מסלול הדיג והקיז | כישורי חיים פלורידה":"Florida Fishing & Keys Course | Life Skills",description:locale==="he"?"שלושה שיעורי דיג וכישורי חיים לקראת פעילות סיום כלולה בקיז, בכפוף למוכנות.":"Three fishing and life-skills lessons leading to an included Keys culmination, subject to readiness.",robots:{index:false,follow:false}};}
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <GroupApplicationLanding locale={locale} programId="sunday_fishing_academy"/>;}
