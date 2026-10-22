import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {SharedItemsWorkspace} from "@/features/shared-items/workspace.tsx";
import {educationRehearsalEnabled} from "@/features/resources/education-runtime.ts";
import {educationQuery} from "@/features/resources/education-query.ts";
import {EducationWorkspace} from "@/features/resources/education-workspace.tsx";
import {FishingClassroomEntry} from "@/features/fishing-stage/classroom-entry-workspace.tsx";
import {classroomEntryRequestFromQuery} from "@/features/fishing-stage/classroom-entry-contract.ts";
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {locale}=await params;if(!isLocale(locale))notFound();const q=await searchParams,education=educationQuery(q);
 if(education!==undefined){if(!education||!educationRehearsalEnabled()||!["lesson","portfolio"].includes(education.section))notFound();
  return <EducationWorkspace key={JSON.stringify(education.reference)} locale={locale} role="parent" reference={education.reference} section={education.section}/>;}
 const classroom=educationRehearsalEnabled(),request=classroom?classroomEntryRequestFromQuery(q):null;if(classroom&&!request)notFound();
 return <><SharedItemsWorkspace locale={locale} role="parent" mode="resources" initialCaseId={typeof q.caseId==="string"?q.caseId:undefined}/>
  {classroom&&request&&<FishingClassroomEntry locale={locale} initialRequest={request}/>}</>;
}
