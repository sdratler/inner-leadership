import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError, errorEnvelope } from "@/lib/errors.ts";
import { identityRuntime } from "@/features/identity/runtime.ts";
import { PreEnrollmentService } from "@/features/forms/pre-enrollment/service.ts";
import { SqlPreEnrollmentRepository } from "@/features/forms/pre-enrollment/repository.ts";

/** Public intake is intentionally gated until W0's explicit real-data release.
 * The fragment token is never accepted in a GET/query string. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function reply(error:unknown){const result=errorEnvelope(error,randomUUID());return NextResponse.json(result.body,{status:result.status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});}
/** The production environment remains closed unless the dedicated release flag is enabled.
 * Local synthetic loopback uses the same sealed database path, never a browser store. */
function enabled(){return process.env.LS_INTAKE_REAL_DATA_RELEASE==="true"||process.env.LS_INTAKE_SYNTHETIC_LOOPBACK==="true";}
export async function GET(): Promise<Response> { return reply(new AppError("NOT_FOUND")); }
export async function POST(request:Request):Promise<Response>{try{if(!enabled())throw new AppError("NOT_FOUND");const body=await request.json() as {action?:unknown;token?:unknown;idempotencyKey?:unknown;payload?:unknown};if(typeof body.action!=="string"||typeof body.token!=="string")throw new AppError("INVALID_REQUEST");const runtime=await identityRuntime();const service=new PreEnrollmentService(new SqlPreEnrollmentRepository(runtime.store,runtime.config.workspaceId),runtime.config.keyring,()=>runtime.clock.now(),true);const data=body.action==='exchange'?await service.exchange(body.token):body.action==='submit'&&typeof body.idempotencyKey==='string'?await service.submit(body.token,body.idempotencyKey,body.payload):(()=>{throw new AppError("INVALID_REQUEST");})();return NextResponse.json({ok:true,data,requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});}catch(error){return reply(error);}}
