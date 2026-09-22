import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {isCaseId} from "@/ui/workspace/navigation-model.ts";
import {CaseWorkspace} from "@/features/cases/case-workspace.tsx";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{locale:string;caseId:string}>}){
 const {locale,caseId}=await params;if(!isLocale(locale)||!isCaseId(caseId))notFound();
 return <CaseWorkspace locale={locale} caseId={caseId} section="settings"/>;
}
