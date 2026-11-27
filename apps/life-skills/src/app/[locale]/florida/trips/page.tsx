import { notFound } from 'next/navigation';
import { isLocale } from '../../../../lib/locale.ts';
import { IndividualTripLanding } from '../../../../features/individual-trips/landing.tsx';
import { individualTripLandingMetadata } from '../../../../features/individual-trips/metadata.ts';
import { currentTripPublicConfig } from '../../../../features/individual-trips/public-photo.ts';
import { individualTripsRuntime } from '../../../../features/individual-trips/runtime.ts';
import { cache } from 'react';
export const dynamic='force-dynamic';
const signupAvailable=cache(async()=>{
 try{return (await individualTripsRuntime()).providerAvailability.registration==='configured';}
 catch{return false;}
});
export async function generateMetadata({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();const config=currentTripPublicConfig(locale);if(!config)notFound();
 return individualTripLandingMetadata({locale,...config,signupOpen:await signupAvailable()});
}
export default async function Page({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();const config=currentTripPublicConfig(locale);if(!config)notFound();
 return <IndividualTripLanding locale={locale} {...config} signupOpen={await signupAvailable()}/>;
}
