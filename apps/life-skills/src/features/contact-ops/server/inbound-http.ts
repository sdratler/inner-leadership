import "server-only";
import {createHash,timingSafeEqual,randomUUID} from "node:crypto";
import {AppError} from "../../../lib/errors.ts";
import {readJson,successResponse,failureResponse} from "../../../lib/http/json.ts";
import {inboundInquirySchema} from "../core/inbound.ts";
import type {ContactInboundStore} from "./inbound-store.ts";
type Environment=Record<string,string|undefined>;
/** Existing credential only. No cookies/role switch/developer preview password
 * authenticates a provider event. Default OFF until schema and binding proofs.
 */
export function requireInboundBridge(request:Request,env:Environment):string{
 const secret=(env.LIFE_SKILLS_APP_BRIDGE_SECRET??"").trim(),binding=env.LS_CONTACT_INBOUND_BINDING_SHA256??"";
 if(env.LS_CONTACT_INBOUND_ENABLED!=="true"||secret.length<32||secret.length>1024||!/^[a-f0-9]{64}$/.test(binding))throw new AppError("UNAVAILABLE");
 const supplied=request.headers.get("X-Life-Skills-Bridge-Secret")??"";
 const hash=(v:string)=>createHash("sha256").update(v).digest();
 if(supplied.length>1024||!timingSafeEqual(hash(supplied),hash(secret)))throw new AppError("UNAUTHENTICATED");
 return binding;
}
export async function receiveContactInquiry(request:Request,env:Environment,store:(binding:string)=>Promise<Pick<ContactInboundStore,"capture">>):Promise<Response>{
 const requestId=randomUUID();try{
  const binding=requireInboundBridge(request,env);
  if(request.method!=="POST"||new URL(request.url).search)throw new AppError("INVALID_REQUEST");
  const inquiry=await readJson(request,inboundInquirySchema,65536);
  const result=await (await store(binding)).capture(inquiry);
  // Only a committed capture produces success; body and provider IDs stay private.
  return successResponse(result,requestId,result.replayed?200:201);
 }catch(error){return failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
}
