import "server-only";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {PREREG_CREATIVE} from "../group-application/academy-campaign-contract.ts";
/** Return only the registered file after verifying its exact bytes and dimensions. */
export async function verifiedFishingCreative(read:(path:string)=>Promise<Buffer>=readFile){
 try{const bytes=await read(join(process.cwd(),"public",PREREG_CREATIVE.path));
  if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==1254||bytes.readUInt32BE(20)!==1254||createHash("sha256").update(bytes).digest("hex")!==PREREG_CREATIVE.sha256)return null;
  return {path:PREREG_CREATIVE.path,sha256:PREREG_CREATIVE.sha256,width:1254,height:1254} as const;
 }catch{return null;}
}
