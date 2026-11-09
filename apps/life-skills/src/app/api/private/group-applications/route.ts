import {inquiryEmailControlRuntime} from '../../../../features/group-application/academy-inquiry-email-control-runtime.ts';
import {freshActor} from '../../../../features/identity/data.ts';
import {requirePractitioner} from '../../../../features/cases/policy.ts';
import {AppError} from '../../../../lib/errors.ts';
import type {Actor} from '../../../../features/identity/types.ts';
import {identityRuntime} from "@/features/identity/runtime.ts";
import {PublicGroupApplicationStore} from "@/features/group-application/store.ts";
import {groupApplicationReviewHttp} from "@/features/group-application/review-http.ts";
import {inspectInquiryEmailSetup} from "@/features/group-application/inquiry-email-setup.ts";

export const dynamic="force-dynamic";
async function dependencies(){const runtime=await identityRuntime(),control=inquiryEmailControlRuntime(runtime,process.env);return {
 ...(control?{emailControl:async(actor:Actor,reference:string)=>{
  if(actor.workspaceId!==runtime.config.workspaceId)throw new AppError("FORBIDDEN");
  const proof=await control.verification.readEvidence(reference,async tx=>{requirePractitioner(await freshActor(tx,actor,runtime.clock.now()));});
  return proof?{kind:proof.kind,applicationId:proof.applicationId,verifiedAt:proof.verifiedAt}:null;
 }}:{}),origin:runtime.config.origin,actor:(token:string)=>runtime.services.sessions.actor(token),
 store:new PublicGroupApplicationStore(runtime.store,runtime.config.workspaceId,runtime.config.keyring,runtime.config.lookupKey.toString("hex"),runtime.clock),
 emailSetup:()=>inspectInquiryEmailSetup(process.env)};}
export async function GET(request:Request){return groupApplicationReviewHttp(request,dependencies);}
