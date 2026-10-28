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
import {conversationCommandSchema} from "./contract.ts";
import type {Owner305ConversationStore} from "./store.ts";

type Deps={enabled:boolean;origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<Owner305ConversationStore,"list"|"read"|"save">};
export async function owner305ConversationHttp(request:Request,load:()=>Promise<Deps>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load();if(!d.enabled)throw new AppError("NOT_FOUND");
  const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/private/owner-305-conversations"||url.hash)throw new AppError("NOT_FOUND");
  const actor=await d.actor(token);
  if(request.method==="GET"){
   const keys=[...url.searchParams.keys()];if(keys.length>1||keys.length===1&&keys[0]!=="id")throw new AppError("INVALID_REQUEST");
   const id=url.searchParams.get("id");response=successResponse(id?await d.store.read(actor,id):await d.store.list(actor),requestId);
  }else if(request.method==="POST"){
   if(url.search)throw new AppError("INVALID_REQUEST");
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   await enforceRateLimit(d.limits,opaqueRateLimitKey(`owner-305:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60_000);
   const input=await readJson(request,conversationCommandSchema);
   const result=await d.store.save(actor,input);response=successResponse(result,requestId,result.replayed?200:201);
  }else throw new AppError("INVALID_REQUEST");
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
