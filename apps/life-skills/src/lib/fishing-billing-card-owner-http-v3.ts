import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.ts';
import {failureResponse,readJson,successResponse} from './http/json.ts';
import {verifyMutationOrigin,verifyCsrfToken} from './security/csrf.ts';
import {SESSION_COOKIE} from './security/session.ts';
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from './security/rate-limit.ts';
import {TOKEN_PATTERN} from '../features/identity/crypto.ts';
import type {Actor} from '../features/identity/types.ts';
import {canonicalForwardedRequest} from '../features/integration/canonical-forwarded-request.ts';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {cardAttemptSchema,cardPreparationReceiptSchema} from '../features/fishing-billing/card-contracts.ts';
import type {FishingBillingCards} from '../features/fishing-billing/cards.ts';
import {currentLedgerFrameV3Schema} from './fishing-billing-current-contract-v3.ts';
import {BILLING_CARD_OWNER_V3,FISHING_BILLING_CARD_OWNER_V3_PATH,currentCardCheckoutPermittedV3,billingCardOwnerCommandV3Schema,billingCardOwnerReadV3Schema} from './fishing-billing-card-owner-contract-v3.ts';

export type FishingBillingCardOwnerDepsV3={
 origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;limits:RateLimitStore;rateLimitKey:string;
 /** Explicit actual native owner read; no V2 cast or default implementation. */
 readCurrent:(actor:Actor,quoteId:string)=>Promise<ReturnType<typeof currentLedgerFrameV3Schema.parse>>;
 cards:Pick<FishingBillingCards,'prepare'|'readAttempt'|'readPreparationReceipt'|'createCheckout'>;
};
async function projection(d:FishingBillingCardOwnerDepsV3,actor:Actor,rawAttempt:unknown,quoteId:string,attemptId:string){
 try{
  const a=cardAttemptSchema.parse(rawAttempt),current=currentLedgerFrameV3Schema.parse(await d.readCurrent(actor,quoteId)),q=current.source.quote,b=current.balance;
  if(a.id!==attemptId||a.command.operationId!==a.id||a.quoteId!==quoteId||a.command.quoteId!==quoteId||a.workspaceId!==actor.workspaceId||a.actorId!==actor.id||a.familyId!==q.familyId||q.id!==quoteId||q.workspaceId!==actor.workspaceId||b.quoteId!==q.id||b.familyId!==q.familyId||b.revision!==q.revision||q.revision<a.balanceVersion||a.preparation.quoteId!==quoteId||a.preparation.operationId!==a.id||a.preparation.result.attemptId!==a.id||a.preparation.entityVersion>a.balanceVersion)throw new AppError('UNAVAILABLE');
  if(a.checkoutUrl){const u=new URL(a.checkoutUrl);if(u.origin!=='https://checkout.stripe.com'||u.username||u.password)throw new AppError('UNAVAILABLE');}
  const checkoutUrl=currentCardCheckoutPermittedV3(a,current)?a.checkoutUrl:null;
  const {checkoutUrl:historicalUrl,...attempt}=a;void historicalUrl;
  return {attempt,current,checkoutUrl};
 }catch{
  // Once an attempt/receipt exists, failed current auth/readback is uncertainty,
  // never evidence that its native write or provider request did not happen.
  throw new AppError('UNAVAILABLE');
 }
}
/** Unmounted owner-only card transport. A dependency factory must separately
 * bind current native family/service/SDK admission. No default runtime,
 * credentials, provider, parent principal or send authority is installed. */
export async function fishingBillingCardOwnerHttpV3(request:Request,load:()=>Promise<FishingBillingCardOwnerDepsV3>):Promise<Response>{
 const requestId=randomUUID();let response:Response,mutationInvoked=false;
 try{
  const cookies=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(SESSION_COOKIE+'='));
  if(cookies.length!==1)throw new AppError('UNAUTHENTICATED');const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!==FISHING_BILLING_CARD_OWNER_V3_PATH||url.hash)throw new AppError('NOT_FOUND');
  if(request.method!=='GET'&&request.method!=='POST')throw new AppError('INVALID_REQUEST');
  const actor=await d.actor(token);if(actor.role!=='practitioner'||actor.state!=='active')throw new AppError('FORBIDDEN');
  const key=opaqueRateLimitKey('fishing-billing-owner-card:'+actor.workspaceId+':'+actor.id,d.rateLimitKey);
  if(request.method==='GET'){
   if(url.searchParams.size!==3||['kind','quoteId','id'].some(k=>url.searchParams.getAll(k).length!==1))throw new AppError('INVALID_REQUEST');
   const kind=url.searchParams.get('kind'),quoteId=billingId.safeParse(url.searchParams.get('quoteId')),id=billingId.safeParse(url.searchParams.get('id'));
   if(!quoteId.success||!id.success||!['attempt','operation'].includes(kind??''))throw new AppError('INVALID_REQUEST');await enforceRateLimit(d.limits,key,60,60_000);
   if(kind==='operation'){
    const found=await d.cards.readPreparationReceipt(actor,quoteId.data,id.data);
    if(found===null)response=successResponse(billingCardOwnerReadV3Schema.parse({version:BILLING_CARD_OWNER_V3,state:'unresolved',quoteId:quoteId.data,operationId:id.data}),requestId);
    else{
     const receipt=cardPreparationReceiptSchema.parse(found);if(receipt.operationId!==id.data||receipt.quoteId!==quoteId.data||receipt.result.attemptId!==id.data)throw new AppError('UNAVAILABLE');
     let details;try{details=await projection(d,actor,await d.cards.readAttempt(actor,quoteId.data,id.data),quoteId.data,id.data);}catch{throw new AppError('UNAVAILABLE');}
     if(details.attempt.preparation.entityVersion!==receipt.entityVersion)throw new AppError('UNAVAILABLE');
     response=successResponse(billingCardOwnerReadV3Schema.parse({version:BILLING_CARD_OWNER_V3,state:'prepared',receipt,...details}),requestId);
    }
   }else response=successResponse(billingCardOwnerReadV3Schema.parse({version:BILLING_CARD_OWNER_V3,state:'attempt',...await projection(d,actor,await d.cards.readAttempt(actor,quoteId.data,id.data),quoteId.data,id.data)}),requestId);
  }else{
   if(url.search)throw new AppError('INVALID_REQUEST');verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),d.csrf(token));await enforceRateLimit(d.limits,key,20,60_000);
   const input=await readJson(request,billingCardOwnerCommandV3Schema);
   if(input.action==='prepare'){
    // An already recorded operation must reach Native's exact-body replay
    // validation before present-day collection/version gates. If no record is
    // known, report an observed stale revision BEFORE invoking a mutation.
    const previous=await d.cards.readPreparationReceipt(actor,input.command.quoteId,input.command.operationId);
    if(previous===null){
     const current=currentLedgerFrameV3Schema.parse(await d.readCurrent(actor,input.command.quoteId)),q=current.source.quote;
     if(q.id!==input.command.quoteId||q.workspaceId!==actor.workspaceId||q.revision<input.command.expectedVersion)throw new AppError('UNAVAILABLE');
     if(q.revision>input.command.expectedVersion&&await d.cards.readPreparationReceipt(actor,input.command.quoteId,input.command.operationId)===null)throw new AppError('CONFLICT');
    }
    mutationInvoked=true;
    const receipt=cardPreparationReceiptSchema.parse(await d.cards.prepare(actor,input.command));if(receipt.operationId!==input.command.operationId||receipt.quoteId!==input.command.quoteId||receipt.result.attemptId!==input.command.operationId||receipt.entityVersion!==input.command.expectedVersion+1)throw new AppError('UNAVAILABLE');
    let details;try{details=await projection(d,actor,await d.cards.readAttempt(actor,receipt.quoteId,receipt.operationId),receipt.quoteId,receipt.operationId);}catch{throw new AppError('UNAVAILABLE');}
    if(details.attempt.preparation.entityVersion!==receipt.entityVersion||JSON.stringify(details.attempt.command)!==JSON.stringify(input.command))throw new AppError('UNAVAILABLE');
    response=successResponse(billingCardOwnerReadV3Schema.parse({version:BILLING_CARD_OWNER_V3,state:'prepared',receipt,...details}),requestId);
   }else{
    mutationInvoked=true;
    const attempt=await d.cards.createCheckout(actor,input.command.quoteId,input.command.attemptId);
    response=successResponse(billingCardOwnerReadV3Schema.parse({version:BILLING_CARD_OWNER_V3,state:'attempt',...await projection(d,actor,attempt,input.command.quoteId,input.command.attemptId)}),requestId);
   }
  }
 }catch(error){response=failureResponse(mutationInvoked?new AppError('UNAVAILABLE'):error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;
}
