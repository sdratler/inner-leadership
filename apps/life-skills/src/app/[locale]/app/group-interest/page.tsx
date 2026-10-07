import {notFound} from "next/navigation";
import {isLocale} from "../../../../lib/locale.ts";
import {requireWorkspaceRole} from "../../../../features/integration/page-session.ts";
import {GroupInterestWorkspace} from "../../../../features/group-interest/workspace.tsx";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale)||process.env.LS_GROUP_INTEREST_CANDIDATE!=="true"||process.env.NODE_ENV==="production")notFound();
 await requireWorkspaceRole("practitioner");
 return <main lang={locale} dir={locale==="he"?"rtl":"ltr"}><GroupInterestWorkspace locale={locale}/></main>;
}
