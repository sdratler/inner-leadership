import "server-only";
import {createHash,timingSafeEqual,randomUUID} from "node:crypto";
import {AppError} from "../../../lib/errors.ts";
import {readJson,successResponse,failureResponse} from "../../../lib/http/json.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../../lib/security/rate-limit.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
import {callEventSchema,type CallEvent} from "../core/call-events.ts";
type Environment=Record<string,string|undefined>;
type Runtime={origin:string;workspaceId:string;rateLimitKey:string;limits:RateLimitStore;
 capture:(event:CallEvent,binding:string)=>Promise<{replayed:boolean}>};
/** Separate random Nomad bearer, never the WAPI/identity/operator credential.
 * Authentication precedes runtime/database loading; disabled unless explicitly
 * configured. The payload cannot choose workspace, device, actor or authority.
 */
export function requireNomadBinding(request:Request,env:Environment):string{
 const secret=env.LS_NOMAD_CALL_SECRET??"",binding=env.LS_NOMAD_DEVICE_BINDING_ID??"";
 if(env.LS_NOMAD_CALLS_ENABLED!=="true"||!/^[A-Za-z0-9_-]{43}$/.test(secret)||
  Buffer.from(secret,"base64url").length!==32||Buffer.from(secret,"base64url").toString("base64url")!==secret||
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(binding))throw new AppError("UNAVAILABLE");
 const supplied=request.headers.get("authorization")??"",expected="Bearer "+secret;
 const hash=(v:string)=>createHash("sha256").update(v).digest();
 if(supplied.length>128||!timingSafeEqual(hash(supplied),hash(expected)))throw new AppError("UNAUTHENTICATED");return binding;
}
export async function receiveCallEvent(request:Request,env:Environment,load:()=>Promise<Runtime>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const binding=requireNomadBinding(request,env),runtime=await load(),canonical=canonicalForwardedRequest(request,runtime.origin),url=new URL(canonical.url);
  if(request.method!=="POST"||url.pathname!=="/api/private/acquisition/call-events"||url.search)throw new AppError("INVALID_REQUEST");
  await enforceRateLimit(runtime.limits,opaqueRateLimitKey(`nomad-call:${runtime.workspaceId}:${binding}`,runtime.rateLimitKey),60,60_000);
  const result=await runtime.capture(await readJson(request,callEventSchema,2048),binding);
  response=successResponse(result,id,result.replayed?200:201);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
