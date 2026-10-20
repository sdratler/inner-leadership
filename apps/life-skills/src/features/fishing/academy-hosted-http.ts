import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {readJson,failureResponse} from '../../lib/http/json.ts';
import {Ls050HttpBoundary,type Ls050HttpRuntime} from '../forms/http-boundary.ts';
import {FishingProgramError} from './native-program-contract.ts';
import type {AcademyHostedStore} from './academy-hosted-store.ts';
import {academyHostedPostSchema} from './academy-hosted-contract.ts';
function safeFailure(e:unknown){if(e instanceof AppError)return e;const code=e instanceof FishingProgramError?e.code:e instanceof Error?e.message:'';if(['FORBIDDEN','NOT_FOUND','UNAUTHENTICATED','INVALID_REQUEST','UNAVAILABLE'].includes(code))return new AppError(code as 'FORBIDDEN'|'NOT_FOUND'|'UNAUTHENTICATED'|'INVALID_REQUEST'|'UNAVAILABLE');return new AppError(['CONFLICT','COMMAND_CONFLICT','OFFER_EXPIRED','OFFER_NOT_EXPIRED','APPROVAL_CHANGED','APPROVAL_REQUIRED','DUE_NOT_PAYABLE','FOUNDER_ACTIVATION_BLOCKED'].includes(code)?'CONFLICT':'UNAVAILABLE');}
export async function academyHostedHttp(request:Request,load:()=>Promise<{runtime:Ls050HttpRuntime;store:Pick<AcademyHostedStore,'request'|'cleanup'>}>){
 try{const d=await load();return await new Ls050HttpBoundary(d.runtime).handle(request,['POST'],async(actor,_id,url)=>{try{
  if(url.pathname!=='/api/private/group-applications/hosted')throw new AppError('NOT_FOUND');if(url.search)throw new AppError('INVALID_REQUEST');const command=await readJson(request,academyHostedPostSchema);if(actor.role!==(command.action==='request'?'parent':'practitioner'))throw new AppError('FORBIDDEN');if(request.headers.get('idempotency-key')!==command.operationId)throw new AppError('INVALID_REQUEST');return {data:command.action==='request'?await d.store.request(actor,command):await d.store.cleanup(actor,command)};
 }catch(e){throw safeFailure(e);}});}catch(e){const r=failureResponse(e instanceof AppError?e:new AppError('UNAVAILABLE'),randomUUID());r.headers.set('Cache-Control','private, no-store');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return r;}
}
