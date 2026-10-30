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
import {bnaReplyReviewCommand} from './reply-contract.ts';
import type {BnaReplyStore} from './reply-store.ts';
import type {BnaReplyMonitorStore} from './reply-monitor-store.ts';
type Deps={enabled:boolean;origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<BnaReplyStore,'readOwner'|'markReviewed'>|undefined;monitor:Pick<BnaReplyMonitorStore,'status'>|undefined};
function protectedResponse(response:Response){response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");return response;}
/** Owner read/review only. There is deliberately no public webhook, scan
 * command, mailbox selection, provider data or browser-manufactured receipt. */
export async function privateBnaReplyHttp(request:Request,load:()=>Promise<Deps>){const requestId=randomUUID();try{
 const cookies=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(SESSION_COOKIE+'='));
 if(cookies.length!==1)throw new AppError('UNAUTHENTICATED');const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError('UNAUTHENTICATED');
 const d=await load();if(!d.enabled||!d.store||!d.monitor)throw new AppError('NOT_FOUND');const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
 if(url.origin!==d.origin||url.pathname!=='/api/private/bna-mailbox-replies'||url.hash)throw new AppError('NOT_FOUND');const actor=await d.actor(token);
 if(actor.role!=='practitioner'||actor.state!=='active')throw new AppError('FORBIDDEN');
 if(request.method==='GET'){
  const keys=[...url.searchParams.keys()];if(!keys.includes('id')||keys.some(k=>!['id','before'].includes(k)||url.searchParams.getAll(k).length!==1))throw new AppError('INVALID_REQUEST');
  const id=z.uuid().safeParse(url.searchParams.get('id'));if(!id.success)throw new AppError('INVALID_REQUEST');
  const before=url.searchParams.get('before');if(before!==null&&!/^[A-Za-z0-9_-]{64,2048}$/.test(before))throw new AppError('INVALID_REQUEST');
  const page=await d.store.readOwner(actor,id.data,before??undefined);return protectedResponse(successResponse({...page,monitor:await d.monitor.status(actor)},requestId));
 }
 if(request.method!=='POST'||url.search)throw new AppError('INVALID_REQUEST');verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get('x-csrf-token'),d.csrf(token));
 await enforceRateLimit(d.limits,opaqueRateLimitKey(`bna-mailbox-review:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60000);
 const command=await readJson(request,bnaReplyReviewCommand);return protectedResponse(successResponse(await d.store.markReviewed(actor,command),requestId));
 }catch(error){return protectedResponse(failureResponse(error instanceof AppError?error:new AppError('UNAVAILABLE'),requestId));}}
