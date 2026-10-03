import {z} from "zod";
import {IdentityClientError} from "../identity/client.ts";
import type {ResponsibilityParticipants} from "./responsibility-input.ts";
const participants=z.object({caseKind:z.enum(["minor","adult"]),accounts:z.array(z.object({accountId:z.string().uuid(),role:z.enum(["parent","child","adult_client"])}).strict()).max(3)}).strict()
 .refine(value=>new Set(value.accounts.map(row=>row.accountId)).size===value.accounts.length)
 .refine(value=>value.accounts.every(row=>value.caseKind==="minor"?row.role!=="adult_client":row.role==="adult_client"));
export async function readResponsibilityParticipants(caseId:string,audienceId:string,signal:AbortSignal):Promise<ResponsibilityParticipants>{
 try{
  const response=await fetch("/api/home-practice?"+new URLSearchParams({view:"participants",caseId,audienceId}),{method:"GET",signal,credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
  const payload=await response.json();
  if(!response.ok||payload?.ok!==true){const code=payload?.error?.code;throw new IdentityClientError(["NOT_FOUND","UNAUTHENTICATED","FORBIDDEN","RATE_LIMITED"].includes(code)?code:"UNAVAILABLE");}
  const parsed=participants.safeParse(payload.data);if(!parsed.success)throw new IdentityClientError("UNAVAILABLE");return parsed.data;
 }catch(error){if(signal.aborted||error instanceof IdentityClientError)throw error;throw new IdentityClientError("UNAVAILABLE");}
}
