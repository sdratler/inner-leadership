import {superviseSignupWorker} from "./signup-worker-supervisor.ts";
import {identityRuntime} from "../src/features/identity/runtime.ts";
import {closeDatabase} from "../src/db/client.ts";
import {BnaAcknowledgmentStore} from "../src/features/bna-communications/acknowledgment-store.ts";
import {createBnaAcknowledgmentTransport} from "../src/features/bna-communications/acknowledgment-transport.ts";
import {bnaRecipientSha256,readBnaDispatchAdmission} from "../src/features/bna-communications/dispatch-admission.ts";

if(process.argv.length!==3||process.argv[2]!=="--hosted-bna-acknowledgments")throw Error("BNA_ACK_WORKER_ARGUMENTS_INVALID");
const control=new AbortController(),stop=()=>control.abort();process.on("SIGINT",stop);process.on("SIGTERM",stop);
try{
 const runtime=await identityRuntime(),store=new BnaAcknowledgmentStore(runtime.store,runtime.config.workspaceId,process.env.LS_BNA_OWNER_ACCOUNT_ID??"",
  runtime.config.keyring,runtime.config.lookupKey.toString("hex"),runtime.clock);
 await superviseSignupWorker({signal:control.signal,intervalMs:30_000,cycle:async()=>{
  const policy=readBnaDispatchAdmission(process.env,runtime.clock.now());
  const verify=async(current:typeof policy)=>{await store.assertDeliveryTarget(current);if(current.mode==="future_requests")await store.verifyControlledProofs(current,bnaRecipientSha256(process.env.LS_ACADEMY_OWNER_NOTIFICATION_TO??""));};
  await verify(policy);
  const transport=createBnaAcknowledgmentTransport(process.env,runtime.clock,verify);
  for(const id of await store.queuedIds(policy,1)){if(control.signal.aborted)break;await store.dispatch(id,transport);}
 },event:event=>console.log(JSON.stringify({worker:"bna_service_acknowledgment",...event})),
 wait:(delayMs,signal)=>new Promise<void>(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener("abort",done);resolve();},timer=setTimeout(done,delayMs);signal.addEventListener("abort",done,{once:true});})});
}catch{console.error("BNA_ACK_WORKER_UNAVAILABLE");process.exitCode=1;}
finally{process.off("SIGINT",stop);process.off("SIGTERM",stop);await closeDatabase();}
