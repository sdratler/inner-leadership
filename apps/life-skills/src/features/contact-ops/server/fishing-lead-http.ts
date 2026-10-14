import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {readJson,successResponse,failureResponse} from "../../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../../lib/security/session.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "../../../lib/security/csrf.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../../lib/security/rate-limit.ts";
import {TOKEN_PATTERN} from "../../identity/crypto.ts";
import type {Actor} from "../../identity/types.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
import {fishingProgramSchema} from "../core/fishing-association-contract.ts";
import {fishingLeadRequestSchema} from "../core/fishing-lead.ts";
import type {FishingLeadStore} from "./fishing-lead-store.ts";
import {ContractError} from "../core/validation.ts";
export type FishingLeadHttpDependencies={origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<FishingLeadStore,"preview"|"confirm"|"context"|"read">};
export async function fishingLeadHttp(request:Request,program:string,
 load:(program:z.infer<typeof fishingProgramSchema>)=>Promise<FishingLeadHttpDependencies>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const parsed=fishingProgramSchema.safeParse(program);if(!parsed.success)throw new AppError("NOT_FOUND");
  const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(parsed.data),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/private/fishing-leads/"+parsed.data)throw new AppError("INVALID_REQUEST");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  if(request.method==="GET"){
   if(url.searchParams.size!==2||!url.searchParams.has("source")||!url.searchParams.has("sourceId"))throw new AppError("INVALID_REQUEST");
   const source=z.enum(["person","inquiry"]).safeParse(url.searchParams.get("source")),sourceId=z.string().uuid().safeParse(url.searchParams.get("sourceId"));
   if(!source.success||!sourceId.success)throw new AppError("INVALID_REQUEST");
   response=successResponse(await d.store.context(actor,{kind:source.data,id:sourceId.data}),id);
  }else if(request.method==="POST"){
   if(url.search)throw new AppError("INVALID_REQUEST");verifyMutationOrigin(canonical,d.origin);
   verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   await enforceRateLimit(d.limits,opaqueRateLimitKey(`fishing-lead:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60_000);
   const input=await readJson(request,fishingLeadRequestSchema);
   response=successResponse(input.action==="confirm"?await d.store.confirm(actor,input):await d.store.preview(actor,input),id);
  }else throw new AppError("INVALID_REQUEST");
 }catch(error){const safe=error instanceof AppError?error:error instanceof ContractError&&
  ["STALE_PROFILE_VERSION","OPERATION_REUSED_WITH_DIFFERENT_INPUT"].includes(error.code)?new AppError("CONFLICT"):new AppError("UNAVAILABLE");
  response=failureResponse(safe,id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
