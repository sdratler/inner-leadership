import {identityRuntime} from "@/features/identity/runtime.ts";
import {ContactCutoverStore} from "@/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "@/features/contact-ops/server/operational-store.ts";
import {whatsappRosterHttp,WHATSAPP_ROSTER_GROUP_ID} from "@/features/contact-ops/server/whatsapp-roster-http.ts";
import {crmBridgeWhatsAppRoster} from "@/features/prospects/bridge.ts";
export const dynamic="force-dynamic";
export async function GET(request:Request){return whatsappRosterHttp(request,async()=>{
 const runtime=await identityRuntime(),key=runtime.config.lookupKey.toString("hex");
 const channelId=process.env.LIFE_SKILLS_WHAPI_CHANNEL_ID??process.env.LIFE_SKILLS_WAPI_CHANNEL_ID??"";
 return {origin:runtime.config.origin,now:()=>runtime.clock.now(),actor:(token:string)=>runtime.services.sessions.actor(token),bridge:crmBridgeWhatsAppRoster,
  binding:{channelId,groupId:WHATSAPP_ROSTER_GROUP_ID},
  authority:new ContactCutoverStore(runtime.store,runtime.config.keyring,key,runtime.clock),directory:new OperationalNativeCrmStore(runtime.store,runtime.config.keyring,key,runtime.clock)};
})}
