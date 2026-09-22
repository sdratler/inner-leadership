import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {SettingsIndex} from "@/ui/workspace/settings-index.tsx";
export default async function Page({params}:{params:Promise<{locale:string}>}) {
 const {locale}=await params;if(!isLocale(locale))notFound();return <SettingsIndex locale={locale} role="parent"/>;
}
