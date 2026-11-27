import { cookies } from 'next/headers';
import { notFound,redirect } from 'next/navigation';
import { isLocale } from '../../../../lib/locale.ts';
import { SESSION_COOKIE } from '../../../../lib/security/session.ts';
import { individualTripsRuntime } from '../../../../features/individual-trips/runtime.ts';
import { IndividualTripsWorkspace } from '../../../../features/individual-trips/workspace.tsx';
export const dynamic='force-dynamic';
export const metadata={title:'Fishing Academy — trip workspace',robots:{index:false,follow:false,nocache:true}};
export default async function Page({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 const runtime=await individualTripsRuntime().catch(()=>null);if(!runtime)notFound();
 const token=(await cookies()).get(SESSION_COOKIE)?.value;
 if(!token)redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/trips/owner`)}`);
 const actor=await runtime.identity.services.sessions.actor(token).catch(()=>null);
 if(!actor)redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/trips/owner`)}`);
 if(actor.id!==runtime.config.ownerAccountId||actor.role!=='practitioner')notFound();
 try{await runtime.trips.read(actor);}catch{notFound();}
 return <IndividualTripsWorkspace locale={locale} mode="owner"/>;
}
