import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {PaymentsWorkspace} from "@/features/payments/workspace.tsx";
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{caseId?:string;section?:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();const query=await searchParams;const languageQuery=new URLSearchParams({...query.caseId?{caseId:query.caseId}:{},...query.section?{section:query.section}:{}});return <PaymentsWorkspace locale={locale} embedded initialCaseId={query.caseId} initialSection={query.section} languageHref={`/${locale==="he"?"en":"he"}/app/payments${languageQuery.size?`?${languageQuery}`:""}`}/>}
