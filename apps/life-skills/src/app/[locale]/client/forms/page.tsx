import {notFound,redirect} from 'next/navigation';
import {isLocale} from '@/lib/locale.ts';
import {AppError} from '@/lib/errors.ts';
import {requireWorkspaceRoles} from '@/features/integration/page-session.ts';
import {clientReturnPath,loginHref} from '@/features/identity/login-return.ts';
import {SharedItemsWorkspace} from '@/features/shared-items/workspace.tsx';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {locale}=await params;if(!isLocale(locale))notFound();const query=await searchParams,caseId=typeof query.caseId==='string'?query.caseId:undefined;
 try{await requireWorkspaceRoles(['adult_client'])}catch(error){if(error instanceof AppError&&error.code==='UNAUTHENTICATED')redirect(loginHref(locale,clientReturnPath(locale,`/${locale}/client/forms`,{caseId})));if(error instanceof AppError&&(error.code==='FORBIDDEN'||error.code==='NOT_FOUND'))notFound();throw error}
 return <SharedItemsWorkspace locale={locale} role='adult_client' mode='forms' initialCaseId={caseId}/>;
}
