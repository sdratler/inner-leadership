import "server-only";
import {createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {floridaProgramIdSchema,type FloridaProgramId} from "./contract.ts";
import {TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_OFFER} from "./academy-trip390-contract.ts";

const legacyPayloadSchema=z.object({v:z.literal(1),nonce:z.string().uuid(),issuedAt:z.number().int(),expiresAt:z.number().int()}).strict();
const floridaPayloadSchema=z.object({v:z.literal(2),nonce:z.string().uuid(),issuedAt:z.number().int(),expiresAt:z.number().int(),programId:floridaProgramIdSchema}).strict();
const trip390PayloadSchema=legacyPayloadSchema.extend({
 v:z.literal(3),programId:z.literal("sunday_fishing_academy"),
 version:z.literal(TRIP390_INTEREST_VERSION),offerVersion:z.literal(TRIP390_OFFER.version),
 noticeVersion:z.literal(TRIP390_NOTICE_VERSION),continuationDigest:z.string().regex(/^[a-f0-9]{64}$/),
});
const payloadSchema=z.union([legacyPayloadSchema,floridaPayloadSchema,trip390PayloadSchema]);
export type GroupApplicationChallenge=z.infer<typeof payloadSchema>;
const signature=(version:1|2|3,body:string,key:string)=>createHmac("sha256",key).update(`ls-group-application-challenge/v${version}\0${body}`).digest("base64url");
const bodyFor=(payload:GroupApplicationChallenge)=>Buffer.from(JSON.stringify(payload)).toString("base64url");

export function issueGroupApplicationChallenge(key:string,now:number=Date.now(),nonce:string=randomUUID()):string{
 if(key.length<32||!Number.isSafeInteger(now))throw new AppError("UNAVAILABLE");
 const body=bodyFor({v:1,nonce,issuedAt:now,expiresAt:now+30*60_000});
 return body+"."+signature(1,body,key);
}
export function issueFloridaGroupApplicationChallenge(key:string,programId:FloridaProgramId,now:number=Date.now(),nonce:string=randomUUID()):string{
 if(key.length<32||!Number.isSafeInteger(now))throw new AppError("UNAVAILABLE");
 const body=bodyFor({v:2,nonce,issuedAt:now,expiresAt:now+30*60_000,programId});
 return body+"."+signature(2,body,key);
}
export function verifyGroupApplicationChallenge(token:string,key:string,now:number=Date.now()):GroupApplicationChallenge{
 try{
  if(key.length<32||token.length>1024||!Number.isSafeInteger(now))throw new Error();
  const parts=token.split(".");if(parts.length!==2)throw new Error();
  const [body,supplied]=parts as [string,string],decoded=JSON.parse(Buffer.from(body,"base64url").toString("utf8")) as {v?:unknown};
  if(decoded.v!==1&&decoded.v!==2&&decoded.v!==3)throw new Error();
  const expected=signature(decoded.v,body,key);
  if(supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new Error();
  const parsed=payloadSchema.parse(decoded);
  if(parsed.expiresAt-parsed.issuedAt!==30*60_000||parsed.issuedAt>now||parsed.expiresAt<now||now-parsed.issuedAt<1500)throw new Error();
  if(parsed.v===3&&now>=parsed.expiresAt)throw new Error();
  return parsed;
 }catch{throw new AppError("FORBIDDEN");}
}
export function trip390ContinuationDigest(key:string,continuation:string){
 return createHmac("sha256",key).update("ls-trip390-continuation/v1\0").update(continuation).digest("hex");
}
export function issueTrip390Challenge(key:string,continuation:string,now:number=Date.now(),nonce:string=randomUUID()):string{
 if(key.length<32||!Number.isSafeInteger(now))throw new AppError("UNAVAILABLE");
 const body=bodyFor({v:3,programId:"sunday_fishing_academy",version:TRIP390_INTEREST_VERSION,
  offerVersion:TRIP390_OFFER.version,noticeVersion:TRIP390_NOTICE_VERSION,continuationDigest:trip390ContinuationDigest(key,continuation),nonce,issuedAt:now,expiresAt:now+30*60_000});
 return body+"."+signature(3,body,key);
}
