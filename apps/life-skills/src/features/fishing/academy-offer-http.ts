import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {readJson,failureResponse} from '../../lib/http/json.ts';
import {Ls050HttpBoundary,type Ls050HttpRuntime} from '../forms/http-boundary.ts';
import {FishingProgramError} from './native-program-contract.ts';
import type {AcademyOfferStore} from './academy-offer-store.ts';
import {academyOfferCommandSchema} from './academy-offer-contract.ts';
const endpoint='/api/private/group-applications/offer',querySchema=z.strictObject({applicationId:z.uuid(),learnerIndex:z.string().regex(/^[0-9]$/).transform(Number),stageId:z.uuid()});
export async function academyOfferHttp(request:Request,load:()=>Promise<{runtime:Ls050HttpRuntime;store:Pick<AcademyOfferStore,'context'|'execute'>}>){
 try{const d=await load();return await new Ls050HttpBoundary(d.runtime).handle(request,['GET','POST'],async(actor,_id,url)=>{
  try{if(url.pathname!==endpoint)throw new AppError('NOT_FOUND');if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');
   if(request.method==='GET'){if(url.searchParams.size!==3)throw new AppError('INVALID_REQUEST');const query=querySchema.safeParse(Object.fromEntries(url.searchParams));if(!query.success)throw new AppError('INVALID_REQUEST');return {data:await d.store.context(actor,query.data.applicationId,query.data.learnerIndex,query.data.stageId)};}
   if(url.search)throw new AppError('INVALID_REQUEST');const body=await readJson(request,academyOfferCommandSchema);if(request.headers.get('idempotency-key')!==body.operationId)throw new AppError('INVALID_REQUEST');return {data:await d.store.execute(actor,body)};
  }catch(e){if(e instanceof AppError)throw e;if(e instanceof FishingProgramError)throw new AppError(['POLICY_REQUIRED','APPROVAL_REQUIRED','CAPACITY'].includes(e.code)?'CONFLICT':e.code as 'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'INVALID_REQUEST'|'UNAVAILABLE');throw new AppError('UNAVAILABLE');}
 });}catch(e){const r=failureResponse(e instanceof AppError?e:new AppError('UNAVAILABLE'),randomUUID());r.headers.set('Cache-Control','private, no-store');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return r;}
}
