import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {failureResponse,readJson,successResponse} from '../../lib/http/json.ts';
import {verifyMutationOrigin,verifyCsrfToken} from '../../lib/security/csrf.ts';
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from '../../lib/security/rate-limit.ts';
import {SESSION_COOKIE} from '../../lib/security/session.ts';
import {TOKEN_PATTERN} from '../identity/crypto.ts';
import type {Actor} from '../identity/types.ts';
import {canonicalForwardedRequest} from '../integration/canonical-forwarded-request.ts';
import {bnaOptionalCommand,bnaOptionalPrepare} from './optional-calendar-contract.ts';
import type {BnaOptionalCalendarStore} from './optional-calendar-store.ts';
type Deps={enabled:boolean;origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<BnaOptionalCalendarStore,'readOwner'|'prepare'|'command'>};
export async function privateBnaOptionalCalendarHttp(request:Request,load:()=>Promise<Deps>){
 const requestId=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(SESSION_COOKIE+'='));
  if(cookies.length!==1)throw new AppError('UNAUTHENTICATED');const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
  if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');
  const d=await load();if(!d.enabled)throw new AppError('NOT_FOUND');const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=='/api/private/bna-optional-calendar'||url.hash)throw new AppError('NOT_FOUND');const actor=await d.actor(token);
  if(request.method==='GET'){
   if([...url.searchParams.keys()].join()!=='id'||url.searchParams.getAll('id').length!==1)throw new AppError('INVALID_REQUEST');
   const id=z.uuid().safeParse(url.searchParams.get('id'));if(!id.success)throw new AppError('INVALID_REQUEST');
   response=successResponse(await d.store.readOwner(actor,id.data),requestId);
  }else{
   if(request.method!=='POST'||url.search)throw new AppError('INVALID_REQUEST');
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),d.csrf(token));
   await enforceRateLimit(d.limits,opaqueRateLimitKey(`bna-optional-owner:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60000);
   const command=await readJson(request,z.union([bnaOptionalPrepare,bnaOptionalCommand]));
   response=successResponse(command.action==='prepare'?await d.store.prepare(actor,command):await d.store.command(actor,command),requestId);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;
}
