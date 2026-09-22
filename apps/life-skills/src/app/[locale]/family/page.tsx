import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {FamilyHomeWorkspace} from "@/ui/workspace/family-home.tsx";
export default async function FamilyHome({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const {locale}=await params;if(!isLocale(locale))notFound();const q=await searchParams;
 return <FamilyHomeWorkspace locale={locale} initialCaseId={typeof q.caseId==="string"?q.caseId:undefined}/>;
}
