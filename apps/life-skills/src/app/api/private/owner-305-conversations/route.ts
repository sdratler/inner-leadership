import {identityRuntime} from "@/features/identity/runtime.ts";
import {Owner305ConversationStore} from "@/features/conversation-305/store.ts";
import {owner305ConversationHttp} from "@/features/conversation-305/http.ts";
export const runtime="nodejs";export const dynamic="force-dynamic";
async function handle(request:Request){return owner305ConversationHttp(request,async()=>{
 const r=await identityRuntime();return {enabled:process.env.LS_305_CLASSIFICATION_ENABLED==="true",origin:r.config.origin,
  actor:(token:string)=>r.services.sessions.actor(token),csrf:(token:string)=>r.services.sessions.csrf(token),
  limits:r.services.limits,rateLimitKey:r.config.rateLimitKey,
  store:new Owner305ConversationStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),process.env.LS_BNA_OWNER_ACCOUNT_ID??"",r.clock)};
});}
export const GET=handle;export const POST=handle;
