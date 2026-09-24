import {notFound,redirect} from "next/navigation";
import {isLocale} from "@/lib/locale.ts";
export const dynamic="force-dynamic";export const metadata={robots:{index:false,follow:false}};
const filters=new Set(["all","today","new","intake","payment","booking","archived"] as const);
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{filter?:string}>}){const {locale}=await params;if(!isLocale(locale))notFound();const requested=(await searchParams).filter,filter=requested&&filters.has(requested as never)?requested:"all";redirect(`/${locale}/app/clients?section=${filter==="booking"?"paid":filter==="archived"?"archived":"prospects"}${filter!=="all"&&filter!=="booking"&&filter!=="archived"?`&filter=${encodeURIComponent(filter)}`:""}`)}
