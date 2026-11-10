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
import {BILLING_SERVICE_V4} from '../features/fishing-billing/guest-service-contract-v4.ts';
import {serviceOwnerMoneyOutcomeV4Schema} from '../features/fishing-billing/guest-service-owner-money-contract-v4.ts';
import {serviceStateOutcomeV4Schema} from '../features/fishing-billing/guest-service-owner-state-contract-v4.ts';
import type {FishingServiceBillingOwnerV4} from '../features/fishing-billing/guest-service-owner-financial-v4.ts';
import {FISHING_BILLING_OWNER_V4_PATH,ownerServiceCurrentV4Schema,ownerServiceRequestV4Schema,ownerServiceReceiptV4Schema,ownerServiceReadV4Schema,sameOwnerServiceValueV4,type OwnerServiceOperationV4} from './fishing-billing-owner-contract-v4.ts';

export type FishingBillingOwnerHttpV4Deps={
 origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;
 /** Mandatory native configured-owner store, with fresh same-TX authority.
  * A practitioner role or a parsed request is not that authority. */
 store:Pick<FishingServiceBillingOwnerV4,'readSnapshot'|'readMoneyOperation'|'readStateOperation'|'recordCashDate'|'reverseCash'|'setState'>;
};
/** Unmounted V4 HTTP adapter only. No factory, API route, activation switch,
 * source cutover, payment provider, migration or sending capability is added. */
export async function fishingBillingOwnerHttpV4(request:Request,load:()=>Promise<FishingBillingOwnerHttpV4Deps>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+'='));
  if(cookies.length!==1)throw new AppError('UNAUTHENTICATED');
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!==FISHING_BILLING_OWNER_V4_PATH||url.hash)throw new AppError('NOT_FOUND');
  if(request.method!=='GET'&&request.method!=='POST')throw new AppError('INVALID_REQUEST');
  const actor=await d.actor(token);if(actor.role!=='practitioner'||actor.state!=='active')throw new AppError('FORBIDDEN');
  const key=opaqueRateLimitKey('fishing-service-owner-v4:'+actor.workspaceId+':'+actor.id,d.rateLimitKey);
  const current=async(id:string)=>{
   const s=ownerServiceCurrentV4Schema.parse(await d.store.readSnapshot(actor,id));
   if(s.quote.workspaceId!==actor.workspaceId||s.quote.id!==id)throw new AppError('UNAVAILABLE');return s;
  };
  if(request.method==='GET'){
   if(url.searchParams.size!==2||url.searchParams.getAll('kind').length!==1||url.searchParams.get('kind')!=='balance'||url.searchParams.getAll('id').length!==1)throw new AppError('INVALID_REQUEST');
   const id=billingId.safeParse(url.searchParams.get('id'));if(!id.success)throw new AppError('INVALID_REQUEST');
   await enforceRateLimit(d.limits,key,60,60_000);
   response=successResponse(ownerServiceReadV4Schema.parse({version:BILLING_SERVICE_V4,state:'ready',current:await current(id.data)}),requestId);
  }else{
   if(url.search)throw new AppError('INVALID_REQUEST');
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),d.csrf(token));
   await enforceRateLimit(d.limits,key,20,60_000);
   const input=await readJson(request,ownerServiceRequestV4Schema),operation=input.operation;
   const confirm=async(raw:unknown)=>{
    const receipt=ownerServiceReceiptV4Schema.parse(raw);
    if(receipt.workspaceId!==actor.workspaceId||receipt.actorId!==actor.id)throw new AppError('UNAVAILABLE');
    return ownerServiceReadV4Schema.parse({version:BILLING_SERVICE_V4,state:'confirmed',operation,receipt,current:await current(operation.command.quoteId)});
   };
   // Any thrown error after invoking native work is uncertainty, including a
   // typed adapter/post-COMMIT error or failed current refresh. Only the native
   // structured outcome can prove this specific attempt's rollback.
   try{
    if(input.intent==='recover'){
     const found=operation.action==='state'?await d.store.readStateOperation(actor,operation.command):await d.store.readMoneyOperation(actor,operation);
     response=successResponse(found===null?ownerServiceReadV4Schema.parse({version:BILLING_SERVICE_V4,state:'unresolved',operation}):await confirm(found),requestId);
    }else{
     const outcome=operation.action==='state'?serviceStateOutcomeV4Schema.parse(await d.store.setState(actor,operation.command)):
      serviceOwnerMoneyOutcomeV4Schema.parse(operation.action==='cash_date'?await d.store.recordCashDate(actor,operation.command):await d.store.reverseCash(actor,operation.command));
     const actual:OwnerServiceOperationV4='command' in outcome?{action:'state',command:outcome.command}:outcome.input;
     if(outcome.workspaceId!==actor.workspaceId||outcome.actorId!==actor.id||!sameOwnerServiceValueV4(actual,operation))throw new AppError('UNAVAILABLE');
     response=successResponse(outcome.state==='rejected_current_attempt'?ownerServiceReadV4Schema.parse({version:BILLING_SERVICE_V4,state:'rejected_current_attempt',operation,code:outcome.code}):await confirm(outcome.result),requestId);
    }
   }catch{throw new AppError('UNAVAILABLE');}
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;
}
