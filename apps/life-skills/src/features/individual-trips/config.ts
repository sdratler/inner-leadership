import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import type { IdentityConfig } from '../identity/config.ts';
import { TRIP_VERSION,TRIP_TIME_ZONE } from './contract.ts';

export const INDIVIDUAL_TRIP_VERSION=TRIP_VERSION;
export { TRIP_TIME_ZONE };
export interface TripRuntimeConfig {workspaceId:string;ownerAccountId:string;origin:string;}
export function tripRuntimeConfig(env:Record<string,string|undefined>,identity:IdentityConfig):TripRuntimeConfig {
 if(env.LS_INDIVIDUAL_TRIPS_ENABLED!=='true'||!identity.enabled)throw new AppError('UNAVAILABLE');
 const input=z.strictObject({workspaceId:z.uuid(),ownerAccountId:z.uuid()}).safeParse({workspaceId:env.LS_INDIVIDUAL_TRIPS_WORKSPACE_ID,ownerAccountId:env.LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID});
 if(!input.success||input.data.workspaceId!==identity.workspaceId)throw new AppError('UNAVAILABLE');
 return{...input.data,origin:identity.origin};
}
export const TRIP_HUB_PREFERENCES=Object.freeze([
 {id:'nmb',label:'North Miami Beach',candidate:'Young Israel of Greater Miami, 990 NE 171 Street'},
 {id:'boca',label:'Boca Raton',candidate:'Boca Raton Synagogue, 7900 Montoya Circle N'},
 {id:'miami_beach',label:'Miami Beach',candidate:'Beth Israel Congregation, 770 W 40th Street'},
 {id:'hollywood',label:'Hollywood',candidate:'Meeting point to be arranged'},
]);
export const MEDIA_NO_POLICY='No smartphones, tablets or devices capable of playing or streaming videos, including filtered or offline devices, during group activities and travel. Non-video gaming devices require the instructor’s permission.';
export function upcomingSundayDates(now=new Date(),count=8):string[]{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TRIP_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(name:string)=>parts.find(p=>p.type===name)!.value;
 const date=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
 date.setUTCDate(date.getUTCDate()+((7-date.getUTCDay())%7));
 return Array.from({length:count},(_,i)=>new Date(date.getTime()+i*7*86400000).toISOString().slice(0,10));
}
