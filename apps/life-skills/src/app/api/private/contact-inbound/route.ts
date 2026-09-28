import {identityRuntime} from "@/features/identity/runtime.ts";
import {ContactInboundStore} from "@/features/contact-ops/server/inbound-store.ts";
import {receiveContactInquiry} from "@/features/contact-ops/server/inbound-http.ts";
export const dynamic="force-dynamic";
export async function POST(request:Request){return receiveContactInquiry(request,process.env,async binding=>{
 const r=await identityRuntime();
 return new ContactInboundStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),binding,r.clock);
});}
