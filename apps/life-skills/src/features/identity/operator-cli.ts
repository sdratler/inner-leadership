/** Private one-shot operator CLI. Never expose this entry point through HTTP or a client import. */
import "server-only";
import { closeDatabase } from "../../db/client.ts";
import { AppError } from "../../lib/errors.ts";
import { newRequestId } from "../../lib/ids.ts";
import { identityRuntime } from "./runtime.ts";
import { processResetRequests,dispatchOneAuthMail,pruneAuthEphemera } from "../../providers/email/dispatch.ts";
import { parseResendAuthConfig,ResendAuthTransport } from "../../providers/email/resend.ts";
async function main():Promise<void>{
 if(process.env.LS_IDENTITY_OPERATOR_APPROVED!=="true" || process.argv.length!==3) throw new AppError("FORBIDDEN");
 const command=process.argv[2];
 if(!["bootstrap","dispatch","prune"].includes(command ?? "")) throw new AppError("INVALID_REQUEST");
 const runtime=await identityRuntime();
 if(command==="bootstrap"){
  const email=process.env.LS_OPERATOR_BOOTSTRAP_EMAIL,displayName=process.env.LS_OPERATOR_BOOTSTRAP_DISPLAY_NAME;
  const locale=process.env.LS_OPERATOR_BOOTSTRAP_LOCALE;
  if(!email || !displayName || !["en","he"].includes(locale ?? "") || displayName.length>120) throw new AppError("INVALID_REQUEST");
  await runtime.services.accounts.bootstrapPractitioner({email,displayName,locale:locale as "en"|"he"},true,newRequestId());
  process.stdout.write(JSON.stringify({command,result:"invitation_queued"})+"\n");
 }else if(command==="dispatch"){
  // A provider credential and explicit enablement are required; no fallback transport.
  const email=parseResendAuthConfig(process.env),transport=new ResendAuthTransport(email);
  const processed=await processResetRequests(runtime.store,runtime.config,runtime.clock,25);
  const outcomes={sent:0,retry:0,canceled:0,failed:0};
  for(let i=0;i<25;i++){
   const outcome=await dispatchOneAuthMail(runtime.store,runtime.config,runtime.clock,transport,email.from);
   if(outcome==="idle") break;outcomes[outcome]++;
  }
  process.stdout.write(JSON.stringify({command,processed,...outcomes})+"\n");
 }else{
  await pruneAuthEphemera(runtime.store,runtime.config,runtime.clock);
  process.stdout.write(JSON.stringify({command,result:"complete"})+"\n");
 }
}
// Only fixed result codes reach logs; no account identifiers, environment, provider replies or errors.
void main().catch(()=>{process.stderr.write("IDENTITY_OPERATOR_FAILED\n");process.exitCode=1;})
 .finally(async()=>{try{await closeDatabase();}catch{process.exitCode=1;}});
