import {notFound} from "next/navigation";
import {isLocale} from "../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../features/group-application/candidate.ts";
import {GroupApplicationLanding} from "../../../features/group-application/landing.tsx";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params;return {title:locale==="he"?"אקדמיית הדיג בפלורידה | כישורי חיים":"Florida Fishing Academy | Life Skills",description:locale==="he"?"בירור על אקדמיית הדיג בפלורידה. הפנייה אינה הרשמה, הזמנה או בקשת תשלום.":"Ask about Florida Fishing Academy. An inquiry does not enroll, book or request payment.",robots:{index:false,follow:false}};}
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <GroupApplicationLanding locale={locale} programId="sunday_fishing_academy"/>;}
