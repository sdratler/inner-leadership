import { AppError } from '../../lib/errors.ts';
import { newRequestId } from '../../lib/ids.ts';
import { failureResponse,readJson,successResponse } from '../../lib/http/json.ts';
import { SESSION_COOKIE } from '../../lib/security/session.ts';
import { verifyCsrfToken,verifyMutationOrigin } from '../../lib/security/csrf.ts';
import { enforceRateLimit,opaqueRateLimitKey } from '../../lib/security/rate-limit.ts';
import { writeAudit,type AuditSink } from '../../lib/audit.ts';
import { TOKEN_PATTERN } from '../identity/crypto.ts';
import type { Actor } from '../identity/types.ts';
import { allocationSchema,chargeSchema,overviewQuery,paymentSchema,refundSchema } from './validation.ts';
import { paymentsRuntime } from './runtime.ts';
function sessionToken(headers:Headers):string{const values=(headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+'='));if(values.length!==1)throw new AppError('UNAUTHENTICATED');const token=values[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');return token;}
function query(request:Request):{caseId:string}{const values=new URL(request.url).searchParams;if([...values.keys()].some(key=>key!=='caseId')||values.getAll('caseId').length!==1)return {caseId:''};return {caseId:values.get('caseId')??''};}
/** Private, same-origin payments surface. No card processor or background renewal is reachable here. */
export async function handlePayments(request:Request,path:readonly string[]):Promise<Response>{
 const requestId=newRequestId();let actor:Actor|null=null,audit:AuditSink|null=null;
 try{
  if(path.length!==1||path[0]!.length>60||!['GET','POST'].includes(request.method))throw new AppError('NOT_FOUND');
  const {identity,service}=await paymentsRuntime(),token=sessionToken(request.headers);if(request.method!=='GET')verifyMutationOrigin(request,identity.config.origin);
  actor=await identity.services.sessions.actor(token);audit=identity.services.audit;if(actor.role==='adult_client')throw new AppError('NOT_FOUND');
  if(request.method!=='GET')verifyCsrfToken(request.headers.get('x-csrf-token'),identity.services.sessions.csrf(token));
  await enforceRateLimit(identity.services.limits,opaqueRateLimitKey(`payments:${actor.workspaceId}:${actor.id}:${request.method}`,identity.config.rateLimitKey),request.method==='GET'?120:40,60_000);
  let data:unknown;
  if(request.method==='GET'&&path[0]==='overview'){const parsed=overviewQuery.safeParse(query(request));if(!parsed.success)throw new AppError('INVALID_REQUEST');data=await service.overview(actor,parsed.data.caseId);}
  else{
   const key=request.headers.get('idempotency-key')??'';
   if(path[0]==='charges')data=await service.createCharge(actor,key,await readJson(request,chargeSchema));
   else if(path[0]==='payments')data=await service.recordPayment(actor,key,await readJson(request,paymentSchema));
   else if(path[0]==='allocations')data=await service.allocate(actor,key,await readJson(request,allocationSchema));
   else if(path[0]==='refunds')data=await service.refund(actor,key,await readJson(request,refundSchema));
   else throw new AppError('NOT_FOUND');
  }
  const response=successResponse(data,requestId);response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');return response;
 }catch(error){let normalized=error instanceof AppError?error:new AppError('INTERNAL');if(actor&&audit&&['FORBIDDEN','NOT_FOUND','UNAUTHENTICATED'].includes(normalized.code)){try{await writeAudit(audit,{eventId:newRequestId(),requestId,workspaceId:actor.workspaceId,actorAccountId:actor.id,kind:'access_denied',outcome:'denied',occurredAt:new Date().toISOString()});}catch{normalized=new AppError('UNAVAILABLE');}}const response=failureResponse(normalized,requestId);response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');return response;}
}
