import {notFound,redirect} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {AppError} from "@/lib/errors.ts";
import {requireWorkspaceRole} from "@/features/integration/page-session.ts";
import {loginHref} from "@/features/identity/login-return.ts";
import {GroupApplicationReviewWorkspace} from "@/features/group-application/review-workspace.tsx";

export const dynamic="force-dynamic";
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){const {locale}=await params;if(!isLocale(locale))notFound();
 const raw=(await searchParams).inquiryId;const inquiryId=typeof raw==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)?raw:"";
 const returnTo=`/${locale}/app/group-applications${inquiryId?`?${new URLSearchParams({inquiryId})}`:""}`;
 try{await requireWorkspaceRole("practitioner");}catch(error){if(error instanceof AppError&&error.code==="UNAUTHENTICATED")redirect(loginHref(locale,returnTo));if(error instanceof AppError&&(error.code==="FORBIDDEN"||error.code==="NOT_FOUND"))notFound();throw error;}
 return <GroupApplicationReviewWorkspace locale={locale} initialSearch={inquiryId}/>;
}
