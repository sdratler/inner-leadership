import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {failureResponse} from "../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {identityRuntime} from "../identity/runtime.ts";
import {crmBridgeImage} from "../prospects/bridge.ts";
const MAX_BYTES=10*1024*1024;
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin"};
async function ordinaryPractitioner(request:Request){
 const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(`${SESSION_COOKIE}=`));
 if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
 const identity=await identityRuntime(),actor=await identity.services.sessions.actor(cookies[0]!.slice(SESSION_COOKIE.length+1));
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
}
export async function marketingMedia(request:Request,assetId:string,deps={authorize:ordinaryPractitioner,read:crmBridgeImage}):Promise<Response>{
 try{
  await deps.authorize(request);
  if(!/^[A-Za-z0-9._-]{1,200}$/.test(assetId))throw new AppError("INVALID_REQUEST");
  const query=new URL(request.url).searchParams;
  if([...query.keys()].some(key=>!["revision","digest","download","collection"].includes(key)||query.getAll(key).length!==1)||! /^[1-9]\d{0,5}$/.test(query.get("revision")??"")||! /^[a-f0-9]{64}$/.test(query.get("digest")??"")||query.has("download")&&query.get("download")!=="1"||query.has("collection")&&!["templates","history"].includes(query.get("collection")!))throw new AppError("INVALID_REQUEST");
  const revision=Number(query.get("revision")),digest=query.get("digest")!,collection=query.get("collection") as "templates"|"history"|null;
  const response=collection?await deps.read(assetId,revision,digest,query.get("download")==="1",collection):await deps.read(assetId,revision,digest,query.get("download")==="1");
  if(!response.ok){await response.body?.cancel();throw new AppError(response.status===409?"CONFLICT":response.status===404?"NOT_FOUND":"UNAVAILABLE");}
  const size=Number(response.headers.get("content-length"));
  if(response.headers.get("content-type")?.split(";")[0]!=="image/png"||!Number.isSafeInteger(size)||size<33||size>MAX_BYTES||!response.body){await response.body?.cancel();throw new AppError("UNAVAILABLE");}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>MAX_BYTES||total>size){await reader.cancel();throw new AppError("UNAVAILABLE");}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks,total);
  if(total!==size||createHash("sha256").update(bytes).digest("hex")!==digest||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new AppError("CONFLICT");
  return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Type":"image/png","Content-Length":String(total),"Content-Disposition":`${query.get("download")==="1"?"attachment":"inline"}; filename="${assetId}-r${revision}.png"`}});
 }catch(error){const response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),randomUUID());for(const[key,value]of Object.entries(headers))response.headers.set(key,value);return response;}
}
