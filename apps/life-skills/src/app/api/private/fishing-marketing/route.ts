import {identityRuntime} from "@/features/identity/runtime.ts";
import {FishingMarketingStore} from "@/features/fishing-marketing/store.ts";
import {receiveFishingMarketing} from "@/features/fishing-marketing/http.ts";
export const dynamic="force-dynamic";
export async function POST(request:Request){return receiveFishingMarketing(request,process.env,async()=>{
 const r=await identityRuntime();return new FishingMarketingStore(r.store,r.config.workspaceId,r.config.keyring,r.config.lookupKey.toString("hex"),process.env.LS_BNA_OWNER_ACCOUNT_ID??"",r.clock);
});}
