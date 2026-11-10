import type {Locale} from '../../lib/locale.ts';
import {accountAction,type IdentityClientErrorCode} from '../identity/client.ts';

/** Actual own-account /api/identity/contacts data, not a family/guardian profile. */
export type FishingOwnerAccountContacts={readonly email:string;readonly emailVerified:boolean;readonly phone:string|null;readonly phoneVerified:boolean};
export type FishingOwnerContactsState={readonly state:'available';readonly value:FishingOwnerAccountContacts}|
 {readonly state:'unavailable';readonly reason:IdentityClientErrorCode};
/** Root supplies actual guarded owner selection and same-actor contacts readback.
 * This DTO is presentation only and does not authorize any route or API. */
export type FishingOwnerSettingsInput={readonly mode:'fishing_owner';readonly locale:Locale;readonly contacts:FishingOwnerContactsState}|
 {readonly mode:'unavailable';readonly locale:Locale};
export type FishingOwnerSettingsModel={readonly locale:Locale;readonly contacts:FishingOwnerContactsState;readonly contextKey:string};
const codes:readonly IdentityClientErrorCode[]=['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','CONFLICT','RATE_LIMITED','UNAVAILABLE','INTERNAL'];
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function own(value:unknown,key:string):unknown{return record(value)&&Object.hasOwn(value,key)?value[key]:undefined;}
function contactsValue(value:unknown):FishingOwnerAccountContacts|null{
 if(!record(value)||Object.keys(value).length!==4||!['email','emailVerified','phone','phoneVerified'].every(key=>Object.hasOwn(value,key)))return null;
 const {email,emailVerified,phone,phoneVerified}=value;
 if(typeof email!=='string'||email.length===0||email.length>254||email!==email.trim()||/[\x00-\x1f\x7f]/.test(email)||
  typeof emailVerified!=='boolean'||typeof phoneVerified!=='boolean'||
  (phone!==null&&(typeof phone!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(phone)))||phone===null&&phoneVerified)return null;
 return {email,emailVerified,phone,phoneVerified};
}
export function fishingOwnerSettings(input:FishingOwnerSettingsInput):FishingOwnerSettingsModel|null{
 const raw:unknown=input,locale=own(raw,'locale');
 if(own(raw,'mode')!=='fishing_owner'||locale!=='en'&&locale!=='he')return null;
 const supplied=own(raw,'contacts'),value=own(supplied,'state')==='available'?contactsValue(own(supplied,'value')):null;
 const suppliedReason=own(supplied,'reason');
 const contacts:FishingOwnerContactsState=value?{state:'available',value}:{state:'unavailable',reason:
  own(supplied,'state')==='unavailable'&&codes.includes(suppliedReason as IdentityClientErrorCode)?suppliedReason as IdentityClientErrorCode:'UNAVAILABLE'};
 // Internal React lifetime key only, never a scope/authorization assertion or DOM attribute.
 return {locale,contacts,contextKey:JSON.stringify([locale,contacts])};
}

export const FISHING_OWNER_SIGN_OUT_TIMEOUT_MS=15_000;
export type FishingOwnerSignOutState='ready'|'busy'|'signed_out'|'unconfirmed';
export type FishingOwnerSignOutController={start:()=>Promise<void>;dispose:()=>void;getState:()=>FishingOwnerSignOutState};
/** Reuses the existing session/CSRF/logout bridge. A timeout never retries or
 * claims success; the original request may still complete and needs a fresh read. */
export function createFishingOwnerSignOut(callbacks:{onState:(state:FishingOwnerSignOutState)=>void;onSignedOut:()=>void}):FishingOwnerSignOutController{
 type Finish='success'|'error'|'timeout'|'cancelled';
 let state:FishingOwnerSignOutState='ready',active=true,serial=0;
 let timer:ReturnType<typeof setTimeout>|null=null,cancel:(()=>void)|null=null;
 const clear=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
 return {
  getState:()=>state,
  async start(){
   if(!active||state!=='ready')return;
   const attempt=++serial;state='busy';callbacks.onState(state);
   const cancelled=new Promise<Finish>(resolve=>{cancel=()=>resolve('cancelled');});
   const timeout=new Promise<Finish>(resolve=>{timer=setTimeout(()=>resolve('timeout'),FISHING_OWNER_SIGN_OUT_TIMEOUT_MS);});
   const work=Promise.resolve().then(async():Promise<Finish>=>{
    if(!active||attempt!==serial)return 'cancelled';
    try{await accountAction<void>('logout','POST',{});return 'success';}catch{return 'error';}
   });
   const outcome=await Promise.race([work,timeout,cancelled]);clear();cancel=null;
   if(!active||attempt!==serial||outcome==='cancelled')return;
   state=outcome==='success'?'signed_out':'unconfirmed';callbacks.onState(state);
   if(state==='signed_out')callbacks.onSignedOut();
  },
  dispose(){if(!active)return;active=false;serial++;clear();cancel?.();cancel=null;},
 };
}
