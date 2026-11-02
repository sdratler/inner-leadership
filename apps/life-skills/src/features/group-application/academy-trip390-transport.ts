import {z} from 'zod';
import {
 TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_OFFER,trip390Copy,trip390Metadata,
 type Trip390Command,
} from './academy-trip390-contract.ts';
import type {Trip390SaveResult} from './academy-trip390-page.tsx';
import {academyPath,type AcademyRouteMode} from './academy-routing.ts';
import type {Locale} from '../../lib/locale.ts';

export const TRIP390_MEDIA_TYPE='application/vnd.jlfa.trip390-interest-v1+json';
export function academyPublicOffer(environment:Record<string,string|undefined>){
 const selected=environment.LS_ACADEMY_PUBLIC_OFFER;
 if(!selected)return 'legacy';
 return selected===TRIP390_OFFER.version?'trip390':'unavailable';
}
const endpoint='/api/public/group-applications?program=sunday_fishing_academy';
function noticeFor(locale:Locale){
 const {form,hero}=trip390Copy[locale];
 return {conduct:form.conduct,interest:form.interest_ack,privacy:form.privacy_short,whatsapp:form.whatsapp,interestNote:hero.interest_note};
}
export const trip390Notice={en:noticeFor('en'),he:noticeFor('he')};
function noticeSchema(locale:Locale){
 const n=trip390Notice[locale];
 return z.object({conduct:z.literal(n.conduct),interest:z.literal(n.interest),privacy:z.literal(n.privacy),
  whatsapp:z.literal(n.whatsapp),interestNote:z.literal(n.interestNote)}).strict();
}
const challengeEnvelope=z.object({ok:z.literal(true),requestId:z.uuid(),data:z.object({
 version:z.literal(TRIP390_INTEREST_VERSION),offerVersion:z.literal(TRIP390_OFFER.version),
 noticeVersion:z.literal(TRIP390_NOTICE_VERSION),notice:z.object({en:noticeSchema('en'),he:noticeSchema('he')}).strict(),
 challenge:z.string().min(80).max(1024),
}).strict()}).strict();
const savedEnvelope=z.object({ok:z.literal(true),requestId:z.uuid(),data:z.object({
 operationId:z.uuid(),reference:z.uuid(),acknowledgment:z.literal('not_queued'),replayed:z.boolean(),
}).strict()}).strict();
const errorEnvelope=z.object({ok:z.literal(false),requestId:z.uuid(),error:z.object({code:z.string()}).strict()}).strict();

/** One explicit user submission performs at most one POST. A lost reply keeps
 * its original command locked, including when a later challenge cannot load. */
export function createTrip390Transport(
 send:typeof fetch=(...args)=>fetch(...args),
 wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
){
 let pending:string|null=null;
 return async(command:Trip390Command):Promise<Trip390SaveResult>=>{
  const payload=JSON.stringify(command);
  if(pending!==null&&pending!==payload)return {state:'conflict'};
  const previousUnknown=pending!==null;
  const common={credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'} as const;
  try{
   const issued=await send(endpoint,{...common,headers:{Accept:TRIP390_MEDIA_TYPE}});
   if(issued.status!==200)return previousUnknown?{state:'unknown'}:{state:'rejected',reason:'unavailable'};
   const challenge=challengeEnvelope.safeParse(await issued.json());
   if(!challenge.success)return previousUnknown?{state:'unknown'}:{state:'rejected',reason:'unavailable'};
   await wait(1600);
   pending=payload;
   const body=JSON.stringify({...JSON.parse(payload) as Trip390Command,challenge:challenge.data.data.challenge,website:''});
   const reply=await send(endpoint,{...common,method:'POST',headers:{Accept:TRIP390_MEDIA_TYPE,'Content-Type':'application/json'},body});
   const json:unknown=await reply.json();
   if(reply.status===200||reply.status===201){
    const saved=savedEnvelope.safeParse(json);
    if(!saved.success||saved.data.data.operationId!==command.operationId)return {state:'unknown'};
    pending=null;return {state:'saved',operationId:command.operationId,reference:saved.data.data.reference,email:'not_queued'};
   }
   const failure=errorEnvelope.safeParse(json);
   if(failure.success){
    const code=failure.data.error.code;
    if(reply.status===409&&code==='CONFLICT')return {state:'conflict'};
    if(!previousUnknown&&((reply.status===400&&code==='INVALID_REQUEST')||(reply.status===403&&code==='FORBIDDEN')||
      (reply.status===413&&code==='PAYLOAD_TOO_LARGE')||(reply.status===415&&code==='UNSUPPORTED_MEDIA_TYPE')||
      (reply.status===429&&code==='RATE_LIMITED')||(reply.status===404&&code==='NOT_FOUND'))){
     pending=null;
     return {state:'rejected',reason:code==='INVALID_REQUEST'?'invalid':'unavailable'};
    }
   }
   return {state:'unknown'};
  }catch{
   return pending===null?{state:'rejected',reason:'unavailable'}:{state:'unknown'};
  }
 };
}

export function trip390RouteMetadata(locale:Locale,path:''|'/apply',mode:AcademyRouteMode){
 const copy=trip390Metadata(locale);
 const origin=mode==='bna'?'https://bneineviimacademy.org':'https://life-skills.bneineviimacademy.org';
 const url=(lang:Locale)=>origin+academyPath(lang,path,mode);
 const logo=origin+'/groups/brand/jlfa-logo-locked-v1.png';
 return {...copy,alternates:{canonical:url(locale),languages:{en:url('en'),he:url('he')}},
  openGraph:{...copy.openGraph,url:url(locale),type:'website' as const,locale:locale==='he'?'he_IL':'en_US',
   alternateLocale:[locale==='he'?'en_US':'he_IL'],images:[{url:logo,alt:trip390Copy[locale].brand}]},
  twitter:{card:'summary' as const,title:copy.openGraph.title,description:copy.openGraph.description,images:[logo]},
  icons:{icon:[{url:logo,type:'image/png'}],apple:[{url:logo,type:'image/png'}]}};
}

/** Gateway rewrites only upstream /<locale>/florida Location paths and preserves
 * their query. Carry the two registered anchors through that existing mapping. */
export function trip390AliasLocation(locale:Locale,anchor:'included'|'learn',mode:AcademyRouteMode){
 const base=academyPath(locale,'','legacy');
 return mode==='bna'?`${base}?section=${anchor}#${anchor}`:`${base}#${anchor}`;
}
