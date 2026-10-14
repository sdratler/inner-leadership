import {notFound,redirect} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {requireWorkspaceRoles} from "@/features/integration/page-session.ts";
import {SyntheticWorkspacePreview} from "@/ui/workspace/synthetic-workspace.tsx";
import {AppError} from "@/lib/errors.ts";
import {loginHref} from "@/features/identity/login-return.ts";
import {floridaProgramIdSchema} from "@/features/group-application/contract.ts";
import {FloridaJourneyPreview} from "@/features/group-application/journey-preview.tsx";
import {GroupApplicationLanding} from "@/features/group-application/landing.tsx";
import "@/ui/workspace/workspace.css";
import "@/ui/workspace/w4-v2.css";

export const dynamic="force-dynamic";
export const metadata={title:"Life Skills — sample data",robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{page?:string;section?:string;program?:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 const query=await searchParams;
 if(query.page==="florida-journeys"||query.page==="florida-landing"){
  const program=floridaProgramIdSchema.safeParse(query.program??"sunday_fishing_academy");if(!program.success)notFound();
  try{await requireWorkspaceRoles(["practitioner"]);}catch(error){if(error instanceof AppError&&error.code==="UNAUTHENTICATED")redirect(loginHref(locale,`/${locale}/sample?page=${query.page}&program=${program.data}`));if(error instanceof AppError&&(error.code==="FORBIDDEN"||error.code==="NOT_FOUND"))notFound();throw error;}
  return query.page==="florida-landing"?<GroupApplicationLanding key={`${locale}-${program.data}`} locale={locale} programId={program.data} mode="sample"/>:<FloridaJourneyPreview key={`${locale}-${program.data}`} locale={locale} programId={program.data} mode="sample"/>;
 }
 let role:"practitioner"|"parent";
 try{const actor=await requireWorkspaceRoles(["practitioner","parent"]);role=actor.role as typeof role;}catch{redirect(`/${locale}/login`)}
 return <SyntheticWorkspacePreview locale={locale} role={role} page={query.page??""} section={query.section} mode="sample"/>;
}
