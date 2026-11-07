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
import {BILLING_DTO_V2,operationReceiptV2Schema} from '../features/fishing-billing/contracts-v2.ts';
import type {FishingBillingStore} from '../features/fishing-billing/native.ts';
import {FISHING_BILLING_OWNER_V2_PATH,billingOwnerCommandV2Schema,billingOwnerReadV2Schema,billingOwnerSnapshotV2Schema} from './fishing-billing-owner-contract-v2.ts';

export type FishingBillingOwnerHttpV2Deps={
 origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;
 store:Pick<FishingBillingStore,'readBalanceV2'|'readOperationReceiptV2'|'recordCashDate'|'reverseCashV2'|'setStateV2'>;
};
function snapshot(value:unknown,actor:Actor,quoteId:string,familyId?:string,minimumVersion=1){
 const current=billingOwnerSnapshotV2Schema.parse(value),q=current.quote,b=current.balance;
 if(q.id!==quoteId||q.workspaceId!==actor.workspaceId||b.quoteId!==q.id||b.familyId!==q.familyId||
  b.revision!==q.revision||q.revision<minimumVersion||familyId!==undefined&&q.familyId!==familyId)throw new AppError('UNAVAILABLE');
 return current;
}
async function currentAfterReceipt(d:FishingBillingOwnerHttpV2Deps,actor:Actor,receipt:ReturnType<typeof operationReceiptV2Schema.parse>){
 try{
  return snapshot(await d.store.readBalanceV2(actor,receipt.entityId),actor,receipt.entityId,receipt.result.quote.familyId,receipt.entityVersion);
 }catch{
  // Authorization still fails closed. Once the operation receipt exists, an
  // unsuccessful current read must not be presented as a failed money save.
  throw new AppError('UNAVAILABLE');
 }
}
/** Unmounted owner-only adapter. The mandatory store must resolve fresh native
 * Academy authority in its transaction. No provider, parent acceptance, reminder
 * dispatch, publication, migration or default runtime factory is supplied here. */
export async function fishingBillingOwnerHttpV2(request:Request,load:()=>Promise<FishingBillingOwnerHttpV2Deps>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(SESSION_COOKIE+'='));
  if(cookies.length!==1)throw new AppError('UNAUTHENTICATED');
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
  if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!==FISHING_BILLING_OWNER_V2_PATH||url.hash)throw new AppError('NOT_FOUND');
  if(request.method!=='GET'&&request.method!=='POST')throw new AppError('INVALID_REQUEST');
  const actor=await d.actor(token);
  if(actor.role!=='practitioner'||actor.state!=='active')throw new AppError('FORBIDDEN');
  const key=opaqueRateLimitKey('fishing-billing-owner:'+actor.workspaceId+':'+actor.id,d.rateLimitKey);
  if(request.method==='GET'){
   if(url.searchParams.size!==2||url.searchParams.getAll('kind').length!==1||url.searchParams.getAll('id').length!==1)throw new AppError('INVALID_REQUEST');
   const id=billingId.safeParse(url.searchParams.get('id'));
   const kind=url.searchParams.get('kind');
   if(!id.success||!['balance','operation'].includes(kind??''))throw new AppError('INVALID_REQUEST');
   await enforceRateLimit(d.limits,key,60,60_000);
   if(kind==='balance'){
    response=successResponse(billingOwnerReadV2Schema.parse({version:BILLING_DTO_V2,state:'ready',current:snapshot(await d.store.readBalanceV2(actor,id.data),actor,id.data)}),requestId);
   }else{
    const found=await d.store.readOperationReceiptV2(actor,id.data);
    if(found===null){
     response=successResponse(billingOwnerReadV2Schema.parse({version:BILLING_DTO_V2,state:'unresolved',operationId:id.data}),requestId);
    }else{
     const receipt=operationReceiptV2Schema.parse(found);
     if(receipt.operationId!==id.data||receipt.entityId!==receipt.result.quote.id||receipt.result.quote.workspaceId!==actor.workspaceId)throw new AppError('UNAVAILABLE');
     const current=await currentAfterReceipt(d,actor,receipt);
     response=successResponse(billingOwnerReadV2Schema.parse({version:BILLING_DTO_V2,state:'confirmed',receipt,current}),requestId);
    }
   }
  }else{
   if(url.search)throw new AppError('INVALID_REQUEST');
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),d.csrf(token));
   await enforceRateLimit(d.limits,key,20,60_000);
   const input=await readJson(request,billingOwnerCommandV2Schema);
   const found=input.action==='cash_date'?await d.store.recordCashDate(actor,input.command):
    input.action==='reverse_cash'?await d.store.reverseCashV2(actor,input.command):await d.store.setStateV2(actor,input.command);
   const receipt=operationReceiptV2Schema.parse(found);
   if(receipt.operationId!==input.command.operationId||receipt.entityId!==input.command.quoteId||receipt.result.quote.id!==input.command.quoteId||receipt.result.quote.workspaceId!==actor.workspaceId)throw new AppError('UNAVAILABLE');
   // Even a replay returns its original receipt. Refresh now; failure here is
   // uncertain to the caller, never a claim that the mutation was rolled back.
   const current=await currentAfterReceipt(d,actor,receipt);
   response=successResponse(billingOwnerReadV2Schema.parse({version:BILLING_DTO_V2,state:'confirmed',receipt,current}),requestId);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
 return response;
}
