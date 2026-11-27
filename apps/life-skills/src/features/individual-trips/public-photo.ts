import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApprovedTripPhoto,TripLandingLocale } from './metadata.ts';
import { parseIdentityConfig } from '../identity/config.ts';
import { tripRuntimeConfig } from './config.ts';

type AdmittedPhoto=ApprovedTripPhoto&{sha256:string;sourceRecord:string};
// Source selects original1000281043.jpg. Its original bytes have not been
// materialized in this checkout. A generated flyer/collage is not a substitute.
// The asset owner must bind the exact original/hash/dimensions here on adoption.
const admittedPhoto:AdmittedPhoto|null=null;
export function currentTripPublicConfig(locale:TripLandingLocale,env:Record<string,string|undefined>=process.env):{publicUrl:string;photo:ApprovedTripPhoto}|null{
 if(env.LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED!=='true'||!admittedPhoto)return null;
 try{
  const runtime=tripRuntimeConfig(env,parseIdentityConfig(env));
  const photo=admittedPhoto as AdmittedPhoto;
  if(!/^\/trips\/[A-Za-z0-9_-]+\.jpg$/.test(photo.src)||!/^\w{64}$/.test(photo.sha256))return null;
  const bytes=readFileSync(join(process.cwd(),'public',photo.src.slice(1)));
  if(createHash('sha256').update(bytes).digest('hex')!==photo.sha256)return null;
  const origin=new URL(runtime.origin);
  return{publicUrl:new URL(`/${locale}/florida/trips`,origin).href,photo:{...photo,src:new URL(photo.src,origin).href}};
 }catch{return null;}
}
