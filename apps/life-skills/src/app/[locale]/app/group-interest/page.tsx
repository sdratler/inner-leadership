import {notFound,redirect} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {AppError} from "../../../../lib/errors.ts";
import {requireWorkspaceRole} from "../../../../features/integration/page-session.ts";
import {loginHref} from "../../../../features/identity/login-return.ts";
import {GroupInterestWorkspace} from "../../../../features/group-interest/workspace.tsx";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale)||process.env.LS_GROUP_INTEREST_CANDIDATE!=="true"||process.env.NODE_ENV==="production")notFound();
 try{await requireWorkspaceRole("practitioner");}
 catch(error){
  if(error instanceof AppError&&error.code==="UNAUTHENTICATED")redirect(loginHref(locale,`/${locale}/app/group-interest`));
  if(error instanceof AppError&&(error.code==="FORBIDDEN"||error.code==="NOT_FOUND"))notFound();
  throw error;
 }
 return <main lang={locale} dir={locale==="he"?"rtl":"ltr"}><GroupInterestWorkspace locale={locale}/></main>;
}
