import {identityRuntime} from "@/features/identity/runtime.ts";
import {Owner305InboundStore} from "@/features/conversation-305/inbound-store.ts";
import {read305,receive305} from "@/features/conversation-305/inbound-http.ts";
export const dynamic="force-dynamic";
async function dependencies(binding:string){const r=await identityRuntime();return {origin:r.config.origin,actor:(token:string)=>r.services.sessions.actor(token),
 store:new Owner305InboundStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),binding,process.env.LS_BNA_OWNER_ACCOUNT_ID??"",r.clock)};}
export async function POST(request:Request){return receive305(request,process.env,async binding=>(await dependencies(binding)).store);}
export async function GET(request:Request){return read305(request,process.env,dependencies);}
