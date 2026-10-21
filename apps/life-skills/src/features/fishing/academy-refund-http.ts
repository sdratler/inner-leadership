import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {readJson,failureResponse} from '../../lib/http/json.ts';
import {Ls050HttpBoundary,type Ls050HttpRuntime} from '../forms/http-boundary.ts';
import {FishingProgramError} from './native-program-contract.ts';
import {academyRefundUiQuerySchema,academyRefundUiCommandSchema} from './academy-refund-ui-contract.ts';
import type {AcademyRefundStore} from './academy-refund-store.ts';
const endpoint='/api/private/group-applications/refunds';
export async function academyRefundHttp(request:Request,load:()=>Promise<{runtime:Ls050HttpRuntime;store:Pick<AcademyRefundStore,'context'|'execute'>}>){
 try{const d=await load();return await new Ls050HttpBoundary(d.runtime).handle(request,['GET','POST'],async(actor,_id,url)=>{
  try{if(url.pathname!==endpoint)throw new AppError('NOT_FOUND');if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');
   if(request.method==='GET'){const query=academyRefundUiQuerySchema.safeParse(Object.fromEntries(url.searchParams));if(!query.success||url.searchParams.size!==1)throw new AppError('INVALID_REQUEST');return {data:await d.store.context(actor,query.data.applicationId)};}
   if(url.search)throw new AppError('INVALID_REQUEST');const command=await readJson(request,academyRefundUiCommandSchema);if(request.headers.get('idempotency-key')!==command.operationId)throw new AppError('INVALID_REQUEST');return {data:await d.store.execute(actor,command)};
  }catch(e){if(e instanceof AppError)throw e;if(e instanceof FishingProgramError)throw new AppError(['APPROVAL_REQUIRED','POLICY_REQUIRED','CAPACITY'].includes(e.code)?'CONFLICT':e.code as 'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'INVALID_REQUEST'|'UNAVAILABLE');throw new AppError('UNAVAILABLE');}
 });}catch(e){const r=failureResponse(e instanceof AppError?e:new AppError('UNAVAILABLE'),randomUUID());r.headers.set('Cache-Control','private, no-store');r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return r;}
}
