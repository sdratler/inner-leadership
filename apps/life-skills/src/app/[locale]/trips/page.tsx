import { notFound } from 'next/navigation';
import { isLocale } from '../../../lib/locale.ts';
import { individualTripsRuntime } from '../../../features/individual-trips/runtime.ts';
import { IndividualTripsWorkspace } from '../../../features/individual-trips/workspace.tsx';
export const dynamic='force-dynamic';
export const metadata={title:'Fishing Academy — your family',robots:{index:false,follow:false,nocache:true}};
export default async function Page({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 try{await individualTripsRuntime();}catch{notFound();}
 return <IndividualTripsWorkspace locale={locale} mode="parent"/>;
}
