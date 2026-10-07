import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../../lib/errors.ts";
import {readJson,successResponse,failureResponse} from "../../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../../lib/security/session.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "../../../lib/security/csrf.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../../lib/security/rate-limit.ts";
import {TOKEN_PATTERN} from "../../identity/crypto.ts";
import type {Actor} from "../../identity/types.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
import {leadCommandRequestSchema} from "../core/lead-command.ts";
import type {LeadCommandStore} from "./lead-command-store.ts";
import {ContractError} from "../core/validation.ts";
export type LeadCommandHttpDependencies={origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<LeadCommandStore,"preview"|"apply">};
export async function leadCommandHttp(request:Request,load:()=>Promise<LeadCommandHttpDependencies>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(request.method!=="POST"||url.origin!==d.origin||url.pathname!=="/api/private/contact-lead-command"||url.search)throw new AppError("INVALID_REQUEST");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
  await enforceRateLimit(d.limits,opaqueRateLimitKey(`lead-command:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60_000);
  const input=await readJson(request,leadCommandRequestSchema);
  response=successResponse(input.action==="preview"?await d.store.preview(actor,input):await d.store.apply(actor,input.token),id);
 }catch(error){const safe=error instanceof AppError?error:error instanceof ContractError&&
  ["STALE_PROFILE_VERSION","OPERATION_REUSED_WITH_DIFFERENT_INPUT"].includes(error.code)?new AppError("CONFLICT"):new AppError("UNAVAILABLE");
  response=failureResponse(safe,id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
