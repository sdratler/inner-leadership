import {notFound,redirect} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {requireWorkspaceRoles} from "@/features/integration/page-session.ts";
import {SyntheticWorkspacePreview} from "@/ui/workspace/synthetic-workspace.tsx";
import "@/ui/workspace/workspace.css";
import "@/ui/workspace/w4-v2.css";

export const dynamic="force-dynamic";
export const metadata={title:"Life Skills — sample data",robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{page?:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 let role:"practitioner"|"parent";
 try{const actor=await requireWorkspaceRoles(["practitioner","parent"]);role=actor.role as typeof role;}catch{redirect(`/${locale}/login`)}
 const query=await searchParams;
 return <SyntheticWorkspacePreview locale={locale} role={role} page={query.page??""} mode="sample"/>;
}
