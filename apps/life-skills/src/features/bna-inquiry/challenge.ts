import "server-only";
import {createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";

const payloadSchema=z.object({v:z.literal(1),nonce:z.string().uuid(),issuedAt:z.number().int(),expiresAt:z.number().int()}).strict();
export type BnaInquiryChallengePurpose="torah"|"coop"|"support";
const signature=(body:string,key:string,purpose:BnaInquiryChallengePurpose)=>createHmac("sha256",key).update(`${purpose==="support"?"ls-bna-support-inquiry-challenge/v1":purpose==="coop"?"ls-bna-coop-inquiry-challenge/v1":"ls-bna-inquiry-challenge/v1"}\0${body}`).digest("base64url");
export function issueBnaInquiryChallenge(key:string,now:number=Date.now(),purpose:BnaInquiryChallengePurpose="torah"):string{
 if(key.length<32||!Number.isSafeInteger(now))throw new AppError("UNAVAILABLE");
 const body=Buffer.from(JSON.stringify({v:1,nonce:randomUUID(),issuedAt:now,expiresAt:now+30*60_000})).toString("base64url");
 return body+"."+signature(body,key,purpose);
}
export function verifyBnaInquiryChallenge(token:string,key:string,now:number=Date.now(),purpose:BnaInquiryChallengePurpose="torah"):void{
 try{
  if(key.length<32||token.length>1024||!Number.isSafeInteger(now))throw new Error();
  const parts=token.split(".");if(parts.length!==2)throw new Error();
  const [body,supplied]=parts as [string,string],expected=signature(body,key,purpose);
  if(supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new Error();
  const parsed=payloadSchema.parse(JSON.parse(Buffer.from(body,"base64url").toString("utf8")));
  if(parsed.expiresAt-parsed.issuedAt!==30*60_000||parsed.issuedAt>now||parsed.expiresAt<now||now-parsed.issuedAt<1500)throw new Error();
 }catch{throw new AppError("FORBIDDEN");}
}
