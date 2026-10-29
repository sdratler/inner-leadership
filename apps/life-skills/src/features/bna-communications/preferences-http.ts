import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,readJson,successResponse} from "../../lib/http/json.ts";
import {verifyMutationOrigin,verifyCsrfToken} from "../../lib/security/csrf.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../lib/security/rate-limit.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../identity/crypto.ts";
import type {Actor} from "../identity/types.ts";
import {canonicalForwardedRequest} from "../integration/canonical-forwarded-request.ts";
import {bnaOwnerPreferenceCommand,bnaRecipientPreferenceCommand,bnaPreferenceToken,recipientBnaPreferences} from "./preferences-contract.ts";
import type {BnaPreferenceStore} from "./preferences-store.ts";

const publicCommand=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("read"),token:bnaPreferenceToken}),
 z.strictObject({action:z.literal("update"),token:bnaPreferenceToken,command:bnaRecipientPreferenceCommand}),
]);
function protectedResponse(response:Response){
 response.headers.set("Cache-Control","private, no-store");response.headers.set("Referrer-Policy","no-referrer");
 response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
type PublicDeps={enabled:boolean;origin:string;limits:RateLimitStore;rateLimitKey:string;store:Pick<BnaPreferenceStore,"readRecipient"|"updateRecipient">};
/** Recipient capability is sent in a same-origin JSON body, never a URL or
 * cookie. A scanner/GET cannot change preferences or disclose a recipient. */
export async function publicBnaPreferenceHttp(request:Request,load:()=>Promise<PublicDeps>){
 const requestId=randomUUID();try{
  const d=await load();if(!d.enabled)throw new AppError("NOT_FOUND");
  const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/public/bna-preferences"||url.search||url.hash)throw new AppError("NOT_FOUND");
  if(request.method!=="POST")throw new AppError("NOT_FOUND");
  if(request.headers.get("sec-fetch-site")!=="same-origin")throw new AppError("FORBIDDEN");verifyMutationOrigin(canonical,d.origin);
  const input=await readJson(request,publicCommand);
  await enforceRateLimit(d.limits,opaqueRateLimitKey("bna-preferences:global",d.rateLimitKey),300,60000);
  await enforceRateLimit(d.limits,opaqueRateLimitKey(`bna-preferences:${createHash("sha256").update(input.token).digest("hex")}`,d.rateLimitKey),30,60000);
  let result;
  if(input.action==="read")result=await d.store.readRecipient(input.token);
  else{const saved=await d.store.updateRecipient(input.token,input.command);result={replayed:saved.replayed,preferences:recipientBnaPreferences(saved.preferences)};}
  return protectedResponse(successResponse(result,requestId));
 }catch(error){return protectedResponse(failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId));}
}
type PrivateDeps={enabled:boolean;origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<BnaPreferenceStore,"readOwner"|"updateOwner"|"issueCapability">};
export async function privateBnaPreferenceHttp(request:Request,load:()=>Promise<PrivateDeps>){
 const requestId=randomUUID();try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
  if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load();if(!d.enabled)throw new AppError("NOT_FOUND");const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/private/bna-preferences"||url.hash)throw new AppError("NOT_FOUND");const actor=await d.actor(token);
  if(request.method==="GET"){
   if([...url.searchParams.keys()].join()!=="id"||url.searchParams.getAll("id").length!==1)throw new AppError("INVALID_REQUEST");
   const id=z.uuid().safeParse(url.searchParams.get("id"));if(!id.success)throw new AppError("INVALID_REQUEST");
   return protectedResponse(successResponse(await d.store.readOwner(actor,id.data),requestId));
  }
  if(request.method!=="POST"||url.search)throw new AppError("INVALID_REQUEST");
  verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
  await enforceRateLimit(d.limits,opaqueRateLimitKey(`bna-preferences-owner:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60000);
  const input=await readJson(request,z.union([bnaOwnerPreferenceCommand,z.strictObject({action:z.literal("issue_link"),inquiryId:z.uuid()})]));
  const result=input.action==="issue_link"?await d.store.issueCapability(actor,input.inquiryId):await d.store.updateOwner(actor,input);
  return protectedResponse(successResponse(result,requestId));
 }catch(error){return protectedResponse(failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId));}
}
