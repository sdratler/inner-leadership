import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {readJson,failureResponse} from '../../lib/http/json.ts';
import {Ls050HttpBoundary,type Ls050HttpRuntime} from '../forms/http-boundary.ts';
import {FishingProgramError} from './native-program-contract.ts';
import type {AcademyEnrollmentStore} from './academy-enrollment-store.ts';
import {academyEnrollmentCommandSchema} from './academy-enrollment-contract.ts';
const endpoint='/api/private/group-applications/enrollment',ownerQuery=z.strictObject({applicationId:z.uuid()}),parentQuery=z.strictObject({learnerId:z.uuid()});
export async function academyEnrollmentHttp(request:Request,load:()=>Promise<{runtime:Ls050HttpRuntime;store:Pick<AcademyEnrollmentStore,'ownerContext'|'parentContext'|'execute'>}>){
 try{const d=await load();return await new Ls050HttpBoundary(d.runtime).handle(request,['GET','POST'],async(actor,_id,url)=>{
  try{if(url.pathname!==endpoint)throw new AppError('NOT_FOUND');if(!['practitioner','parent'].includes(actor.role))throw new AppError('FORBIDDEN');
   if(request.method==='GET'){if(url.searchParams.size!==1)throw new AppError('INVALID_REQUEST');const values=Object.fromEntries(url.searchParams);if(actor.role==='practitioner'){const query=ownerQuery.safeParse(values);if(!query.success)throw new AppError('INVALID_REQUEST');return {data:await d.store.ownerContext(actor,query.data.applicationId)};}const query=parentQuery.safeParse(values);if(!query.success)throw new AppError('INVALID_REQUEST');return {data:await d.store.parentContext(actor,query.data.learnerId)};}
   if(url.search)throw new AppError('INVALID_REQUEST');const body=await readJson(request,academyEnrollmentCommandSchema);if(request.headers.get('idempotency-key')!==body.operationId)throw new AppError('INVALID_REQUEST');return {data:await d.store.execute(actor,body)};
  }catch(e){if(e instanceof AppError)throw e;if(e instanceof FishingProgramError)throw new AppError(['POLICY_REQUIRED','APPROVAL_REQUIRED','CAPACITY'].includes(e.code)?'CONFLICT':e.code as 'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'INVALID_REQUEST'|'UNAVAILABLE');throw new AppError('UNAVAILABLE');}
 });}catch(e){const r=failureResponse(e instanceof AppError?e:new AppError('UNAVAILABLE'),randomUUID());r.headers.set('Cache-Control','private, no-store');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return r;}
}
