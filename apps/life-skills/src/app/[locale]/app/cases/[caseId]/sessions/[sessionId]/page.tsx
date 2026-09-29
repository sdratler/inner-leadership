import {notFound} from 'next/navigation';
import {isLocale} from '@/lib/locale.ts';
import {SessionDetailWorkspace} from '@/features/session-workflow/workspace.tsx';
import {isCaseId,workspaceContext} from '../../../../../../../ui/workspace/navigation-model.ts';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{locale:string;caseId:string;sessionId:string}>;searchParams?:Promise<Record<string,string|string[]|undefined>>}){
 const {locale,caseId,sessionId}=await params,query=await searchParams??{};
 if(!isLocale(locale)||!isCaseId(caseId)||!isCaseId(sessionId))notFound();
 if(query.caseId!==undefined&&(!isCaseId(query.caseId)||query.caseId.toLowerCase()!==caseId.toLowerCase()))notFound();
 let navigationContext;try{navigationContext=workspaceContext(query,true);}catch{notFound();}
 return <SessionDetailWorkspace key={`${caseId}:${sessionId}`} locale={locale} caseId={caseId.toLowerCase()} sessionId={sessionId.toLowerCase()} navigationContext={navigationContext}/>;
}
