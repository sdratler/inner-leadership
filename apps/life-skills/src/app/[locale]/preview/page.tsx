import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IsolatedPreviewGallery } from "@/ui/workspace/gallery.tsx";
import "@/ui/workspace/workspace.css";

export const dynamic="force-dynamic";
export async function generateMetadata():Promise<Metadata>{
 if(process.env.LS_APP_MODE!=="isolated_preview")notFound();
 return {title:"Life Skills private synthetic preview",robots:{index:false,follow:false}};
}
export default async function IsolatedPreviewPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{role?:string}>}) {
 if(process.env.LS_APP_MODE!=="isolated_preview")notFound();
 const {locale}=await params;const {role="parent"}=await searchParams;
 if((locale!=="he"&&locale!=="en")||(role!=="parent"&&role!=="practitioner"))notFound();
 return <IsolatedPreviewGallery locale={locale} role={role}/>;
}
