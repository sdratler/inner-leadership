import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,readJson,successResponse} from "../../lib/http/json.ts";
import {verifyMutationOrigin,verifyCsrfToken} from "../../lib/security/csrf.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../lib/security/rate-limit.ts";
import {canonicalForwardedRequest} from "../integration/canonical-forwarded-request.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../identity/crypto.ts";
import type {Actor} from "../identity/types.ts";
import {fishingFollowupCommandSchema} from "./fishing-followup-contract.ts";
import type {FishingInquiryFollowupStore} from "./fishing-followup-store.ts";
import {reviewCursorSchema} from "./store.ts";

type Deps={origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<FishingInquiryFollowupStore,"read"|"followup">};
export async function fishingFollowupHttp(request:Request,load:()=>Promise<Deps>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
  if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/private/group-applications/followups")throw new AppError("NOT_FOUND");
  const actor=await d.actor(token);
  if(request.method==="GET"){
   const keys=[...url.searchParams.keys()];
   if(keys.some(key=>!['id','historyBefore'].includes(key)||url.searchParams.getAll(key).length!==1)||url.searchParams.getAll('id').length!==1)throw new AppError("INVALID_REQUEST");
   const before=url.searchParams.get('historyBefore');if(before!==null&&!/^\d{1,10}$/.test(before))throw new AppError("INVALID_REQUEST");
   response=successResponse(await d.store.read(actor,url.searchParams.get("id")??"",before===null?undefined:Number(before)),requestId);
  }else if(request.method==="POST"){
   if(url.search)throw new AppError("INVALID_REQUEST");
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   await enforceRateLimit(d.limits,opaqueRateLimitKey(`fishing-followup:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60_000);
   response=successResponse(await d.store.followup(actor,await readJson(request,fishingFollowupCommandSchema)),requestId);
  }else throw new AppError("INVALID_REQUEST");
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");
 return response;
}

export async function fishingFollowupBatchHttp(request:Request,load:()=>Promise<Omit<Deps,"store">&{store:Pick<FishingInquiryFollowupStore,"listPage">}>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
  if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),url=new URL(canonicalForwardedRequest(request,d.origin).url),keys=[...url.searchParams.keys()];
  if(request.method!=="GET"||url.origin!==d.origin||url.pathname!=="/api/private/group-applications/followups/batch"||keys.length>1||keys.some(key=>key!=="cursor"))throw new AppError("INVALID_REQUEST");
  const cursor=url.searchParams.get("cursor");if(cursor!==null&&!reviewCursorSchema.safeParse(cursor).success)throw new AppError("INVALID_REQUEST");
  response=successResponse(await d.store.listPage(await d.actor(token),cursor??undefined),requestId);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");
 return response;
}
