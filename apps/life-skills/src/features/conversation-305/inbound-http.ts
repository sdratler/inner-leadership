import "server-only";
import {randomUUID} from "node:crypto";
import {receiveContactInquiry} from "../contact-ops/server/inbound-http.ts";
import {canonicalForwardedRequest} from "../integration/canonical-forwarded-request.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../identity/crypto.ts";
import {AppError} from "../../lib/errors.ts";
import {successResponse,failureResponse} from "../../lib/http/json.ts";
import type {Actor} from "../identity/types.ts";
import type {Owner305InboundStore} from "./inbound-store.ts";
type Environment=Record<string,string|undefined>;
export function inbound305Enabled(env:Environment){return env.LS_305_INBOUND_ENABLED==="true"&&env.LS_305_CLASSIFICATION_ENABLED==="true"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.LS_BNA_OWNER_ACCOUNT_ID??"");}
export function receive305(request:Request,env:Environment,store:(binding:string)=>Promise<Pick<Owner305InboundStore,"capture">>){
 return receiveContactInquiry(request,{...env,LS_CONTACT_INBOUND_ENABLED:inbound305Enabled(env)?"true":"false",LS_CONTACT_INBOUND_BINDING_SHA256:env.LS_305_INBOUND_BINDING_SHA256},store);
}
export async function read305(request:Request,env:Environment,load:(binding:string)=>Promise<{origin:string;actor:(token:string)=>Promise<Actor>;store:Pick<Owner305InboundStore,"list">}>){
 const id=randomUUID();let response:Response;try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
  if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const binding=env.LS_305_INBOUND_BINDING_SHA256??"";if(!inbound305Enabled(env)||!/^[a-f0-9]{64}$/.test(binding))throw new AppError("UNAVAILABLE");
  const d=await load(binding),url=new URL(canonicalForwardedRequest(request,d.origin).url);
  if(request.method!=="GET"||url.origin!==d.origin||url.search)throw new AppError("INVALID_REQUEST");
  response=successResponse(await d.store.list(await d.actor(token)),id);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
