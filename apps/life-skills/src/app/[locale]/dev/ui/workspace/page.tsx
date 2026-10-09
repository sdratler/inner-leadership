import { notFound } from "next/navigation";
import { env } from "node:process";
import { SyntheticWorkspacePreview } from "@/ui/workspace/synthetic-workspace.tsx";
import "@/ui/workspace/workspace.css";
export const dynamic="force-dynamic";
export const metadata={title:"Life Skills — synthetic workspace review",robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{role?:string;page?:string;section?:string;scenario?:string;filter?:string;month?:string;layout?:string;date?:string;channel?:string;state?:string;from?:string;to?:string;publication?:string}>}){
 // Keep beneath the existing /dev/ui deny rule as well as this explicit runtime gate.
 if(env.NODE_ENV!=="development"||env.LS_APP_MODE!=="foundation_preview")notFound();
 const {locale}=await params,q=await searchParams;
 if(locale!=="en"&&locale!=="he")notFound();
 const role=q.role??"practitioner";if(role!=="practitioner"&&role!=="parent"&&role!=="adult"&&role!=="student")notFound();
 const marketingQuery=Object.fromEntries(["filter","month","layout","date","channel","state","from","to","publication"].map(key=>[key,q[key as keyof typeof q]]).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
 return <SyntheticWorkspacePreview key={`${locale}:${role}:${q.page??""}:${q.section??""}:${q.scenario??""}`} locale={locale} role={role} page={q.page??""} section={q.section} marketingScenario={q.scenario} marketingQuery={marketingQuery}/>;
}
