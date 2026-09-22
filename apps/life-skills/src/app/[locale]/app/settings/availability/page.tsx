import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locale.ts";
import { calendarPageSession } from "@/features/calendar/page-session.ts";
import { civilDate,shiftDay } from "@/features/calendar/time.ts";
import { AvailabilitySettings } from "@/features/calendar/availability-settings.tsx";
export const dynamic="force-dynamic";
export const revalidate=0;
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 // The parent layout also checks role. Keep the calendar service boundary explicit.
 try { await calendarPageSession("practitioner"); } catch { return <main><h1>{locale==="he"?"הזמינות אינה נגישה":"Availability unavailable"}</h1><p>{locale==="he"?"נדרשת הרשאת מטפל.":"An authorized practitioner account is required."}</p></main>; }
 const query=await searchParams;let date=civilDate(new Date().toISOString());
 try { if(typeof query.date==="string")date=shiftDay(query.date,0); } catch { notFound(); }
 return <AvailabilitySettings locale={locale} initialDate={date}/>;
}
