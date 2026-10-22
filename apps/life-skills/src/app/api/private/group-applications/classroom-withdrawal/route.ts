import {randomUUID} from "node:crypto";
import {AppError} from "@/lib/errors.ts";
import {failureResponse} from "@/lib/http/json.ts";
import {identityRuntime} from "@/features/identity/runtime.ts";
import {PublicGroupApplicationStore} from "@/features/group-application/store.ts";
import {FishingLeadStore} from "@/features/contact-ops/server/fishing-lead-store.ts";
import {AcademyFamilyStore} from "@/features/fishing/academy-family-store.ts";
import {ClassroomFamilyWithdrawalStore} from "@/features/resources/classroom-family-withdrawal-store.ts";
import {ClassroomFamilyWithdrawalHttp} from "@/features/resources/classroom-family-withdrawal-http.ts";
export const dynamic="force-dynamic";
async function handle(request:Request){
 try{
  const {config,store,clock,services}=await identityRuntime(),integrity=config.lookupKey.toString("hex");
  const family=new AcademyFamilyStore(store,config,new PublicGroupApplicationStore(store,config.workspaceId,config.keyring,integrity,clock),new FishingLeadStore(store,config.keyring,integrity,"sunday_fishing_academy",clock),clock);
  // Default constructor has no admitted native program; source/payment
  // admission is not minted from a request, environment flag or saved row.
  return new ClassroomFamilyWithdrawalHttp({config,sessions:services.sessions,limits:services.limits,audit:services.audit,clock},new ClassroomFamilyWithdrawalStore(store,config,family,clock)).handle(request);
 }catch{const response=failureResponse(new AppError("UNAVAILABLE"),randomUUID());response.headers.set("Cache-Control","private, no-store");response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;}
}
export const GET=handle;
export const POST=handle;
