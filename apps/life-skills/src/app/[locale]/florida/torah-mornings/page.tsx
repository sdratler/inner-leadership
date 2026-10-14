import {notFound} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../../features/group-application/candidate.ts";
import {GroupApplicationLanding} from "../../../../features/group-application/landing.tsx";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const {locale}=await params;return {title:locale==="he"?"לימוד תורה בבוקר | כישורי חיים פלורידה":"Morning Torah Learning | Life Skills Florida",description:locale==="he"?"מסגרת בוקר של תורה, שיחה, תנועה והנהגה עצמית למשפחות חינוך ביתי.":"A Torah-morning rhythm of learning, conversation, movement and self-governance for homeschool families.",robots:{index:false,follow:false}};}
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <GroupApplicationLanding locale={locale} programId="morning_torah_learning"/>;}
