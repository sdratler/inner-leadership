import { notFound } from 'next/navigation';
import { CalendarWorkspace } from '../../../../features/calendar/workspace.tsx';
import { calendarPageSession } from '../../../../features/calendar/page-session.ts';
import { civilDate, shiftDay } from '../../../../features/calendar/time.ts';
import { isLocale } from '../../../../lib/locale.ts';
import { text } from '../../../../features/calendar/copy.ts';
import '../../../../ui/workspace/workspace.css';
export const dynamic='force-dynamic';
export const revalidate=0;
export const metadata={robots:{index:false,follow:false}};
type Props={params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export default async function Page({params,searchParams}:Props){
 const {locale}=await params;if(!isLocale(locale))notFound();
 try{await calendarPageSession('practitioner');}catch{return <main lang={locale} dir={locale==='he'?'rtl':'ltr'} className="ls-cal"><h1>{text(locale).title}</h1><p role="status">{text(locale).unavailable}</p><a href={`/${locale}/`}>{text(locale).today}</a></main>;}
 const query=await searchParams;let date=civilDate(new Date().toISOString());
 try{if(typeof query.date==='string')date=shiftDay(query.date,0);}catch{notFound();}
 const view=query.view==='day'||query.view==='month'?query.view:'week';
 const caseId=typeof query.caseId==='string'&&/^[0-9a-f-]{36}$/i.test(query.caseId)?query.caseId:'';
 return <CalendarWorkspace locale={locale} role="practitioner" initialDate={date} initialView={view} initialCaseId={caseId}/>;
}
