import { AppError } from '../../lib/errors.ts';
import { writeAudit, type AuditSink } from '../../lib/audit.ts';
import type { Actor } from '../identity/types.ts';
import { asId, newRequestId } from '../../lib/ids.ts';
import { readJson, successResponse, failureResponse } from '../../lib/http/json.ts';
import { SESSION_COOKIE } from '../../lib/security/session.ts';
import { verifyMutationOrigin, verifyCsrfToken } from '../../lib/security/csrf.ts';
import { enforceRateLimit, opaqueRateLimitKey } from '../../lib/security/rate-limit.ts';
import { TOKEN_PATTERN } from '../identity/crypto.ts';
import { calendarRuntime } from './runtime.ts';
import { drainCalendarEventsIsolated } from './relay.ts';
import { applyCalendarCreditEffect } from '../payments/calendar-consumer.ts';
import { availabilitySchema, attendanceSchema, bookingSchema, exceptionSchema, listSchema, logisticsSchema, manualNoticeSchema, noticeSchema, replacementSchema, versionSchema } from './validation.ts';
import type { z } from 'zod';
export function routeId<K extends string>(value:string,kind:K){try{return asId(value,kind);}catch{throw new AppError('INVALID_REQUEST');}}
export function sessionToken(headers:Headers):string {
 const cookies=(headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+'='));
 if(cookies.length!==1)throw new AppError('UNAUTHENTICATED');
 const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
 if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');return token;
}
function query(request:Request,allowed:readonly string[]):Record<string,string|null>{
 const p=new URL(request.url).searchParams,result:Record<string,string|null>={};
 for(const [k] of p){if(!allowed.includes(k)||p.getAll(k).length!==1)throw new AppError('INVALID_REQUEST');}
 for(const k of allowed)result[k]=p.get(k);return result;
}
function readQuery<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new AppError('INVALID_REQUEST');return result.data;}
/** All mutations pass through shared origin, session, CSRF and distributed rate-limit gates. */
export async function handleCalendar(request:Request,path:readonly string[]):Promise<Response>{
 const requestId=newRequestId();
 let verifiedActor:Actor|null=null,audit:AuditSink|null=null;
 try {
  if(path.length>3||path.some(s=>s.length>60))throw new AppError('NOT_FOUND');
  if(request.method!=='GET' && request.method!=='POST' && request.method!=='PATCH')throw new AppError('NOT_FOUND');
  // Capture the complete valid notice body now, before session/rate-limit/transaction latency.
  // Header arrival is NOT a received notice; neither client clocks nor forwarded timestamp headers are trusted.
  let earlyNotice:z.infer<typeof noticeSchema>|null=null,receivedAt:Date|null=null;
  if(request.method==='POST' && path[0]==='appointments' && path[2]==='notice'){
   earlyNotice=await readJson(request,noticeSchema);receivedAt=new Date();
  }
  const {identity,service}=await calendarRuntime(),token=sessionToken(request.headers);
  if(request.method!=='GET')verifyMutationOrigin(request,identity.config.origin);
  const actor=await identity.services.sessions.actor(token);verifiedActor=actor;audit=identity.services.audit;
  if(actor.role==='adult_client')throw new AppError('FORBIDDEN');
  if(request.method!=='GET')verifyCsrfToken(request.headers.get('x-csrf-token'),identity.services.sessions.csrf(token));
  await enforceRateLimit(identity.services.limits,opaqueRateLimitKey(`calendar:${actor.workspaceId}:${actor.id}:${request.method==='GET'?'read':'write'}`,identity.config.rateLimitKey),request.method==='GET'?240:60,60_000);
  const key=request.headers.get('idempotency-key')??'';
  let data:unknown;
  if(request.method==='GET'&&path.length===1&&path[0]==='appointments'){
   data=await service.list(actor,readQuery(listSchema,query(request,['from','to','caseId','cursor'])));
  }else if(request.method==='GET'&&path.length===2&&path[0]==='appointments'){
   query(request,[]);data=await service.get(actor,routeId(path[1]!,'appointment'));
  }else if(request.method==='POST'&&path.length===1&&path[0]==='appointments'){
   data=await service.create(actor,key,await readJson(request,bookingSchema));
  }else if(path[0]==='appointments'&&path.length===3){
   const id=routeId(path[1]!,'appointment'),action=path[2];
   if(request.method==='POST'&&action==='notice'&&earlyNotice&&receivedAt)data=await service.receiveNotice(actor,id,key,earlyNotice,receivedAt);
   else if(request.method==='POST'&&action==='manual-notice')data=await service.receiveManualNotice(actor,id,key,await readJson(request,manualNoticeSchema));
   else if(request.method==='POST'&&action==='replacement')data=await service.confirmReplacement(actor,id,key,await readJson(request,replacementSchema));
   else if(request.method==='POST'&&action==='close-request')data=await service.closeRequest(actor,id,key,(await readJson(request,versionSchema)).expectedVersion);
   else if(request.method==='POST'&&action==='exception')data=await service.grantException(actor,id,key,await readJson(request,exceptionSchema));
   else if(request.method==='POST'&&action==='provider-cancel')data=await service.cancelProvider(actor,id,key,await readJson(request,exceptionSchema));
   else if(request.method==='POST'&&action==='attendance')data=await service.recordAttendance(actor,id,key,await readJson(request,attendanceSchema));
   else if(request.method==='PATCH'&&action==='logistics')data=await service.logistics(actor,id,key,await readJson(request,logisticsSchema));
   else if(request.method==='GET'&&action==='attendance-history'){
    const q=query(request,['beforeVersion']);const v=q.beforeVersion===null?null:Number(q.beforeVersion);
    if(v!==null && (!Number.isSafeInteger(v)||v<1))throw new AppError('INVALID_REQUEST');data=await service.attendanceHistory(actor,id,v);
   }else throw new AppError('NOT_FOUND');
  }else if(request.method==='GET'&&path.length===1&&path[0]==='catalog'){
   const q=query(request,['caseId']);data=await service.catalog(actor,routeId(q.caseId??'','case'));
  }else if(request.method==='GET'&&path.length===1&&path[0]==='attendance-count'){
   const q=query(request,['caseId']);data=await service.childAttendanceCount(actor,routeId(q.caseId??'','case'));
  }else if(path.length===1&&path[0]==='availability'&&request.method==='GET'){
   const q=query(request,['from','to']);data=await service.availability(actor,q.from??'',q.to??'');
  }else if(path.length===1&&path[0]==='availability'&&request.method==='POST'){
   data=await service.addAvailability(actor,key,await readJson(request,availabilitySchema));
  }else if(path.length===3&&path[0]==='availability'&&path[2]==='remove'&&request.method==='POST'){
   data=await service.removeAvailability(actor,key,routeId(path[1]!,'calendar_availability'),(await readJson(request,versionSchema)).expectedVersion);
  }else throw new AppError('NOT_FOUND');
  // The command is already committed. Delivery cannot turn that success into a
  // false rollback response. Pending events and neutral retry state are durable.
  let delivery:'attempted'|'deferred'|null=null;
  if(request.method!=='GET'){
   try{
    const retryAppointmentId=path[0]==='appointments'&&path.length===3?path[1]!:null;
    const result=await service.db.read(actor,c=>drainCalendarEventsIsolated(c,'credit_effect',applyCalendarCreditEffect,25,retryAppointmentId));
    delivery=result.deferred>0?'deferred':'attempted';
   }catch{delivery='deferred';} // An unavailable database leaves the outbox intact.
  }
  const response=successResponse(data,requestId);if(delivery&&actor.role==='practitioner')response.headers.set('X-Life-Skills-Credit-Delivery',delivery);
  response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');return response;
 }catch(error){
  let normalized=error instanceof AppError?error:new AppError('INTERNAL');
  if(verifiedActor&&audit&&['FORBIDDEN','NOT_FOUND','UNAUTHENTICATED'].includes(normalized.code)){
   try{await writeAudit(audit,{eventId:newRequestId(),requestId,workspaceId:verifiedActor.workspaceId,actorAccountId:verifiedActor.id,kind:'access_denied',outcome:'denied',occurredAt:new Date().toISOString()});}
   catch{normalized=new AppError('UNAVAILABLE');}
  }
  // Only verified identity IDs enter the shared durable audit. No body, cookie, location, request URL or SQL.
  const response=failureResponse(normalized,requestId);response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');return response;
 }
}
