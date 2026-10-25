import 'server-only';
import {campaignShareCommandSchema,campaignSnapshotSchema} from './academy-campaign-contract.ts';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {readJson,failureResponse,successResponse} from '../../lib/http/json.ts';
import {Ls050HttpBoundary,type Ls050HttpRuntime} from '../forms/http-boundary.ts';
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from '../../lib/security/rate-limit.ts';
import {configuredGroupApplicationOrigin} from './public-origin.ts';
import {verifyMutationOrigin} from '../../lib/security/csrf.ts';
import {founderOwnerCommandSchema} from './academy-founder-contract.ts';
import type {AcademyFounderStore} from './academy-founder-store.ts';
export type FounderPublicDependencies={enabled:boolean;store:Pick<AcademyFounderStore,'aggregate'|'confirm'|'confirmationContext'>;environment:Record<string,string|undefined>;limits:RateLimitStore;rateKey:string;afterConfirm?:(reference:string)=>Promise<void>};
function headers(response:Response){response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');return response;}
export async function founderPublicHttp(request:Request,load:()=>Promise<FounderPublicDependencies>){const requestId=randomUUID();try{
 const d=await load();if(!d.enabled)throw new AppError('UNAVAILABLE');const origin=configuredGroupApplicationOrigin(request,d.environment);if(!origin)throw new AppError('FORBIDDEN');
 if(request.method==='POST'){if(request.headers.get('sec-fetch-site')!=='same-origin')throw new AppError('FORBIDDEN');verifyMutationOrigin(request,origin);}
 const url=new URL(request.url);if(url.search||url.pathname!=='/api/public/academy-founder')throw new AppError('INVALID_REQUEST');
 await enforceRateLimit(d.limits,opaqueRateLimitKey('academy-founder-public',d.rateKey),60,60_000);
 if(request.method==='GET')return headers(successResponse(campaignSnapshotSchema.parse(await d.store.aggregate()),requestId));
 if(request.method!=='POST')throw new AppError('INVALID_REQUEST');const body=await readJson(request,z.object({action:z.enum(['confirm_interest','read_confirmation']),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict());
 if(body.action==='read_confirmation')return headers(successResponse(await d.store.confirmationContext(body.token),requestId));
 const confirmed=await d.store.confirm(body.token);
 // Confirmation is durable before delivery. Failed dispatch leaves the existing
 // outbox available for its worker; it must not turn a saved confirmation into a failure.
 if(d.afterConfirm){try{await d.afterConfirm(confirmed.reference);}catch{/* Existing outbox retains delivery/reconciliation state. */}}
 return headers(successResponse(confirmed,requestId));
 }catch(e){return headers(failureResponse(e instanceof AppError?e:new AppError('UNAVAILABLE'),requestId));}}
export async function founderOwnerHttp(request:Request,load:()=>Promise<{runtime:Ls050HttpRuntime;store:Pick<AcademyFounderStore,'ownerList'|'execute'|'campaignExecute'>}>){try{const d=await load();return await new Ls050HttpBoundary(d.runtime).handle(request,['GET','POST'],async(actor,_id,url)=>{
 if(url.pathname!=='/api/private/group-applications/founder'||url.search)throw new AppError('INVALID_REQUEST');if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');
 if(request.method==='GET')return {data:await d.store.ownerList(actor)};
 const body=await readJson(request,z.union([founderOwnerCommandSchema,campaignShareCommandSchema]));if(request.headers.get('idempotency-key')!==body.operationId)throw new AppError('INVALID_REQUEST');return {data:await ('familyId' in body?d.store.execute(actor,body):d.store.campaignExecute(actor,body))};
 });}catch(e){return headers(failureResponse(e instanceof AppError?e:new AppError('UNAVAILABLE'),randomUUID()));}}
