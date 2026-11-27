import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { failureResponse,readJson,successResponse } from '../../lib/http/json.ts';
import { verifyCsrfToken,verifyMutationOrigin } from '../../lib/security/csrf.ts';
import { SESSION_COOKIE } from '../../lib/security/session.ts';
import { enforceRateLimit,opaqueRateLimitKey,type RateLimitStore } from '../../lib/security/rate-limit.ts';
import { csrfSecret,TOKEN_PATTERN } from '../identity/crypto.ts';
import type { IdentityConfig } from '../identity/config.ts';
import type { IdentityAuthService } from '../identity/auth-service.ts';
import type { IdentitySessions } from '../identity/session-adapter.ts';
import type { Actor } from '../identity/types.ts';
import { tripCommandSchema } from './contract.ts';
import type { IndividualTripStore } from './store.ts';
import { individualTripRegistrationSchema,type IndividualTripRegistrationService } from './registration-service.ts';

export function tripCookie(request:Request,name:string):string|undefined {
 const found=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
 const token=found.length===1?found[0]!.slice(name.length+1):'';
 return TOKEN_PATTERN.test(token)?token:undefined;
}
export const ownerTripActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('manual_delivery'),operationId:z.uuid(),expectedRevision:z.number().int().min(0),offerId:z.uuid(),sentAt:z.iso.datetime({offset:true}),reference:z.string().trim().min(1).max(500),shortNoticeDeadline:z.iso.datetime({offset:true}).optional()}).strict(),
 z.object({action:z.literal('attach_invoice'),operationId:z.uuid(),expectedRevision:z.number().int().min(0),offerId:z.uuid(),invoiceId:z.string().regex(/^in_[A-Za-z0-9]+$/)}).strict(),
 z.object({action:z.literal('reconcile_invoice'),operationId:z.uuid(),expectedRevision:z.number().int().min(0),offerId:z.uuid(),cashReceiptId:z.uuid().optional(),cashReceiptIds:z.array(z.uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length).optional()}).strict(),
]);
export type OwnerTripAction=z.infer<typeof ownerTripActionSchema>;
export interface TripHttpDependencies {
 config:IdentityConfig;trips:IndividualTripStore;registration:IndividualTripRegistrationService;
 sessions:IdentitySessions;auth:IdentityAuthService;limits:RateLimitStore;
 capabilities:{stripeLookup:boolean;mailAdmission:boolean;ownerChat:boolean;siteChat?:boolean};
 ownerAction(actor:Actor,input:OwnerTripAction):Promise<unknown>;
 chat?:{grant(actor:Actor,input:unknown):Promise<unknown>;revoke(actor:Actor,id:string):Promise<unknown>};
 siteChat?:{connect(actor:Actor,input:unknown):Promise<unknown>;revoke(actor:Actor,callerId:string):Promise<unknown>;connections(actor:Actor):Promise<unknown>};
}
function secure(response:Response):Response{
 response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;
}
/** The public form creates an invitation only. Household access always passes
 * native session, verified-adult and explicit program-membership checks. */
export class IndividualTripsHttp {
 constructor(private readonly deps:TripHttpDependencies){}
 private async limit(subject:string,max:number,window=900000){await enforceRateLimit(this.deps.limits,opaqueRateLimitKey('individual-trips:'+subject,this.deps.config.rateLimitKey),max,window);}
 async handle(request:Request):Promise<Response>{
  const requestId=randomUUID();
  try{
   const {config}=this.deps,url=new URL(request.url),path=url.pathname;
   if(!config.enabled)throw new AppError('UNAVAILABLE');
   if(url.origin!==config.origin||url.search)throw new AppError('INVALID_REQUEST');
   if(!(['/api/individual-trips','/api/individual-trips/register','/api/individual-trips/owner-action','/api/individual-trips/chat-grants'].includes(path))||!['GET','POST'].includes(request.method)||!['/api/individual-trips','/api/individual-trips/chat-grants'].includes(path)&&request.method!=='POST')throw new AppError('NOT_FOUND');
   if(request.method==='POST')verifyMutationOrigin(request,config.origin);
   if(path==='/api/individual-trips/register'){
    const token=tripCookie(request,'__Host-ls-preauth');if(!token)throw new AppError('FORBIDDEN');
    verifyCsrfToken(request.headers.get('x-csrf-token'),csrfSecret(token,config.csrfKey,'preauth'));
    await this.deps.auth.assertPreauth(token);
    await this.limit('registration-shared-network',30,3600000);
    const input=await readJson(request,individualTripRegistrationSchema);
    await this.limit('registration-email:'+input.email,5,3600000);
    return secure(successResponse(await this.deps.registration.register(input,requestId),requestId,202));
   }
   const token=tripCookie(request,SESSION_COOKIE);if(!token)throw new AppError('UNAUTHENTICATED');
   const actor=await this.deps.sessions.actor(token);
   await this.limit('account:'+actor.id,150);
   if(request.method==='GET'&&path.endsWith('/chat-grants')){
    if(!this.deps.siteChat||!this.deps.capabilities.siteChat)throw new AppError('UNAVAILABLE');
    return secure(successResponse(await this.deps.siteChat.connections(actor),requestId));
   }
   if(request.method==='GET'){
    const state=await this.deps.trips.read(actor);
    return secure(successResponse({role:actor.role==='practitioner'?'owner':'parent',state,capabilities:actor.role==='practitioner'?this.deps.capabilities:{stripeLookup:false,mailAdmission:false,ownerChat:false}},requestId));
   }
   verifyCsrfToken(request.headers.get('x-csrf-token'),this.deps.sessions.csrf(token));
   if(path.endsWith('/chat-grants')){
    const input=await readJson(request,z.discriminatedUnion('action',[
     z.object({action:z.literal('create'),callerId:z.string(),minutes:z.number(),write:z.boolean()}).strict(),
     z.object({action:z.literal('revoke'),grantId:z.uuid()}).strict(),
     z.object({action:z.literal('connect_site'),callerId:z.string(),minutes:z.number().int().min(1).max(30)}).strict(),
     z.object({action:z.literal('revoke_site'),callerId:z.string()}).strict(),
    ]));
    if(input.action==='connect_site'||input.action==='revoke_site'){
     if(!this.deps.siteChat||!this.deps.capabilities.siteChat)throw new AppError('UNAVAILABLE');
     return secure(successResponse(input.action==='connect_site'?await this.deps.siteChat.connect(actor,{callerId:input.callerId,minutes:input.minutes}):await this.deps.siteChat.revoke(actor,input.callerId),requestId));
    }
    if(!this.deps.chat||!this.deps.capabilities.ownerChat)throw new AppError('UNAVAILABLE');
    return secure(successResponse(input.action==='create'?await this.deps.chat.grant(actor,{callerId:input.callerId,minutes:input.minutes,write:input.write}):await this.deps.chat.revoke(actor,input.grantId),requestId));
   }
   if(path.endsWith('/owner-action')){
    // read() repeats fresh native owner scope, before any provider request.
    await this.deps.trips.read(actor);
    if(actor.id!==this.deps.trips.config.ownerAccountId||actor.role!=='practitioner')throw new AppError('NOT_FOUND');
    return secure(successResponse(await this.deps.ownerAction(actor,await readJson(request,ownerTripActionSchema)),requestId));
   }
   const input=await readJson(request,z.object({command:tripCommandSchema,adultConfirmed:z.literal(true).optional()}).strict());
   // Invoice identity, URL and money come exclusively from a verified lookup.
   if(input.command.type==='invoice.attach')throw new AppError('FORBIDDEN');
   return secure(successResponse(await this.deps.trips.execute(actor,input.command,input.adultConfirmed===true),requestId));
  }catch(error){return secure(failureResponse(error,requestId));}
 }
}
