import "server-only";
import {createHash,createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {readJson,successResponse,failureResponse} from "../../lib/http/json.ts";
import {canonical} from "../contact-ops/core/validation.ts";
import {fishingMarketingSnapshotSchema} from "./contract.ts";
import type {FishingMarketingStore} from "./store.ts";
type Environment=Record<string,string|undefined>;
/** Dedicated credential and default-off gate, independent of all publishing providers. */
export function requireFishingMarketingBridge(request:Request,env:Environment){
 const secret=(env.LS_FISHING_MARKETING_BRIDGE_SECRET??"").trim(),owner=env.LS_BNA_OWNER_ACCOUNT_ID??"";
 if(env.LS_FISHING_MARKETING_ENABLED!=="true"||secret.length<32||secret.length>1024||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner))throw new AppError("UNAVAILABLE");
 const supplied=request.headers.get("X-Fishing-Marketing-Secret")??"";
 const hash=(value:string)=>createHash("sha256").update(value).digest();
 if(supplied.length>1024||!timingSafeEqual(hash(supplied),hash(secret)))throw new AppError("UNAUTHENTICATED");
 return secret;
}
export async function receiveFishingMarketing(request:Request,env:Environment,load:()=>Promise<Pick<FishingMarketingStore,"save">>){
 const requestId=randomUUID();try{
  const secret=requireFishingMarketingBridge(request,env);
  if(request.method!=="POST"||new URL(request.url).search)throw new AppError("INVALID_REQUEST");
  const snapshot=await readJson(request,fishingMarketingSnapshotSchema,2_097_152),result=await (await load()).save(snapshot);
  const ackDigest=createHmac("sha256",secret).update("fishing-marketing-ack/v1\n").update(canonical(snapshot)).digest("hex");
  return successResponse({...result,ackDigest},requestId,result.replayed?200:201);
 }catch(error){return failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
}
