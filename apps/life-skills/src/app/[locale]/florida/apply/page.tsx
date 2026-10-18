import{notFound}from"next/navigation";
import{isLocale}from"../../../../lib/locale.ts";
import{publicGroupApplicationEnvironmentEnabled}from"../../../../features/group-application/candidate.ts";
import{AcademyIntakePage}from"../../../../features/group-application/academy-intake-page.tsx";
import{JLFA_NAME}from"../../../../features/group-application/jlfa-brand.tsx";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){const{locale}=await params;return{title:`${locale==="he"?"פנייה":"Apply"} — ${JLFA_NAME}`,robots:{index:false,follow:false}};}
export default async function Page({params}:{params:Promise<{locale:string}>}){const{locale}=await params;if(!isLocale(locale)||!publicGroupApplicationEnvironmentEnabled())notFound();return <AcademyIntakePage locale={locale}/>;}
