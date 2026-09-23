import {notFound} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {requireWorkspaceRole} from "../../../../features/integration/page-session.ts";
import {MarketingDashboard} from "../../../../ui/revamp/marketing-dashboard.tsx";
import {loadMarketingSnapshot} from "../../../../features/marketing-overview/provider.ts";
export const dynamic="force-dynamic";
export const metadata={title:"Life Skills — Marketing",robots:{index:false,follow:false}};
/** No unverified connections or fabricated live data. Codex binds a separately owner-authorized read model here. */
export default async function Page({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 try{await requireWorkspaceRole("practitioner");}catch{notFound();}
 const snapshot=await loadMarketingSnapshot();
 return <MarketingDashboard locale={locale} snapshot={snapshot}/>;
}
