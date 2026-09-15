import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {SharedItemsWorkspace} from "@/features/shared-items/workspace.tsx";
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){const {locale}=await params;if(!isLocale(locale))notFound();const q=await searchParams;return <SharedItemsWorkspace locale={locale} role="parent" mode="both" initialCaseId={typeof q.caseId==="string"?q.caseId:undefined}/>}
