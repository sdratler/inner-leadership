import { notFound } from 'next/navigation';
import { IndividualTripsWorkspace } from '../../../../../features/individual-trips/workspace.tsx';
import { isLocale } from '../../../../../lib/locale.ts';
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{mode?:string}>}){
 const {locale}=await params;if(process.env.NODE_ENV!=='development'||!isLocale(locale))notFound();
 const query=await searchParams;return <IndividualTripsWorkspace locale={locale} mode={query.mode==='owner'?'owner':'parent'}/>;
}
