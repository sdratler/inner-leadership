import {identityRuntime} from "@/features/identity/runtime.ts";
import {PublicGroupApplicationStore} from "@/features/group-application/store.ts";
import {groupApplicationReviewHttp} from "@/features/group-application/review-http.ts";

export const dynamic="force-dynamic";
async function dependencies(){const runtime=await identityRuntime();return {origin:runtime.config.origin,actor:(token:string)=>runtime.services.sessions.actor(token),
 store:new PublicGroupApplicationStore(runtime.store,runtime.config.workspaceId,runtime.config.keyring,runtime.config.lookupKey.toString("hex"),runtime.clock)};}
export async function GET(request:Request){return groupApplicationReviewHttp(request,dependencies);}
