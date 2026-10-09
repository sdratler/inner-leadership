import {notFound,redirect} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {AppError} from "@/lib/errors.ts";
import {requireWorkspaceRole} from "@/features/integration/page-session.ts";
import {loginHref} from "@/features/identity/login-return.ts";
import {GroupApplicationReviewWorkspace} from "@/features/group-application/review-workspace.tsx";

export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();
 try{await requireWorkspaceRole("practitioner");}catch(error){if(error instanceof AppError&&error.code==="UNAUTHENTICATED")redirect(loginHref(locale,`/${locale}/app/group-applications`));if(error instanceof AppError&&(error.code==="FORBIDDEN"||error.code==="NOT_FOUND"))notFound();throw error;}
 return <GroupApplicationReviewWorkspace locale={locale}/>;
}
