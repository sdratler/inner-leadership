import {identityRuntime} from "@/features/identity/runtime.ts";
import {GroupPlacementStore} from "@/features/group-placement/store.ts";
import {groupPlacementHttp} from "@/features/group-placement/http.ts";
import {groupInterestCandidateEnabled} from "@/features/group-interest/candidate.ts";
export const dynamic="force-dynamic";
async function handle(request:Request){return groupPlacementHttp(request,async()=>{
 const runtime=await identityRuntime();return {enabled:groupInterestCandidateEnabled(),
  origin:runtime.config.origin,actor:(token:string)=>runtime.services.sessions.actor(token),csrf:(token:string)=>runtime.services.sessions.csrf(token),
  store:new GroupPlacementStore(runtime.store,runtime.config.keyring,runtime.config.lookupKey.toString("hex"),runtime.clock)};
});}
export const GET=handle;
export const POST=handle;
