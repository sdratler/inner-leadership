import {notFound} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
import {ProspectsClient} from "@/features/prospects/client.tsx";
export const dynamic="force-dynamic";export const metadata={robots:{index:false,follow:false}};
const filters=new Set(["all","today","new","intake","payment","booking","archived"] as const);
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{filter?:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();const requested=(await searchParams).filter,initialFilter=requested&&filters.has(requested as never)?requested as "all"|"today"|"new"|"intake"|"payment"|"booking"|"archived":"all";return <ProspectsClient locale={locale} initialFilter={initialFilter}/>}
