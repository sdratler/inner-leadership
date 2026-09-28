import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {SessionListWorkspace} from "@/features/session-workflow/workspace.tsx";
export const dynamic="force-dynamic";
export default async function Page({params,searchParams}:{params:Promise<{locale:string;caseId:string}>;searchParams?:Promise<Record<string,string|string[]|undefined>>}){
 const {locale,caseId}=await params,query=await searchParams??{},appointmentId=query.appointmentId;
 if(!isLocale(locale)||!/^[0-9a-f-]{36}$/i.test(caseId))notFound();
 if(appointmentId!==undefined&&(typeof appointmentId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId)))notFound();
 return <SessionListWorkspace key={`${caseId}:${appointmentId??'all'}`} locale={locale} caseId={caseId} {...(appointmentId?{selectedAppointmentId:appointmentId}:{})}/>;
}
