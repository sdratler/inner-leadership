import { notFound } from "next/navigation";
import { env } from "node:process";
import { SyntheticWorkspacePreview } from "@/ui/workspace/synthetic-workspace.tsx";
import "@/ui/workspace/workspace.css";
export const dynamic="force-dynamic";
export const metadata={title:"Life Skills — synthetic workspace review",robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{role?:string;page?:string;section?:string}>}){
 // Keep beneath the existing /dev/ui deny rule as well as this explicit runtime gate.
 if(env.NODE_ENV!=="development"||env.LS_APP_MODE!=="foundation_preview")notFound();
 const {locale}=await params,q=await searchParams;
 if(locale!=="en"&&locale!=="he")notFound();
 const role=q.role??"practitioner";if(role!=="practitioner"&&role!=="parent"&&role!=="adult"&&role!=="student")notFound();
 return <SyntheticWorkspacePreview key={`${locale}:${role}:${q.page??""}:${q.section??""}`} locale={locale} role={role} page={q.page??""} section={q.section}/>;
}
