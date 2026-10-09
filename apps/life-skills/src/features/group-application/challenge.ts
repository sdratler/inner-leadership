import "server-only";
import {createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";

const payloadSchema=z.object({v:z.literal(1),nonce:z.string().uuid(),issuedAt:z.number().int(),expiresAt:z.number().int()}).strict();
export type GroupApplicationChallenge=z.infer<typeof payloadSchema>;
const signature=(body:string,key:string)=>createHmac("sha256",key).update("ls-group-application-challenge/v1\0"+body).digest("base64url");

export function issueGroupApplicationChallenge(key:string,now:number=Date.now(),nonce:string=randomUUID()):string{
 if(key.length<32||!Number.isSafeInteger(now))throw new AppError("UNAVAILABLE");
 const body=Buffer.from(JSON.stringify({v:1,nonce,issuedAt:now,expiresAt:now+30*60_000})).toString("base64url");
 return body+"."+signature(body,key);
}
export function verifyGroupApplicationChallenge(token:string,key:string,now:number=Date.now()):GroupApplicationChallenge{
 try{
  if(key.length<32||token.length>1024||!Number.isSafeInteger(now))throw new Error();
  const parts=token.split(".");if(parts.length!==2)throw new Error();
  const [body,supplied]=parts as [string,string],expected=signature(body,key);
  if(supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new Error();
  const parsed=payloadSchema.parse(JSON.parse(Buffer.from(body,"base64url").toString("utf8")));
  if(parsed.expiresAt-parsed.issuedAt!==30*60_000||parsed.issuedAt>now||parsed.expiresAt<now||now-parsed.issuedAt<1500)throw new Error();
  return parsed;
 }catch{throw new AppError("FORBIDDEN");}
}
