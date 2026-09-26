/** Private one-shot operator CLI. Never expose this entry point through HTTP or a client import. */
import "server-only";
import { closeDatabase } from "../../db/client.ts";
import { AppError } from "../../lib/errors.ts";
import { validateDatabaseUrl } from "../../lib/env/schema.ts";
import { newRequestId } from "../../lib/ids.ts";
import { accountByEmail } from "./data.ts";
import { blindEmail } from "./crypto.ts";
import { identityRuntime } from "./runtime.ts";
import { demoAccountBatch } from "../demo/provenance.ts";
import { demoOperatorPlan } from "../demo/operator-plan.ts";
import { processResetRequests,dispatchOneAuthMail,pruneAuthEphemera } from "../../providers/email/dispatch.ts";
import { createAuthEmailTransport } from "../../providers/email/gmail.ts";
async function main():Promise<void>{
 if(process.env.LS_IDENTITY_OPERATOR_APPROVED!=="true" || process.argv.length!==3) throw new AppError("FORBIDDEN");
 const command=process.argv[2];
 if(!["bootstrap","dispatch","prune","provision-demo"].includes(command ?? "")) throw new AppError("INVALID_REQUEST");
 const runtime=await identityRuntime();
 if(command==="bootstrap"){
  const email=process.env.LS_OPERATOR_BOOTSTRAP_EMAIL,displayName=process.env.LS_OPERATOR_BOOTSTRAP_DISPLAY_NAME;
  const locale=process.env.LS_OPERATOR_BOOTSTRAP_LOCALE;
  if(!email || !displayName || !["en","he"].includes(locale ?? "") || displayName.length>120) throw new AppError("INVALID_REQUEST");
  await runtime.services.accounts.bootstrapPractitioner({email,displayName,locale:locale as "en"|"he"},true,newRequestId());
  process.stdout.write(JSON.stringify({command,result:"invitation_queued"})+"\n");
 }else if(command==="provision-demo"){
  // Deliberate one-shot operator action, not a startup job or public endpoint.
  // No account is created unless the exact existing private-app target and the
  // three owner-controlled aliases agree with the configured setup-mail allowlist.
  if(process.env.LS_DEMO_PROVISION_APPROVED!=="true" ||
     process.env.RAILWAY_PROJECT_ID!=="3b756632-1f66-4f75-a016-eabc37aa0d67" ||
     process.env.RAILWAY_SERVICE_ID!=="0267d061-f3ce-4a0a-82d4-ce133e4501e9" ||
     process.env.RAILWAY_ENVIRONMENT_ID!=="dd91bd71-57cc-45e6-a75b-8c858491d7c7" ||
     runtime.config.origin!=="https://life-skills.bneineviimacademy.org")throw new AppError("FORBIDDEN");
  const databaseUrl=process.env.LS_DATABASE_URL;
  if(!databaseUrl||process.env.LS_DATABASE_TLS!=="verify-full"||!process.env.LS_DATABASE_CA)throw new AppError("FORBIDDEN");
  const database=validateDatabaseUrl(databaseUrl,"verify-full");
  if(database.hostname!=="postgres.railway.internal"||database.pathname!=="/railway")throw new AppError("FORBIDDEN");
  const plan=demoOperatorPlan({batch:process.env.LS_DEMO_BATCH_ID,ownerEmail:process.env.LS_DEMO_OWNER_EMAIL,
   parentEmail:process.env.LS_DEMO_PARENT_EMAIL,childEmail:process.env.LS_DEMO_CHILD_EMAIL,adultEmail:process.env.LS_DEMO_ADULT_EMAIL,
   setupRecipients:runtime.config.demoSetupRecipients,childAccountsEnabled:runtime.config.childAccountsEnabled===true});
  const {batch,ownerEmail,addresses:expected}=plan;
  const owner=await runtime.store.transaction(async tx=>{
   const account=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(ownerEmail,runtime.config.lookupKey));
   if(!account||account.role!=="practitioner"||account.state!=="active"||!account.emailVerifiedAt||
      await demoAccountBatch(tx,runtime.config.workspaceId,account.id))throw new AppError("FORBIDDEN");
   for(const address of Object.values(expected)){
    const existing=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(address,runtime.config.lookupKey));
    if(existing && await demoAccountBatch(tx,runtime.config.workspaceId,existing.id)!==batch)throw new AppError("CONFLICT");
   }
   return account;
  });
  const minor=await runtime.services.cases.createDemoAsOperator(owner.id,{kind:"minor",displayName:"DEMO — Child A",familyLabel:"DEMO — Family A"},batch,"owner-minor-a",newRequestId(),true);
  const adult=await runtime.services.cases.createDemoAsOperator(owner.id,{kind:"adult",displayName:"DEMO — Adult",familyLabel:"DEMO — Adult"},batch,"owner-adult-a",newRequestId(),true);
  const parentAccount=await runtime.services.accounts.inviteDemoAsOperator(owner.id,"parent",{caseId:minor.caseId,email:expected.parent,displayName:"DEMO — Parent A",locale:"he"},newRequestId(),true);
  const childAccount=await runtime.services.accounts.inviteDemoAsOperator(owner.id,"child",{caseId:minor.caseId,email:expected.child,displayName:"DEMO — Child A",locale:"he"},newRequestId(),true);
  const adultAccount=await runtime.services.accounts.inviteDemoAsOperator(owner.id,"adult_client",{caseId:adult.caseId,email:expected.adult,displayName:"DEMO — Adult",locale:"he"},newRequestId(),true);
  const count=await runtime.store.transaction(async tx=>{
   const ids=[parentAccount.accountId,childAccount.accountId,adultAccount.accountId];
   const rows=await tx.query<{accountId:string;batchId:string;role:string;emailBlind:string}>(`SELECT d.account_id AS "accountId",d.batch_id AS "batchId",a.role,a.email_blind AS "emailBlind"
    FROM ls_demo.accounts d JOIN ls_identity.accounts a ON a.workspace_id=d.workspace_id AND a.id=d.account_id
    WHERE d.workspace_id=$1 AND d.account_id=ANY($2::uuid[])`,[runtime.config.workspaceId,ids]);
   const caseRows=await tx.query<{caseId:string;batchId:string}>("SELECT case_id AS \"caseId\",batch_id AS \"batchId\" FROM ls_demo.cases WHERE workspace_id=$1 AND case_id=ANY($2::uuid[])",[runtime.config.workspaceId,[minor.caseId,adult.caseId]]);
   return rows.length===3 && caseRows.length===2 &&
    caseRows.every(row=>row.batchId===batch) && new Set(caseRows.map(row=>row.caseId)).size===2 &&
    rows.every(row=>row.batchId===batch) && new Set(rows.map(row=>row.accountId)).size===3 &&
    [['parent',ids[0],expected.parent],['child',ids[1],expected.child],['adult_client',ids[2],expected.adult]].every(([role,id,address])=>
     rows.some(row=>row.role===role&&row.accountId===id&&row.emailBlind===blindEmail(address!,runtime.config.lookupKey)));
  });
  if(!count)throw new AppError("INTERNAL");
  process.stdout.write(JSON.stringify({command,result:"three_demo_identities_recorded",batch,setupMail:"queued_or_previously_sent"})+"\n");
 }else if(command==="dispatch"){
  // A provider credential and explicit enablement are required; no fallback transport.
  const email=createAuthEmailTransport(process.env),transport=email.transport;
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
