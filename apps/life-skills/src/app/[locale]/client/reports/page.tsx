import {notFound,redirect} from 'next/navigation';
import {isLocale} from '../../../../lib/locale.ts';
import {AppError} from '../../../../lib/errors.ts';
import {requireWorkspaceRoles} from '../../../../features/integration/page-session.ts';
import {clientReturnPath,loginHref} from '../../../../features/identity/login-return.ts';
import {ReportsPage} from '../../../../features/progress/reports-page.tsx';
import {ClientAccessDenied} from '../not-found.tsx';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 const query=await searchParams,caseId=typeof query.caseId==='string'?query.caseId:undefined,audienceId=typeof query.audienceId==='string'?query.audienceId:undefined;
 try{await requireWorkspaceRoles(['adult_client']);}catch(error){
  if(error instanceof AppError&&error.code==='UNAUTHENTICATED')redirect(loginHref(locale,clientReturnPath(locale,`/${locale}/client/reports`,{caseId,audienceId})));
  if(error instanceof AppError&&(error.code==='FORBIDDEN'||error.code==='NOT_FOUND'))return <ClientAccessDenied locale={locale}/>;
  throw error;
 }
 return <ReportsPage locale={locale} role='adult_client' caseId={caseId} audienceId={audienceId}/>;
}
