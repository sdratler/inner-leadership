import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {UpdatesWorkspace} from "@/features/updates/updates-workspace.tsx";
import {InboundInboxWorkspace} from "@/features/contact-ops/inbox-workspace.tsx";
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {locale}=await params;if(!isLocale(locale))notFound();const q=await searchParams;
 // Selected clinical case feedback is never replaced by a global business inbox.
 if(q.section==="whatsapp"&&q.context!=="client"&&!q.caseId)return <InboundInboxWorkspace locale={locale}/>;
 return <UpdatesWorkspace locale={locale} role="practitioner" initialCaseId={typeof q.caseId==="string"?q.caseId:undefined}/>;
}
