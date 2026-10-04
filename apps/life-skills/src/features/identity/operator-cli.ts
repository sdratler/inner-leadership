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
import { demoInviteDispatchPlan,type DemoInviteMail } from "../demo/invite-dispatch.ts";
import { demoCalendarPlan } from "../demo/calendar-plan.ts";
import { prepareDemoHistory } from "../demo/history-operator.ts";
import { prepareDemoPractice } from "../demo/practice-operator.ts";
import { CalendarStore } from "../calendar/store.ts";
import { CalendarService } from "../calendar/service.ts";
import type {CaseId,AccountId} from './types.ts';
import type {AppointmentId} from '../calendar/types.ts';
import { processResetRequests,dispatchOneAuthMail,pruneAuthEphemera } from "../../providers/email/dispatch.ts";
import { createAuthEmailTransport } from "../../providers/email/gmail.ts";
async function main():Promise<void>{
 if(process.env.LS_IDENTITY_OPERATOR_APPROVED!=="true" || process.argv.length!==3) throw new AppError("FORBIDDEN");
 const command=process.argv[2];
 if(!["bootstrap","dispatch","prune","provision-demo","dispatch-demo-invites","prepare-demo-calendar","prepare-demo-history","prepare-demo-practice"].includes(command ?? "")) throw new AppError("INVALID_REQUEST");
 const runtime=await identityRuntime();
 const demoTarget=()=>{
  if(process.env.RAILWAY_PROJECT_ID!=="3b756632-1f66-4f75-a016-eabc37aa0d67" ||
     process.env.RAILWAY_SERVICE_ID!=="0267d061-f3ce-4a0a-82d4-ce133e4501e9" ||
     process.env.RAILWAY_ENVIRONMENT_ID!=="dd91bd71-57cc-45e6-a75b-8c858491d7c7" ||
     runtime.config.origin!=="https://life-skills.bneineviimacademy.org")throw new AppError("FORBIDDEN");
  const databaseUrl=process.env.LS_DATABASE_URL;
  if(!databaseUrl||process.env.LS_DATABASE_TLS!=="verify-full"||!process.env.LS_DATABASE_CA)throw new AppError("FORBIDDEN");
  const database=validateDatabaseUrl(databaseUrl,"verify-full");
  if(database.hostname!=="postgres.railway.internal"||database.pathname!=="/railway")throw new AppError("FORBIDDEN");
  return demoOperatorPlan({batch:process.env.LS_DEMO_BATCH_ID,ownerEmail:process.env.LS_DEMO_OWNER_EMAIL,
   parentEmail:process.env.LS_DEMO_PARENT_EMAIL,childEmail:process.env.LS_DEMO_CHILD_EMAIL,adultEmail:process.env.LS_DEMO_ADULT_EMAIL,
   setupRecipients:runtime.config.demoSetupRecipients,childAccountsEnabled:runtime.config.childAccountsEnabled===true});
 };
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
  if(process.env.LS_DEMO_PROVISION_APPROVED!=="true")throw new AppError("FORBIDDEN");
  const plan=demoTarget();
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
 }else if(command==="prepare-demo-calendar"){
  // No identity recreation, password reset, mail dispatch, fake payment or new
  // calendar provider authorization. This capability is not a startup task.
  if(process.env.LS_DEMO_CALENDAR_PREPARE_APPROVED!=="true")throw new AppError('FORBIDDEN');
  const {batch,ownerEmail,addresses}=demoTarget(),raw=process.env.LS_DEMO_CALENDAR_RECIPE_JSON;
  if(!raw||raw.length>65536)throw new AppError('INVALID_REQUEST');
  let recipe:unknown;try{recipe=JSON.parse(raw);}catch{throw new AppError('INVALID_REQUEST');}
  const plan=demoCalendarPlan(recipe,batch);
  const selected=await runtime.store.transaction(async tx=>{
   const cluster=await tx.query<{id:string}>('SELECT system_identifier::text AS id FROM pg_control_system()');
   if(cluster[0]?.id!=='7682781321794240577')throw new AppError('FORBIDDEN');
   const owner=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(ownerEmail,runtime.config.lookupKey));
   if(!owner||owner.role!=='practitioner'||owner.state!=='active'||!owner.emailVerifiedAt||
    await demoAccountBatch(tx,runtime.config.workspaceId,owner.id))throw new AppError('FORBIDDEN');
   const accounts:Record<string,AccountId>={};
   for(const [role,address] of Object.entries(addresses)){
    const a=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(address,runtime.config.lookupKey));
    if(!a||a.role!==(role==='adult'?'adult_client':role)||a.state!=='active'||!a.emailVerifiedAt||
     await demoAccountBatch(tx,runtime.config.workspaceId,a.id)!==batch)throw new AppError('CONFLICT');
    accounts[role]=a.id;
   }
   const cases=await tx.query<{caseId:CaseId;sourceKey:string;personId:string;kind:string}>(`SELECT d.case_id AS "caseId",d.source_key AS "sourceKey",cl.person_id AS "personId",p.kind
    FROM ls_demo.cases d JOIN ls_cases.cases c ON c.workspace_id=d.workspace_id AND c.id=d.case_id
    JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
    WHERE d.workspace_id=$1 AND d.batch_id=$2 AND d.source_key IN ('owner-minor-a','owner-adult-a')
    AND c.practitioner_account_id=$3 ORDER BY d.source_key`,[runtime.config.workspaceId,batch,owner.id]);
   if(cases.length!==2||new Set(cases.map(c=>c.sourceKey)).size!==2)throw new AppError('CONFLICT');
   for(const c of cases){
    const minor=c.sourceKey==='owner-minor-a',subject=accounts[minor?'child':'adult'];
    if(c.kind!==(minor?'minor':'adult')||!(await tx.query(`SELECT account_id FROM ls_identity.account_subjects
     WHERE workspace_id=$1 AND person_id=$2 AND account_id=$3`,[runtime.config.workspaceId,c.personId,subject])).length)throw new AppError('CONFLICT');
    const guardians=await tx.query<{id:AccountId}>('SELECT account_id AS id FROM ls_cases.case_guardians WHERE workspace_id=$1 AND case_id=$2 AND revoked_at IS NULL',[runtime.config.workspaceId,c.caseId]);
    if(minor&&(guardians.length!==1||guardians[0]?.id!==accounts.parent)||!minor&&guardians.length)throw new AppError('CONFLICT');
   }
   // Verify every proposed slot before the first setup write, then recheck in
   // each booking transaction to catch a concurrently created real appointment.
   for(const item of plan.items){
    const end=new Date(Date.parse(item.startsAt)+(item.kind==='individual'?60:15)*60_000).toISOString();
    if((await tx.query(`SELECT a.id FROM ls_calendar.appointments a WHERE a.workspace_id=$1 AND a.practitioner_id=$2
     AND a.status='scheduled' AND a.starts_at-a.buffer_before*interval '1 minute'<$4 AND a.ends_at+a.buffer_after*interval '1 minute'>$3
     AND NOT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=a.workspace_id AND d.case_id=a.case_id) LIMIT 1`,
     [runtime.config.workspaceId,owner.id,item.startsAt,end])).length)throw new AppError('CONFLICT');
   }
   return {ownerId:owner.id,accounts,cases};
  });
  const prepared=new Map<string,Awaited<ReturnType<typeof runtime.services.cases.prepareDemoCalendarAsOperator>>>();
  for(const c of selected.cases){
   const result=await runtime.services.cases.prepareDemoCalendarAsOperator(selected.ownerId,c.caseId,batch,
    `${batch}_calendar_prepare_${c.sourceKey}_v1`,newRequestId(),true);
   const expected=c.sourceKey==='owner-minor-a'?[selected.accounts.parent!,selected.accounts.child!]:[selected.accounts.adult!];
   if(JSON.stringify([...result.accountIds].sort())!==JSON.stringify(expected.sort()))throw new AppError('CONFLICT');
   prepared.set(c.sourceKey,result);
  }
  const calendar=new CalendarService(new CalendarStore(runtime.store,runtime.config.keyring,runtime.clock)),ids=new Map<string,AppointmentId>();
  for(const item of plan.items){
   const c=prepared.get(item.caseSource);if(!c)throw new AppError('CONFLICT');
   const parentForId=item.parentSourceKey?ids.get(item.parentSourceKey):null;
   if(item.parentSourceKey&&!parentForId)throw new AppError('CONFLICT');
   const result=await calendar.createDemoAsOperator(runtime.config.workspaceId,selected.ownerId,batch,item.commandKey,
    {caseId:c.caseId,audienceId:c.audienceId,kind:item.kind,startsAt:item.startsAt,parentForId:parentForId??null,
     parentIds:item.kind==='parent_guidance'?c.parentIds:[],bufferBefore:0,bufferAfter:0,location:item.location,checkinExceptionReason:null},true);
   ids.set(item.sourceKey,result.id);
  }
  process.stdout.write(JSON.stringify({command,result:'existing_demo_calendar_prepared',batch,createdOrReused:ids.size,
   accountChanges:0,providerEffects:0,paymentEffects:0})+'\n');
 }else if(command==="prepare-demo-practice"){
  if(process.env.LS_DEMO_PRACTICE_PREPARE_APPROVED!=="true")throw new AppError('FORBIDDEN');
  const selection=demoTarget(),raw=process.env.LS_DEMO_PRACTICE_RECIPE_JSON,date=process.env.LS_DEMO_PRACTICE_DATE;
  if(!raw||raw.length>65536||!date)throw new AppError('INVALID_REQUEST');
  let recipe:unknown;try{recipe=JSON.parse(raw);}catch{throw new AppError('INVALID_REQUEST');}
  const cluster=await runtime.store.transaction(tx=>tx.query<{id:string}>('SELECT system_identifier::text AS id FROM pg_control_system()'));
  if(cluster[0]?.id!=='7682781321794240577')throw new AppError('FORBIDDEN');
  const result=await prepareDemoPractice(runtime,selection,recipe,date,true);
  process.stdout.write(JSON.stringify({command,result:'existing_demo_practice_prepared',...result})+'\n');
 }else if(command==="prepare-demo-history"){
  if(process.env.LS_DEMO_HISTORY_PREPARE_APPROVED!=="true")throw new AppError('FORBIDDEN');
  const selection=demoTarget(),raw=process.env.LS_DEMO_HISTORY_RECIPE_JSON;
  if(!raw||raw.length>65536)throw new AppError('INVALID_REQUEST');
  let recipe:unknown;try{recipe=JSON.parse(raw);}catch{throw new AppError('INVALID_REQUEST');}
  const cluster=await runtime.store.transaction(tx=>tx.query<{id:string}>('SELECT system_identifier::text AS id FROM pg_control_system()'));
  if(cluster[0]?.id!=='7682781321794240577')throw new AppError('FORBIDDEN');
  const result=await prepareDemoHistory(runtime,selection,recipe,true);
  process.stdout.write(JSON.stringify({command,result:'existing_demo_history_prepared',...result})+'\n');
 }else if(command==="dispatch-demo-invites"){
  if(process.env.LS_DEMO_INVITE_DISPATCH_APPROVED!=="true")throw new AppError("FORBIDDEN");
  const {batch,ownerEmail,addresses}=demoTarget();
  const selected=await runtime.store.transaction(async tx=>{
   const owner=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(ownerEmail,runtime.config.lookupKey));
   if(!owner||owner.role!=="practitioner"||owner.state!=="active"||!owner.emailVerifiedAt||
      await demoAccountBatch(tx,runtime.config.workspaceId,owner.id))throw new AppError("FORBIDDEN");
   const ids:string[]=[];
   for(const [role,address] of Object.entries(addresses)){
    const account=await accountByEmail(tx,runtime.config.workspaceId,blindEmail(address,runtime.config.lookupKey));
    if(!account||account.role!==(role==="adult"?"adult_client":role)||account.state!=="invited"||
       await demoAccountBatch(tx,runtime.config.workspaceId,account.id)!==batch)throw new AppError("CONFLICT");
    ids.push(account.id);
   }
   const rows=await tx.query<DemoInviteMail>(`SELECT m.id,m.account_id AS "accountId",m.state,m.expires_at AS "expiresAt",m.next_attempt_at AS "nextAttemptAt"
    FROM ls_identity.auth_mail_outbox m JOIN ls_identity.auth_tokens t
     ON t.workspace_id=m.workspace_id AND t.account_id=m.account_id AND t.token_digest=m.token_digest AND t.purpose='invite'
    WHERE m.workspace_id=$1 AND m.account_id=ANY($2::uuid[]) AND m.kind='invite'
     AND m.state IN ('queued','sent','failed') AND m.expires_at>GREATEST($3::timestamptz,clock_timestamp())
     AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>GREATEST($3::timestamptz,clock_timestamp())`,
    [runtime.config.workspaceId,ids,runtime.clock.now()]);
   return demoInviteDispatchPlan(ids,rows,runtime.clock.now());
  });
  const email=createAuthEmailTransport(process.env);
  let sent=0;
  for(const id of selected.queuedIds){
   const outcome=await dispatchOneAuthMail(runtime.store,runtime.config,runtime.clock,email.transport,email.from,id);
   if(outcome!=="sent")throw new AppError("UNAVAILABLE");
   sent++;
  }
  process.stdout.write(JSON.stringify({command,result:"demo_invites_dispatched",sent,alreadySent:selected.alreadySent})+"\n");
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
