import {AppError} from '../../lib/errors.ts';
import {asId,newRequestId} from '../../lib/ids.ts';
import {failureResponse,readJson,successResponse} from '../../lib/http/json.ts';
import {SESSION_COOKIE} from '../../lib/security/session.ts';
import {verifyMutationOrigin,verifyCsrfToken} from '../../lib/security/csrf.ts';
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from '../../lib/security/rate-limit.ts';
import {canonicalForwardedRequest} from '../integration/canonical-forwarded-request.ts';
import {TOKEN_PATTERN} from '../identity/crypto.ts';
import type {IdentityConfig} from '../identity/config.ts';
import type {IdentitySessions} from '../identity/session-adapter.ts';
import type {PracticeReminderService} from './service.ts';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {writeAudit,type AuditSink} from '../../lib/audit.ts';
import type {Actor,IdentityClock} from '../identity/types.ts';
type Ports={sessions:Pick<IdentitySessions,'actor'|'csrf'>;limits:RateLimitStore;audit:AuditSink;service:Pick<PracticeReminderService,'list'|'markRead'>};
export function secureReminderResponse(response:Response):Response{
 response.headers.set('Cache-Control','private, no-store');response.headers.set('Vary','Cookie');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;
}
export class ReminderHttp{
 constructor(private readonly config:IdentityConfig,private readonly clock:IdentityClock,private readonly ports:Ports){}
 async handle(inbound:Request,path:readonly string[]):Promise<Response>{
  const requestId=newRequestId();let response:Response,actor:Actor|undefined;
  try{
   if(!this.config.enabled)throw new AppError('UNAVAILABLE');
   const request=inbound.headers.has('x-forwarded-proto')||inbound.headers.has('x-forwarded-host')?canonicalForwardedRequest(inbound,this.config.origin):inbound;
   const url=new URL(request.url);if(url.origin!==this.config.origin||url.hash)throw new AppError('INVALID_REQUEST');
   const read=request.method==='GET'&&path.length===0,mark=request.method==='PATCH'&&path.length===2&&path[1]==='read';if(!read&&!mark)throw new AppError('NOT_FOUND');
   for(const [key]of url.searchParams)if(!read||key!=='cursor'||url.searchParams.getAll(key).length!==1)throw new AppError('INVALID_REQUEST');
   const cookies=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(SESSION_COOKIE+'='));
   if(cookies.length!==1||!TOKEN_PATTERN.test(cookies[0]!.slice(SESSION_COOKIE.length+1)))throw new AppError('UNAUTHENTICATED');
   const token=cookies[0]!.slice(SESSION_COOKIE.length+1);actor=await this.ports.sessions.actor(token);
   if(actor.workspaceId!==this.config.workspaceId)throw new AppError('NOT_FOUND');
   if(actor.role==='child'&&!this.config.childAccountsEnabled)throw new AppError('FORBIDDEN');
   if(mark){verifyMutationOrigin(request,this.config.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),this.ports.sessions.csrf(token));}
   await enforceRateLimit(this.ports.limits,opaqueRateLimitKey(`account:${actor.id}`,this.config.rateLimitKey),150,900000);
   let data:unknown;
   if(read)data=await this.ports.service.list(actor,url.searchParams.get('cursor'));
   else{let id:string;try{id=asId(path[0]!,'notification');}catch{throw new AppError('INVALID_REQUEST');}await readJson(request,z.object({}).strict());data=await this.ports.service.markRead(actor,id);}
   response=successResponse(data,requestId);
  }catch(error){
   if(actor&&error instanceof AppError&&['NOT_FOUND','FORBIDDEN','UNAUTHENTICATED'].includes(error.code)){
    try{await writeAudit(this.ports.audit,{eventId:randomUUID(),workspaceId:actor.workspaceId,actorAccountId:actor.id,requestId,kind:'access_denied',outcome:'denied',occurredAt:this.clock.now().toISOString()});}
    catch{return secureReminderResponse(failureResponse(new AppError('UNAVAILABLE'),requestId));}
   }
   response=failureResponse(error,requestId);
  }
  return secureReminderResponse(response);
 }
}
