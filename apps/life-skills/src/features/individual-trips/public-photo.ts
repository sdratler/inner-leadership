import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tripLandingUrls,type ApprovedTripPhoto,type TripLandingLocale } from './metadata.ts';

// Publication export admitted for the current-trip page by the direct owner
// direction of 27 November. Private original bindings and the mechanical-export
// receipt remain outside public Git. Only this exact stripped export is public.
export const TRIP_PUBLIC_PHOTO=Object.freeze({
 src:'/trips/fishing-academy-bass-20261122.jpg',width:1600,height:1200,
 alt:'Rabbi Shlomo and children beside the lake with a bass at the Fishing Academy seminar in Boca Raton.',
 sha256:'c77ff6bb91b268e1ca60b8da1f93575e7274d84a7355dd985a0067a8707ea61e',
});
export function currentTripPublicConfig(locale:TripLandingLocale,env:Record<string,string|undefined>=process.env):{publicUrl:string;photo:ApprovedTripPhoto}|null{
 if(env.LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED!=='true'||!['en','he'].includes(locale))return null;
 try{
  const rawOrigin=env.LS_APP_ORIGIN;
  if(typeof rawOrigin!=='string'||/[\s\\?#%]/.test(rawOrigin))return null;
  const origin=new URL(rawOrigin);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)return null;
  const photo=TRIP_PUBLIC_PHOTO;
  if(!/^\/trips\/[A-Za-z0-9_-]+\.jpg$/.test(photo.src)||!/^[a-f0-9]{64}$/.test(photo.sha256))return null;
  const bytes=readFileSync(join(process.cwd(),'public',photo.src.slice(1)));
  if(createHash('sha256').update(bytes).digest('hex')!==photo.sha256)return null;
  const result={publicUrl:new URL(`/${locale}/florida/trips`,origin).href,photo:{src:new URL(photo.src,origin).href,width:photo.width,height:photo.height,alt:locale==='he'?'הרב שלמה וילדים ליד האגם עם דג בס בסמינר האקדמיה לדיג בבוקה רטון.':photo.alt}};
  tripLandingUrls({locale,...result});
  return result;
 }catch{return null;}
}
