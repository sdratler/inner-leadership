import {randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {AppError,errorEnvelope} from "../../../lib/errors.ts";
import {ownerDigestForRequest} from "../../../features/owner-digest/runtime.ts";
import {ownerDigestEmail} from "../../../features/owner-digest/email.ts";
export const runtime="nodejs";export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
export async function GET(request:Request){try{
 const result=await ownerDigestForRequest(request);
 return NextResponse.json({ok:true,data:result.digest,email:ownerDigestEmail(result.digest,result.origin,result.locale),requestId:randomUUID()},{headers});
}catch(error){const result=errorEnvelope(error instanceof AppError?error:new AppError("UNAVAILABLE"),randomUUID());return NextResponse.json(result.body,{status:result.status,headers});}}
