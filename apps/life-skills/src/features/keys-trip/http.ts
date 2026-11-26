import 'server-only';
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {failureResponse,readJson,successResponse} from '../../lib/http/json.ts';
import {verifyMutationOrigin,verifyCsrfToken} from '../../lib/security/csrf.ts';
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from '../../lib/security/rate-limit.ts';
import {SESSION_COOKIE} from '../../lib/security/session.ts';
import {canonicalForwardedRequest} from '../integration/canonical-forwarded-request.ts';
import {opaqueToken,TOKEN_PATTERN} from '../identity/crypto.ts';
import type {Actor} from '../identity/types.ts';
import {reviewCursorSchema} from '../group-application/store.ts';
import {keysCommandSchema,keysOwnerUpdateSchema,KEYS_TRIP,KEYS_INTEREST_VERSION,KEYS_CONSENT} from './contract.ts';
import type {KeysInterestStore} from './store.ts';

const PUBLIC_PATH='/api/public/keys-interest',PRIVATE_PATH='/api/private/keys-interest',COOKIE='ls_keys_interest';
const submissionSchema=keysCommandSchema.extend({challenge:z.string().min(80).max(1024),website:z.literal('')}).strict();
const challengeSchema=z.object({v:z.literal(1),trip:z.literal(KEYS_TRIP.id),consent:z.literal(KEYS_CONSENT.version),continuation:z.string().regex(/^[a-f0-9]{64}$/),issuedAt:z.number().int().nonnegative()}).strict();
function hmac(key:string,value:string,format:'hex'|'base64url'='base64url'){return createHmac('sha256',key).update(value).digest(format);}
function cookie(request:Request,name:string){const values=(request.headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'='));if(values.length>1)throw new AppError('INVALID_REQUEST');const token=values[0]?.slice(name.length+1);if(token&&!TOKEN_PATTERN.test(token))throw new AppError('INVALID_REQUEST');return token;}
function challenge(key:string,token:string,now:number){const body=Buffer.from(JSON.stringify({v:1,trip:KEYS_TRIP.id,consent:KEYS_CONSENT.version,continuation:hmac(key,'keys-continuation:'+token,'hex'),issuedAt:now})).toString('base64url');return body+'.'+hmac(key,'keys-challenge:'+body);}
function verifyChallenge(value:string,key:string,token:string|undefined,now:number){
 try{if(!token)throw new Error();const parts=value.split('.');if(parts.length!==2||!parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part)))throw new Error();const expected=hmac(key,'keys-challenge:'+parts[0]);if(parts[1]!.length!==expected.length||!timingSafeEqual(Buffer.from(parts[1]!),Buffer.from(expected)))throw new Error();const decoded=Buffer.from(parts[0]!,'base64url');if(decoded.toString('base64url')!==parts[0])throw new Error();const payload=challengeSchema.parse(JSON.parse(decoded.toString('utf8')));if(payload.continuation!==hmac(key,'keys-continuation:'+token,'hex')||payload.issuedAt>now||now-payload.issuedAt>30*60_000)throw new Error();}catch{throw new AppError('FORBIDDEN');}
}
function harden(response:Response){response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;}
export type KeysPublicDependencies={enabled:boolean;origin:string;challengeKey:string;now:()=>number;limits:RateLimitStore;store:Pick<KeysInterestStore,'submit'>};
export async function keysInterestHttp(request:Request,load:()=>Promise<KeysPublicDependencies>){
 const requestId=randomUUID();let response:Response;
 try{
  const d=await load();if(!d.enabled)throw new AppError('NOT_FOUND');const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.pathname!==PUBLIC_PATH||url.search||!['GET','POST'].includes(request.method))throw new AppError('NOT_FOUND');
  const token=cookie(request,COOKIE);
  if(request.method==='GET'){
   const continuation=token??opaqueToken();response=successResponse({trip:KEYS_TRIP,consent:KEYS_CONSENT,version:KEYS_INTEREST_VERSION,challenge:challenge(d.challengeKey,continuation,d.now())},requestId);
   if(!token)response.headers.append('Set-Cookie',`${COOKIE}=${continuation}; Path=${PUBLIC_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`);
  }else{
   verifyMutationOrigin(canonical,d.origin);if(request.headers.get('sec-fetch-site')!=='same-origin')throw new AppError('FORBIDDEN');
   const input=await readJson(request,submissionSchema);verifyChallenge(input.challenge,d.challengeKey,token,d.now());
   await enforceRateLimit(d.limits,opaqueRateLimitKey('keys-interest:global',d.challengeKey),30,60_000);
   const saved=await d.store.submit({operationId:input.operationId,fields:input.fields});
   response=successResponse({saved:true,reference:saved.item.id,operationId:input.operationId,replayed:saved.replayed,duplicate:saved.duplicate},requestId,saved.replayed||saved.duplicate?200:201);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 return harden(response);
}
export type KeysPrivateDependencies={enabled:boolean;origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;limits:RateLimitStore;rateLimitKey:string;store:Pick<KeysInterestStore,'listPage'|'read'|'update'|'summary'>};
export async function keysInterestOwnerHttp(request:Request,load:()=>Promise<KeysPrivateDependencies>){
 const requestId=randomUUID();let response:Response;
 try{
  const token=cookie(request,SESSION_COOKIE);if(!token)throw new AppError('UNAUTHENTICATED');const d=await load();if(!d.enabled)throw new AppError('NOT_FOUND');
  const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);if(url.pathname!==PRIVATE_PATH)throw new AppError('NOT_FOUND');const actor=await d.actor(token);
  if(request.method==='GET'){
   const keys=[...url.searchParams.keys()];if(keys.some(key=>!['reference','cursor','summary','historyBefore'].includes(key)||url.searchParams.getAll(key).length!==1))throw new AppError('INVALID_REQUEST');
   const reference=url.searchParams.get('reference'),cursor=url.searchParams.get('cursor'),summary=url.searchParams.get('summary'),before=url.searchParams.get('historyBefore');
   if(reference!==null){if(keys.some(key=>!['reference','historyBefore'].includes(key))||!z.string().uuid().safeParse(reference).success||before!==null&&!/^[1-9]\d{0,9}$/.test(before))throw new AppError('INVALID_REQUEST');response=successResponse(await d.store.read(actor,reference,before===null?undefined:Number(before)),requestId);}
   else if(summary!==null){if(keys.length!==1||summary!=='true')throw new AppError('INVALID_REQUEST');response=successResponse(await d.store.summary(actor),requestId);}
   else{if(before!==null||cursor!==null&&!reviewCursorSchema.safeParse(cursor).success)throw new AppError('INVALID_REQUEST');response=successResponse(await d.store.listPage(actor,cursor??undefined),requestId);}
  }else if(request.method==='POST'){
   if(url.search)throw new AppError('INVALID_REQUEST');verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),d.csrf(token));
   await enforceRateLimit(d.limits,opaqueRateLimitKey(`keys-owner:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60_000);
   response=successResponse({saved:true,followup:await d.store.update(actor,await readJson(request,keysOwnerUpdateSchema))},requestId);
  }else throw new AppError('INVALID_REQUEST');
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId);}
 return harden(response);
}
