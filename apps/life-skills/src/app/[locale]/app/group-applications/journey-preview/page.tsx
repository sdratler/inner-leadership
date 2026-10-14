import {notFound,redirect} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {AppError} from "@/lib/errors.ts";
import {requireWorkspaceRole} from "@/features/integration/page-session.ts";
import {loginHref} from "@/features/identity/login-return.ts";
import {floridaProgramIdSchema} from "@/features/group-application/contract.ts";
import {journeyPreviewEnabled} from "@/features/group-application/journey-preview-model.ts";
import {FloridaJourneyPreview} from "@/features/group-application/journey-preview.tsx";
export const dynamic="force-dynamic";
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{program?:string}>}){
 const {locale}=await params;if(!isLocale(locale)||!journeyPreviewEnabled(process.env))notFound();
 const query=await searchParams,program=floridaProgramIdSchema.safeParse(query.program??"sunday_fishing_academy");if(!program.success)notFound();
 try{await requireWorkspaceRole("practitioner");}catch(error){if(error instanceof AppError&&error.code==="UNAUTHENTICATED")redirect(loginHref(locale,`/${locale}/app/group-applications/journey-preview?program=${program.data}`));if(error instanceof AppError&&(error.code==="FORBIDDEN"||error.code==="NOT_FOUND"))notFound();throw error;}
 return <FloridaJourneyPreview key={`${locale}-${program.data}`} locale={locale} programId={program.data}/>;
}
