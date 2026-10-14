import {notFound} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {publicGroupApplicationEnvironmentEnabled} from "../../../../features/group-application/candidate.ts";
import {IsraelGroupApplicationLanding} from "../../../../features/group-application/legacy-landing.tsx";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();
 return <IsraelGroupApplicationLanding locale={locale}/>;
}
