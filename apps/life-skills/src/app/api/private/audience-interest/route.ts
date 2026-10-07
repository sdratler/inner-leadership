import {identityRuntime} from "@/features/identity/runtime.ts";
import {audienceInterestHttp} from "@/features/contact-ops/server/audience-interest-http.ts";
import {AudienceInterestStore} from "@/features/contact-ops/server/audience-interest-store.ts";
export const dynamic="force-dynamic";
async function dependencies(){const runtime=await identityRuntime(),key=runtime.config.lookupKey.toString("hex");return {
 origin:runtime.config.origin,actor:(token:string)=>runtime.services.sessions.actor(token),csrf:(token:string)=>runtime.services.sessions.csrf(token),
 store:new AudienceInterestStore(runtime.store,runtime.config.keyring,key,runtime.clock)};}
export async function GET(request:Request){return audienceInterestHttp(request,dependencies);}
export async function POST(request:Request){return audienceInterestHttp(request,dependencies);}
