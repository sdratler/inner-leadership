import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {AccountSettings} from "@/ui/workspace/account-settings.tsx";
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();return <AccountSettings locale={locale} role="practitioner" section="notifications"/>}
