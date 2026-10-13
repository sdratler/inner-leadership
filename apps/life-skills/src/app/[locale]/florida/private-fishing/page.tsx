import {notFound} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../../features/group-application/candidate.ts";
import {GroupApplicationLanding} from "../../../../features/group-application/landing.tsx";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params;return {title:locale==="he"?"דיג וכישורי חיים באופן פרטי | כישורי חיים פלורידה":"Private Fishing & Life Skills | Life Skills Florida",description:locale==="he"?"ליווי והדרכה מותאמים דרך תרגול דיג וכישורי חיים מעשיים.":"Tailored mentoring and coaching through fishing practice and practical life skills.",robots:{index:false,follow:false}};}
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <GroupApplicationLanding locale={locale} programId="private_fishing_life_skills"/>;}
