import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.ts';
import {readJson,successResponse,failureResponse} from './http/json.ts';
import {verifyMutationOrigin,verifyCsrfToken} from './security/csrf.ts';
import {SESSION_COOKIE} from './security/session.ts';
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from './security/rate-limit.ts';
import {TOKEN_PATTERN} from '../features/identity/crypto.ts';
import type {Actor} from '../features/identity/types.ts';
import {canonicalForwardedRequest} from '../features/integration/canonical-forwarded-request.ts';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {cardAttemptSchema,cardPreparationReceiptSchema,type PrepareCardCommand} from '../features/fishing-billing/card-contracts.ts';
import type {FishingServiceBillingCardsV4} from '../features/fishing-billing/guest-service-cards-v4.ts';
import type {FishingServiceBillingOwnerV4} from '../features/fishing-billing/guest-service-owner-financial-v4.ts';
import {ownerServiceCurrentV4Schema} from './fishing-billing-owner-contract-v4.ts';
import {BILLING_CARD_OWNER_V4,FISHING_BILLING_CARD_OWNER_V4_PATH,ownerCardRequestV4Schema,ownerCardReadV4Schema} from './fishing-billing-card-owner-contract-v4.ts';

export type FishingBillingCardOwnerHttpV4Deps={
 origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;limits:RateLimitStore;rateLimitKey:string;
 /** These actual native owner methods must retain their configured-owner,
  * current session, same-TX permission, history and uncertainty guards. */
 cards:Pick<FishingServiceBillingCardsV4,'prepare'|'readPreparationReceipt'|'readAttempt'>;
 readCurrent:Pick<FishingServiceBillingOwnerV4,'readSnapshot'>['readSnapshot'];
};
/** Unmounted owner V4 preparation/read adapter. No reserve/dispatch/create SDK
 * method, frozen request, checkout URL, factory or runtime is exposed here. */
export async function fishingBillingCardOwnerHttpV4(request:Request,load:()=>Promise<FishingBillingCardOwnerHttpV4Deps>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(SESSION_COOKIE+'='));
  if(cookies.length!==1)throw new AppError('UNAUTHENTICATED');const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!==FISHING_BILLING_CARD_OWNER_V4_PATH||url.hash)throw new AppError('NOT_FOUND');
  if(request.method!=='GET'&&request.method!=='POST')throw new AppError('INVALID_REQUEST');
  const actor=await d.actor(token);if(actor.role!=='practitioner'||actor.state!=='active')throw new AppError('FORBIDDEN');
  const key=opaqueRateLimitKey('fishing-owner-card-v4:'+actor.workspaceId+':'+actor.id,d.rateLimitKey);
  const projection=async(quoteId:string,attemptId:string)=>{
   const a=cardAttemptSchema.parse(await d.cards.readAttempt(actor,quoteId,attemptId));
   if(a.id!==attemptId||a.quoteId!==quoteId||a.workspaceId!==actor.workspaceId||a.actorId!==actor.id)throw new AppError('UNAVAILABLE');
   const current=ownerServiceCurrentV4Schema.parse(await d.readCurrent(actor,quoteId));
   if(current.quote.id!==quoteId||current.quote.workspaceId!==actor.workspaceId||current.quote.familyId!==a.familyId)throw new AppError('UNAVAILABLE');
   const {checkoutUrl,...attempt}=a;void checkoutUrl;return {attempt,current};
  };
  const prepared=async(command:PrepareCardCommand,raw:unknown)=>{
   const receipt=cardPreparationReceiptSchema.parse(raw);
   if(receipt.operationId!==command.operationId||receipt.quoteId!==command.quoteId||receipt.result.attemptId!==command.operationId)throw new AppError('UNAVAILABLE');
   return ownerCardReadV4Schema.parse({version:BILLING_CARD_OWNER_V4,state:'prepared',command,receipt,...await projection(command.quoteId,command.operationId)});
  };
  if(request.method==='GET'){
   if(url.searchParams.size!==3||['kind','quoteId','attemptId'].some(k=>url.searchParams.getAll(k).length!==1)||url.searchParams.get('kind')!=='attempt')throw new AppError('INVALID_REQUEST');
   const quote=billingId.safeParse(url.searchParams.get('quoteId')),attempt=billingId.safeParse(url.searchParams.get('attemptId'));
   if(!quote.success||!attempt.success)throw new AppError('INVALID_REQUEST');await enforceRateLimit(d.limits,key,60,60_000);
   try{response=successResponse(ownerCardReadV4Schema.parse({version:BILLING_CARD_OWNER_V4,state:'attempt',...await projection(quote.data,attempt.data)}),requestId);}catch{throw new AppError('UNAVAILABLE');}
  }else{
   if(url.search)throw new AppError('INVALID_REQUEST');verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),d.csrf(token));
   await enforceRateLimit(d.limits,key,20,60_000);const input=await readJson(request,ownerCardRequestV4Schema);
   // Native preparation has no structured rollback outcome. A thrown typed
   // error may follow a durable commit; conservative UNKNOWN is mandatory.
   try{
    if(input.intent==='prepare')response=successResponse(await prepared(input.command,await d.cards.prepare(actor,input.command)),requestId);
    else{
     const receipt=await d.cards.readPreparationReceipt(actor,input.command);
     response=successResponse(receipt===null?ownerCardReadV4Schema.parse({version:BILLING_CARD_OWNER_V4,state:'unresolved',command:input.command}):await prepared(input.command,receipt),requestId);
    }
   }catch{throw new AppError('UNAVAILABLE');}
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;
}
