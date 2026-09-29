import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {SessionListWorkspace} from "@/features/session-workflow/workspace.tsx";
import {isCaseId,workspaceContext} from '../../../../../../ui/workspace/navigation-model.ts';
export const dynamic="force-dynamic";
export default async function Page({params,searchParams}:{params:Promise<{locale:string;caseId:string}>;searchParams?:Promise<Record<string,string|string[]|undefined>>}){
 const {locale,caseId}=await params,query=await searchParams??{},appointmentId=query.appointmentId;
 if(!isLocale(locale)||!isCaseId(caseId))notFound();
 if(query.caseId!==undefined&&(!isCaseId(query.caseId)||query.caseId.toLowerCase()!==caseId.toLowerCase()))notFound();
 if(appointmentId!==undefined&&(typeof appointmentId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId)))notFound();
 let navigationContext;try{navigationContext=workspaceContext(query,true);}catch{notFound();}
 return <SessionListWorkspace key={`${caseId.toLowerCase()}:${appointmentId?.toLowerCase()??'all'}`} locale={locale} caseId={caseId.toLowerCase()} navigationContext={navigationContext} {...(appointmentId?{selectedAppointmentId:appointmentId.toLowerCase()}:{})}/>;
}
