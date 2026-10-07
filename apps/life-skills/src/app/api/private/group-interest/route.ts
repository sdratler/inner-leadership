import {identityRuntime} from "@/features/identity/runtime.ts";
import {GroupInterestStore} from "@/features/group-interest/store.ts";
import {groupInterestHttp} from "@/features/group-interest/http.ts";
export const dynamic="force-dynamic";
async function handle(request:Request){return groupInterestHttp(request,async()=>{
 const r=await identityRuntime();
 return {enabled:process.env.LS_GROUP_INTEREST_CANDIDATE==="true"&&process.env.NODE_ENV!=="production",origin:r.config.origin,
 actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),
 store:new GroupInterestStore(r.store,r.config.keyring,r.config.lookupKey.toString("hex"),r.clock)};
});}
export const GET=handle;
export const POST=handle;
