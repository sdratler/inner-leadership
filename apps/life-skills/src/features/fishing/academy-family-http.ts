import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {readJson,failureResponse} from '../../lib/http/json.ts';
import {Ls050HttpBoundary,type Ls050HttpRuntime} from '../forms/http-boundary.ts';
import type {AcademyFamilyStore} from './academy-family-store.ts';
import {academyFamilyCommandSchema} from './academy-family-contract.ts';
export type AcademyFamilyHttpDependencies={runtime:Ls050HttpRuntime;store:Pick<AcademyFamilyStore,'context'|'setup'>};
const contextQuery=z.strictObject({applicationId:z.uuid()});
export async function academyFamilyHttp(request:Request,load:()=>Promise<AcademyFamilyHttpDependencies>){
 try{const d=await load();return await new Ls050HttpBoundary(d.runtime).handle(request,['GET','POST'],async(actor,requestId,url)=>{
  if(url.pathname!=='/api/private/group-applications/family')throw new AppError('NOT_FOUND');if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');
  if(request.method==='GET'){const query=contextQuery.safeParse(Object.fromEntries(url.searchParams));if(!query.success||url.searchParams.size!==1)throw new AppError('INVALID_REQUEST');return {data:await d.store.context(actor,query.data.applicationId)};}
  if(url.search)throw new AppError('INVALID_REQUEST');const body=await readJson(request,academyFamilyCommandSchema);if(request.headers.get('idempotency-key')!==body.operationId)throw new AppError('INVALID_REQUEST');return {data:await d.store.setup(actor,body,requestId)};
 });}catch(e){const r=failureResponse(e instanceof AppError?e:new AppError('UNAVAILABLE'),randomUUID());r.headers.set('Cache-Control','private, no-store');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return r;}
}
