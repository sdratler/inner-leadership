import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { newRequestId,asId } from "../../lib/ids.ts";
import { successResponse,failureResponse,readJson } from "../../lib/http/json.ts";
import { SESSION_COOKIE,sessionCookieOptions } from "../../lib/security/session.ts";
import { verifyMutationOrigin,verifyCsrfToken } from "../../lib/security/csrf.ts";
import { enforceRateLimit,opaqueRateLimitKey,type RateLimitStore } from "../../lib/security/rate-limit.ts";
import type { AuditSink } from "../../lib/audit.ts";
import { writeAudit } from "../../lib/audit.ts";
import { visibilityValues } from "../../lib/visibility.ts";
import { caseLifecycleValues } from "../cases/policy.ts";
import { TOKEN_PATTERN,csrfSecret,canonicalEmail } from "./crypto.ts";
import { notificationEvents,notificationChannels,type Actor, type IdentityClock } from "./types.ts";
import type { IdentityConfig } from "./config.ts";
import type { IdentityAuthService } from "./auth-service.ts";
import type { IdentityAccountService } from "./account-service.ts";
import type { IdentityPreferenceService } from "./preferences.ts";
import type { IdentitySessions } from "./session-adapter.ts";
import type { CaseService } from "../cases/service.ts";
const PREAUTH_COOKIE='__Host-ls-preauth';
const email=z.string().email().max(254).transform(canonicalEmail);
const password=z.string().min(1).max(512);
const newPassword=z.string().min(15).max(512);
const token=z.string().regex(TOKEN_PATTERN);
const locale=z.enum(['he','en']);
const caseId=z.string().uuid().transform(v=>asId(v,'case'));
const accountId=z.string().uuid().transform(v=>asId(v,'account'));
const audienceId=z.string().uuid().transform(v=>asId(v,'audience'));
const boundedLabel=z.string().trim().min(1).max(160);
const preference=z.object({eventType:z.enum(notificationEvents),channel:z.enum(notificationChannels),enabled:z.boolean(),locale,
 timezone:z.string().min(1).max(80),quietStart:z.string().nullable(),quietEnd:z.string().nullable()}).strict();
const invite=z.object({caseId,email,displayName:boundedLabel,locale}).strict();
export const identityRouteMethods=Object.freeze({
 '/api/identity/csrf':['GET'], '/api/identity/login':['POST'], '/api/identity/reset/request':['POST'],
 '/api/identity/reset/complete':['POST'], '/api/identity/invites/accept':['POST'], '/api/identity/email/confirm':['POST'],
 '/api/identity/session':['GET'], '/api/identity/logout':['POST'], '/api/identity/logout-all':['POST'],
 '/api/identity/preferences':['GET','PUT'], '/api/identity/contacts':['GET'], '/api/identity/contacts/email':['POST'],
 '/api/identity/contacts/phone':['PUT'], '/api/identity/cases':['GET','POST'], '/api/identity/cases/state':['PATCH'],
 '/api/identity/invites/parent':['POST'], '/api/identity/invites/adult':['POST'], '/api/identity/guardians/revoke':['POST'],
 '/api/identity/accounts/revoke':['POST'], '/api/identity/engagements':['POST'], '/api/identity/audiences':['GET','POST'],
} satisfies Record<string,readonly string[]>);
const publicPosts=new Set(['/api/identity/login','/api/identity/reset/request','/api/identity/reset/complete','/api/identity/invites/accept','/api/identity/email/confirm']);
function cookie(request:Request,name:string):string|undefined {
 const matches=(request.headers.get('cookie') ?? '').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
 if(matches.length!==1) return undefined;
 const value=matches[0]!.slice(name.length+1);return TOKEN_PATTERN.test(value)?value:undefined;
}
function attachCookie(response:Response,name:string,value:string,seconds:number):void {
 const options=sessionCookieOptions(seconds);
 response.headers.append('Set-Cookie',`${name}=${value}; Path=${options.path}; Max-Age=${options.maxAge}; HttpOnly; Secure; SameSite=Lax`);
}
function secure(response:Response):Response {
 response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;
}
export interface IdentityHttpServices {
 auth:IdentityAuthService;accounts:IdentityAccountService;preferences:IdentityPreferenceService;sessions:IdentitySessions;cases:CaseService;
 limits:RateLimitStore;audit:AuditSink;
}
export class IdentityHttp {
 constructor(private readonly config:IdentityConfig,private readonly clock:IdentityClock,private readonly services:IdentityHttpServices,
  /** Return only a server/platform-attested network identifier. Never pass raw X-Forwarded-For. */
  private readonly trustedNetworkHint:(request:Request)=>string=()=> 'unattributed-shared-network'){}
 private limit(subject:string,maximum:number,windowMs=900000):Promise<void> {
  return enforceRateLimit(this.services.limits,opaqueRateLimitKey(subject,this.config.rateLimitKey),maximum,windowMs);
 }
 async handle(request:Request):Promise<Response> {
  const requestId=newRequestId();let actor:Actor|undefined;
  try{
   if(!this.config.enabled) throw new AppError("UNAVAILABLE");
   const url=new URL(request.url),path=url.pathname;
   const methods=(identityRouteMethods as Record<string,readonly string[]>)[path];
   if(!methods || !methods.includes(request.method)) throw new AppError("NOT_FOUND");
   if(url.origin!==this.config.origin || (url.search && !(path==='/api/identity/audiences' && request.method==='GET'))) throw new AppError("INVALID_REQUEST");
   const network=this.trustedNetworkHint(request);
   if(typeof network!=='string' || network.length<1 || network.length>128) throw new AppError("UNAVAILABLE");
   await this.limit('network:'+network,200);
   if(path==='/api/identity/csrf'){
    if(request.headers.get('origin') && request.headers.get('origin')!==this.config.origin) throw new AppError("FORBIDDEN");
    const created=await this.services.auth.preauth();const response=successResponse({csrfToken:created.csrf},requestId);
    attachCookie(response,PREAUTH_COOKIE,created.token,900);return secure(response);
   }
   if(request.method!=='GET') verifyMutationOrigin(request,this.config.origin);
   if(publicPosts.has(path)){
    const preauth=cookie(request,PREAUTH_COOKIE);if(!preauth) throw new AppError("FORBIDDEN");
    verifyCsrfToken(request.headers.get('x-csrf-token'),csrfSecret(preauth,this.config.csrfKey,'preauth'));
    await this.services.auth.assertPreauth(preauth);
    if(path==='/api/identity/login'){
     const input=await readJson(request,z.object({email,password}).strict());
     await this.limit('login-email:'+input.email,10);await this.limit('login-network:'+network,30);
     const result=await this.services.auth.login(input.email,input.password,preauth,requestId);
     const response=successResponse({expiresAt:result.expiresAt,csrfToken:this.services.sessions.csrf(result.token)},requestId);
     attachCookie(response,SESSION_COOKIE,result.token,this.config.sessionSeconds);attachCookie(response,PREAUTH_COOKIE,'',0);return secure(response);
    }
    if(path==='/api/identity/reset/request'){
     const input=await readJson(request,z.object({email}).strict());await this.limit('reset-email:'+input.email,5,3600000);
     await this.services.auth.requestReset(input.email,requestId);return secure(successResponse({accepted:true},requestId,202));
    }
    if(path==='/api/identity/email/confirm'){
     const input=await readJson(request,z.object({token}).strict());await this.limit('consume:'+input.token,5);await this.limit('consume-network:'+network,20);
     await this.services.auth.confirmEmailChange(input.token,requestId);
    }else{
     const input=await readJson(request,z.object({token,password:newPassword}).strict());await this.limit('consume:'+input.token,5);await this.limit('consume-network:'+network,20);
     await this.services.auth.consumePasswordToken(path==='/api/identity/invites/accept'?'invite':'reset',input.token,input.password,requestId);
    }
    const response=successResponse({accepted:true,signInRequired:true},requestId);attachCookie(response,SESSION_COOKIE,'',0);attachCookie(response,PREAUTH_COOKIE,'',0);return secure(response);
   }
   const sessionToken=cookie(request,SESSION_COOKIE);if(!sessionToken) throw new AppError("UNAUTHENTICATED");
   actor=await this.services.sessions.actor(sessionToken);
   if(request.method!=='GET') verifyCsrfToken(request.headers.get('x-csrf-token'),this.services.sessions.csrf(sessionToken));
   await this.limit('account:'+actor.id,150);
   let data:unknown={accepted:true};
   if(path==='/api/identity/session') data={accountId:actor.id,role:actor.role,locale:actor.locale,expiresAt:new Date(actor.expiresAt).toISOString(),csrfToken:this.services.sessions.csrf(sessionToken)};
   else if(path==='/api/identity/logout' || path==='/api/identity/logout-all'){
    await readJson(request,z.object({}).strict());await this.services.auth.logout(actor,requestId,path.endsWith('logout-all'));
    const response=successResponse(data,requestId);attachCookie(response,SESSION_COOKIE,'',0);return secure(response);
   }else if(path==='/api/identity/preferences'){
    if(request.method==='GET') data=await this.services.preferences.list(actor,actor.id);
    else{const input=await readJson(request,z.object({preferences:z.array(preference).min(1).max(16)}).strict());await this.services.preferences.replace(actor,actor.id,input.preferences,requestId);}
   }else if(path==='/api/identity/contacts') data=await this.services.preferences.contacts(actor);
   else if(path==='/api/identity/contacts/email'){
    const input=await readJson(request,z.object({email,currentPassword:password}).strict());await this.limit('reauth:'+actor.id,10);
    await this.services.auth.requestEmailChange(actor,input.email,input.currentPassword,requestId);
   }else if(path==='/api/identity/contacts/phone'){
    const input=await readJson(request,z.object({phone:z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable(),currentPassword:password}).strict());await this.limit('reauth:'+actor.id,10);
    const verifiedHash=await this.services.auth.verifyCurrentPassword(actor,input.currentPassword);
    await this.services.preferences.setUnverifiedPhone(actor,input.phone,verifiedHash,requestId);
   }else if(path==='/api/identity/cases'){
    if(request.method==='GET') data=await this.services.cases.list(actor);
    else{
     const input=await readJson(request,z.object({kind:z.enum(['minor','adult']),displayName:boundedLabel,familyLabel:boundedLabel,familyId:z.string().uuid().transform(v=>asId(v,'family')).optional()}).strict());
     data=await this.services.cases.create(actor,{kind:input.kind,displayName:input.displayName,familyLabel:input.familyLabel,...(input.familyId?{familyId:input.familyId}:{})},requestId);
    }
   }else if(path==='/api/identity/cases/state'){
    const input=await readJson(request,z.object({caseId,state:z.enum(caseLifecycleValues)}).strict());await this.services.cases.changeState(actor,input.caseId,input.state,requestId);
   }else if(path==='/api/identity/invites/parent') data=await this.services.accounts.inviteParent(actor,await readJson(request,invite),requestId);
   else if(path==='/api/identity/invites/adult') data=await this.services.accounts.inviteAdult(actor,await readJson(request,invite),requestId);
   else if(path==='/api/identity/guardians/revoke'){
    const input=await readJson(request,z.object({caseId,accountId}).strict());await this.services.accounts.revokeGuardian(actor,input.caseId,input.accountId,requestId);
   }else if(path==='/api/identity/accounts/revoke'){
    const input=await readJson(request,z.object({accountId}).strict());await this.services.accounts.revokeAccount(actor,input.accountId,requestId);
   }else if(path==='/api/identity/engagements'){
    const input=await readJson(request,z.object({caseId,rateMinor:z.number().int().min(0).max(2147483647),attendedReviewTarget:z.number().int().min(1).max(100)}).strict());
    data=await this.services.cases.createEngagement(actor,input.caseId,input,requestId);
   }else if(path==='/api/identity/audiences'){
    if(request.method==='GET'){
     if([...url.searchParams.keys()].length!==2 || !url.searchParams.has('caseId') || !url.searchParams.has('audienceId')) throw new AppError("INVALID_REQUEST");
     const parsed=z.object({caseId,audienceId}).safeParse(Object.fromEntries(url.searchParams));if(!parsed.success) throw new AppError("INVALID_REQUEST");
     data=await this.services.cases.audience(actor,parsed.data.caseId,parsed.data.audienceId);
    }else{
     const input=await readJson(request,z.object({caseId,visibility:z.enum(visibilityValues),published:z.boolean(),accountIds:z.array(accountId).max(2).optional()}).strict());
     data=await this.services.cases.createAudience(actor,input.caseId,{visibility:input.visibility,published:input.published,...(input.accountIds?{accountIds:input.accountIds}:{})},requestId);
    }
   }else throw new AppError("NOT_FOUND");
   return secure(successResponse(data,requestId));
  }catch(error){
   // Store only neutral event metadata. Never serialize the Request, URL, body or thrown error.
   if(error instanceof AppError && ['NOT_FOUND','FORBIDDEN','UNAUTHENTICATED'].includes(error.code) && actor){
    try{await writeAudit(this.services.audit,{eventId:randomUUID(),workspaceId:actor.workspaceId,actorAccountId:actor.id,requestId,kind:'access_denied',outcome:'denied',occurredAt:this.clock.now().toISOString()});}
    catch{return secure(failureResponse(new AppError('UNAVAILABLE'),requestId));}
   }
   return secure(failureResponse(error,requestId));
  }
 }
}
