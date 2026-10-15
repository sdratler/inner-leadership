import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {SharedItemsWorkspace} from "@/features/shared-items/workspace.tsx";
import {educationRehearsalEnabled} from "@/features/resources/education-runtime.ts";
import {educationQuery} from "@/features/resources/education-query.ts";
import {EducationWorkspace} from "@/features/resources/education-workspace.tsx";
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {locale}=await params;if(!isLocale(locale))notFound();const q=await searchParams,education=educationQuery({...q,section:q.section??"review"});
 if(education!==undefined){if(!education||!educationRehearsalEnabled()||!["review","publication"].includes(education.section))notFound();
  return <EducationWorkspace key={JSON.stringify(education.reference)} locale={locale} role="practitioner" reference={education.reference} section={education.section}/>;}
 return <SharedItemsWorkspace locale={locale} role="practitioner" mode="resources" initialCaseId={typeof q.caseId==="string"?q.caseId:undefined}/>;
}
