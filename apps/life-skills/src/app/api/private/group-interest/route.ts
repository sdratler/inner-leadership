import {identityRuntime} from "@/features/identity/runtime.ts";
import {GroupInterestStore} from "@/features/group-interest/store.ts";
import {groupInterestHttp} from "@/features/group-interest/http.ts";
import {groupInterestCandidateEnabled} from "@/features/group-interest/candidate.ts";
import {PublicGroupApplicationStore} from "@/features/group-application/store.ts";
export const dynamic="force-dynamic";
async function handle(request:Request){return groupInterestHttp(request,async()=>{
 const r=await identityRuntime();
 return {enabled:groupInterestCandidateEnabled(),origin:r.config.origin,
 actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),
 store:new GroupInterestStore(r.store,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock),
 publicApplications:new PublicGroupApplicationStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock)};
});}
export const GET=handle;
export const POST=handle;
