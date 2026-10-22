import {identityRuntime} from "@/features/identity/runtime.ts";
import {NativeEducationalChildContexts} from "@/features/fishing/native-child-context.ts";
import {fishingChildContextHttp} from "@/features/fishing/child-context-http.ts";

export const dynamic="force-dynamic";
export function GET(request:Request){
 return fishingChildContextHttp(request,async()=>{
  const r=await identityRuntime();
  return {runtime:{config:r.config,sessions:r.services.sessions,limits:r.services.limits,audit:r.services.audit,clock:r.clock},
   children:new NativeEducationalChildContexts(r.store,r.config.keyring,r.clock)};
 });
}
