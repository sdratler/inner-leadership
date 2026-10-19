import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {readJson,failureResponse} from '../../lib/http/json.ts';
import {Ls050HttpBoundary,type Ls050HttpRuntime} from '../forms/http-boundary.ts';
import type {AcademyBillingStore} from './academy-billing-store.ts';
import {academyBillingQuerySchema,academyBillingCommandSchema} from './academy-billing-contract.ts';
import {FishingProgramError} from './native-program-contract.ts';
const endpoint='/api/private/group-applications/billing';
function safeFailure(e:unknown){if(e instanceof AppError)return e;const code=e instanceof FishingProgramError?e.code:e instanceof Error?e.message:'';if(['FORBIDDEN','NOT_FOUND','UNAUTHENTICATED','INVALID_REQUEST','UNAVAILABLE'].includes(code))return new AppError(code as 'FORBIDDEN'|'NOT_FOUND'|'UNAUTHENTICATED'|'INVALID_REQUEST'|'UNAVAILABLE');return new AppError(['CONFLICT','COMMAND_CONFLICT','OFFER_EXPIRED','APPROVAL_CHANGED','APPROVAL_REQUIRED','POLICY_REQUIRED','CAPACITY','IMMUTABLE_OFFER','FOUNDER_ACTIVATION_BLOCKED'].includes(code)?'CONFLICT':'UNAVAILABLE');}
export async function academyBillingHttp(request:Request,load:()=>Promise<{runtime:Ls050HttpRuntime;store:Pick<AcademyBillingStore,'context'|'execute'>}>){
 try{const d=await load();return await new Ls050HttpBoundary(d.runtime).handle(request,['GET','POST'],async(actor,_id,url)=>{
  try{if(url.pathname!==endpoint)throw new AppError('NOT_FOUND');if(!['practitioner','parent'].includes(actor.role))throw new AppError('FORBIDDEN');
   if(request.method==='GET'){const query=academyBillingQuerySchema.safeParse(Object.fromEntries(url.searchParams));if(!query.success||url.searchParams.size!==Object.keys(query.data).length)throw new AppError('INVALID_REQUEST');return {data:await d.store.context(actor,query.data)};}
   if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');if(url.search)throw new AppError('INVALID_REQUEST');const command=await readJson(request,academyBillingCommandSchema);if(request.headers.get('idempotency-key')!==command.operationId)throw new AppError('INVALID_REQUEST');return {data:await d.store.execute(actor,command)};
  }catch(e){throw safeFailure(e);}
 });}catch(e){const r=failureResponse(e instanceof AppError?e:new AppError('UNAVAILABLE'),randomUUID());r.headers.set('Cache-Control','private, no-store');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return r;}
}
