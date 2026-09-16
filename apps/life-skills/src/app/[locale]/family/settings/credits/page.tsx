import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {PaymentsWorkspace} from "@/features/payments/workspace.tsx";
import {Breadcrumb} from "@/ui/workspace/surfaces.tsx";
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();const other=locale==="he"?"en":"he";return <section className="lsw-stack"><Breadcrumb label={locale==="he"?"מיקום":"Location"} items={[{label:locale==="he"?"הגדרות":"Settings",href:`/${locale}/family/settings`},{label:locale==="he"?"יתרת פגישות":"Appointment credits"}]}/><PaymentsWorkspace locale={locale} embedded languageHref={`/${other}/family/settings/credits`}/></section>}
