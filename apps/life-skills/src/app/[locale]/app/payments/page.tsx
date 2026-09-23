import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {PaymentsWorkspace} from "@/features/payments/workspace.tsx";
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{caseId?:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();const query=await searchParams;return <PaymentsWorkspace locale={locale} embedded initialCaseId={query.caseId} languageHref={`/${locale==="he"?"en":"he"}/app/payments${query.caseId?`?caseId=${encodeURIComponent(query.caseId)}`:""}`}/>}
