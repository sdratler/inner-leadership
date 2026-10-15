/** Isolated authenticated browser runner for the production-disabled Group Intake candidate.
 * Requires an already-migrated, disposable loopback PostgreSQL database. It never touches
 * production, creates CRM/case records for an inquiry, or calls a provider.
 */
import {spawn,execFileSync,type ChildProcess} from "node:child_process";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {existsSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {once} from "node:events";
import net from "node:net";
import {request as playwrightRequest} from "@playwright/test";
import {fixture,safeTestUrl} from "../../database/calendar/fixture.ts";
import {seal,tokenDigest,hashPassword,blindEmail} from "../../../src/features/identity/crypto.ts";
import type {CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {poolStore} from "../../database/calendar/fixture.ts";
import {privateDigest} from "../../../src/features/contact-ops/server/digests.ts";
import {floridaGroupApplicationNotice} from "../../../src/features/group-application/contract.ts";

const projects={desktop:3105,tablet768:3108,mobile390:3106,mobile340:3107} as const;
const project=process.env.LS_GROUP_INTEREST_TEST_PROJECT as keyof typeof projects|undefined;
const sampleOnly=process.env.LS_FLORIDA_SAMPLE_TEST_ONLY==="true";
const fishingOnly=process.env.LS_FISHING_LEAD_UI_ONLY==="true";
const educationOnly=process.env.LS_EDUCATION_UI_ONLY==="true";
const communityOnly=process.env.LS_COMMUNITY_UI_ONLY==="true";
if(communityOnly&&(project===undefined||educationOnly||fishingOnly||sampleOnly))throw new Error("COMMUNITY_EXCLUSIVE_EXPLICIT_PROJECT_REQUIRED");
if(educationOnly&&project===undefined)throw new Error("EDUCATION_UI_EXPLICIT_PROJECT_REQUIRED");
if(fishingOnly&&project===undefined)throw new Error("FISHING_UI_EXPLICIT_PROJECT_REQUIRED");
if(project!==undefined&&!(project in projects))throw new Error("GROUP_INTEREST_BROWSER_PROJECT_NOT_SUPPORTED");
if((sampleOnly||process.env.LS_FLORIDA_JOURNEY_TEST_ONLY==="true")&&project===undefined)throw new Error("FLORIDA_JOURNEY_EXPLICIT_PROJECT_REQUIRED");
if(process.env.LS_GROUP_INTEREST_TEST_ALLOW!=="true")throw new Error("GROUP_INTEREST_BROWSER_OPT_IN_REQUIRED");
const appPort=projects[project??"desktop"],origin=`https://localhost:${appPort}`;
safeTestUrl();
if(educationOnly){
 const probe=net.createServer();await new Promise<void>((resolve,reject)=>{probe.once("error",reject);probe.listen(appPort,"127.0.0.1",resolve);});
 await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
}
const folder=mkdtempSync(join(tmpdir(),"ls-group-interest-browser-"));
let app:ChildProcess|null=null,tests:ChildProcess|null=null;
let f:Awaited<ReturnType<typeof fixture>>|null=null,phase="fixture";
let communityTransport:Awaited<ReturnType<typeof import("../community/inbox-fixture.ts").communityReadTransport>>|null=null;
async function terminate(child:ChildProcess|null){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill("SIGTERM");await Promise.race([once(child,"exit"),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");}
let cleanupPromise:Promise<void>|null=null;
function cleanup(){cleanupPromise??=(async()=>{await terminate(tests);await terminate(app);await communityTransport?.close();await f?.pool.end();rmSync(folder,{recursive:true,force:true});})();return cleanupPromise;}
process.once("SIGTERM",()=>{void cleanup().finally(()=>process.exit(143));});
process.once("SIGINT",()=>{void cleanup().finally(()=>process.exit(130));});

type WorkspaceSnapshot={count:number;snapshot:string};
type BoundaryCounts={inquiries:number;operations:number;publicApplications:number;publicApplicationOperations:number;serviceInterests:number;serviceOperations:number;draftGroups:number;draftOperations:number;proposedPlacements:number;placementOperations:number;placementMoves:number;movementOperations:number;meetingRevisions:number;meetingOperations:number;practiceRevisions:number;practiceOperations:number;otherWorkspaceState:Record<string,WorkspaceSnapshot>};
const quoteIdentifier=(value:string)=>`"${value.replaceAll('"','""')}"`;
async function counts():Promise<BoundaryCounts>{
 const allowed=new Set(["ls_service_interest.public_applications","ls_service_interest.public_application_operations","ls_service_interest.inquiries","ls_service_interest.operations","ls_service_interest.service_interests","ls_service_interest.service_interest_operations",
  "ls_group_admin.draft_groups","ls_group_admin.draft_group_operations","ls_group_admin.proposed_placements","ls_group_admin.proposed_placement_operations",
  "ls_group_admin.proposed_placement_moves","ls_group_admin.proposed_placement_move_operations","ls_group_admin.draft_meeting_revisions","ls_group_admin.draft_meeting_operations",
  "ls_group_admin.fishing_practice_revisions","ls_group_admin.fishing_practice_operations"]);
 const inventory=await f!.pool.query<{schema:string;table:string}>(`SELECT c.table_schema AS schema,c.table_name AS table
  FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
  WHERE c.column_name='workspace_id' AND c.table_schema LIKE 'ls\\_%' ESCAPE '\\' AND t.table_type='BASE TABLE'
  ORDER BY c.table_schema,c.table_name`);
 const otherWorkspaceState:Record<string,WorkspaceSnapshot>={};
 for(const row of inventory.rows){const name=`${row.schema}.${row.table}`;if(allowed.has(name))continue;
  const result=await f!.pool.query<WorkspaceSnapshot>(`SELECT count(*)::integer AS count,
   COALESCE(jsonb_agg(to_jsonb(source) ORDER BY to_jsonb(source)::text),'[]'::jsonb)::text AS snapshot
   FROM ${quoteIdentifier(row.schema)}.${quoteIdentifier(row.table)} AS source WHERE workspace_id=$1`,[f!.workspaceId]);
  otherWorkspaceState[name]=result.rows[0]??{count:0,snapshot:"[]"};
 }
 const result=await f!.pool.query<Omit<BoundaryCounts,"otherWorkspaceState">>(`SELECT
  (SELECT count(*)::integer FROM ls_service_interest.public_applications WHERE workspace_id=$1) AS "publicApplications",
  (SELECT count(*)::integer FROM ls_service_interest.public_application_operations WHERE workspace_id=$1) AS "publicApplicationOperations",
  (SELECT count(*)::integer FROM ls_service_interest.inquiries WHERE workspace_id=$1) AS inquiries,
  (SELECT count(*)::integer FROM ls_service_interest.operations WHERE workspace_id=$1) AS operations,
  (SELECT count(*)::integer FROM ls_service_interest.service_interests WHERE workspace_id=$1) AS "serviceInterests",
  (SELECT count(*)::integer FROM ls_service_interest.service_interest_operations WHERE workspace_id=$1) AS "serviceOperations",
  (SELECT count(*)::integer FROM ls_group_admin.draft_groups WHERE workspace_id=$1) AS "draftGroups",
  (SELECT count(*)::integer FROM ls_group_admin.draft_group_operations WHERE workspace_id=$1) AS "draftOperations",
  (SELECT count(*)::integer FROM ls_group_admin.proposed_placements WHERE workspace_id=$1) AS "proposedPlacements",
  (SELECT count(*)::integer FROM ls_group_admin.proposed_placement_operations WHERE workspace_id=$1) AS "placementOperations",
  (SELECT count(*)::integer FROM ls_group_admin.proposed_placement_moves WHERE workspace_id=$1) AS "placementMoves",
  (SELECT count(*)::integer FROM ls_group_admin.proposed_placement_move_operations WHERE workspace_id=$1) AS "movementOperations",
  (SELECT count(*)::integer FROM ls_group_admin.draft_meeting_revisions WHERE workspace_id=$1) AS "meetingRevisions",
  (SELECT count(*)::integer FROM ls_group_admin.draft_meeting_operations WHERE workspace_id=$1) AS "meetingOperations",
  (SELECT count(*)::integer FROM ls_group_admin.fishing_practice_revisions WHERE workspace_id=$1) AS "practiceRevisions",
  (SELECT count(*)::integer FROM ls_group_admin.fishing_practice_operations WHERE workspace_id=$1) AS "practiceOperations"`,[f!.workspaceId]);
 return {...result.rows[0]!,otherWorkspaceState};
}

async function verifyDurableChildIdentity(){
 const linked=await f!.pool.query<{familyId:string;personId:string}>(`SELECT family_id AS "familyId",person_id AS "personId"
  FROM ls_service_interest.service_interests WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 1`,[f!.workspaceId]);
 const protectedMember=linked.rows[0];if(!protectedMember)throw new Error("GROUP_INTEREST_IDENTITY_FIXTURE_MISSING");
 await f!.pool.query("UPDATE ls_cases.family_members SET role='guardian' WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3",
  [f!.workspaceId,protectedMember.familyId,protectedMember.personId]).then(()=>{throw new Error("GROUP_INTEREST_ROLE_MUTATION_ACCEPTED");},error=>{if(error?.code!=="23503")throw error;});
 await f!.pool.query("UPDATE ls_identity.people SET kind='adult' WHERE workspace_id=$1 AND id=$2",
  [f!.workspaceId,protectedMember.personId]).then(()=>{throw new Error("GROUP_INTEREST_KIND_MUTATION_ACCEPTED");},error=>{if(error?.code!=="23503")throw error;});
 const candidate=await f!.pool.query<{familyId:string;personId:string}>(`SELECT fm.family_id AS "familyId",fm.person_id AS "personId"
  FROM ls_cases.family_members fm WHERE fm.workspace_id=$1 AND fm.role='child' AND NOT EXISTS(
   SELECT 1 FROM ls_service_interest.service_interests s
   WHERE s.workspace_id=fm.workspace_id AND s.family_id=fm.family_id AND s.person_id=fm.person_id)
  ORDER BY fm.family_id,fm.person_id LIMIT 1`,[f!.workspaceId]),source=await f!.pool.query<{id:string}>(`SELECT source_inquiry_id AS id
  FROM ls_service_interest.service_interests WHERE workspace_id=$1 AND service_type='tutoring' LIMIT 1`,[f!.workspaceId]);
 const member=candidate.rows[0],inquiry=source.rows[0];if(!member||!inquiry)throw new Error("GROUP_INTEREST_RACE_FIXTURE_MISSING");
 const updater=await f!.pool.connect(),inserter=await f!.pool.connect();
 try{
  await updater.query("BEGIN");await updater.query("UPDATE ls_cases.family_members SET role='guardian' WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3",
   [f!.workspaceId,member.familyId,member.personId]);
  let settled=false;const insert=inserter.query(`INSERT INTO ls_service_interest.service_interests
   (workspace_id,id,family_id,person_id,member_role,person_kind,service_type,source_inquiry_id,recorded_by,request_digest,created_at)
   VALUES($1,$2,$3,$4,'child','minor','group',$5,$6,$7,clock_timestamp())`,
   [f!.workspaceId,randomUUID(),member.familyId,member.personId,inquiry.id,f!.practitioner.actor.id,"e".repeat(64)]).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  await new Promise(resolve=>setTimeout(resolve,100));if(settled)throw new Error("GROUP_INTEREST_IDENTITY_RACE_DID_NOT_BLOCK");
  await updater.query("COMMIT");const error=await insert;if(error?.code!=="23503")throw new Error("GROUP_INTEREST_IDENTITY_RACE_ACCEPTED");
 }catch(error){await updater.query("ROLLBACK").catch(()=>undefined);throw error;}
 finally{updater.release();inserter.release();}
 await f!.pool.query("UPDATE ls_cases.family_members SET role='child' WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3",
  [f!.workspaceId,member.familyId,member.personId]);
}

async function verifyGroupPlacementDatabaseBoundary(){
 const placement=(await f!.pool.query<{id:string;draftGroupId:string;serviceInterestId:string;familyId:string;personId:string;recordedBy:string;requestDigest:string}>(`SELECT id,draft_group_id AS "draftGroupId",service_interest_id AS "serviceInterestId",family_id AS "familyId",person_id AS "personId",recorded_by AS "recordedBy",request_digest AS "requestDigest"
  FROM ls_group_admin.proposed_placements WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 1`,[f!.workspaceId])).rows[0];
 if(!placement)throw new Error("GROUP_PLACEMENT_FIXTURE_MISSING");
 await f!.pool.query("UPDATE ls_group_admin.proposed_placements SET person_id=$1 WHERE workspace_id=$2 AND id=$3",[randomUUID(),f!.workspaceId,placement.id]).then(()=>{throw new Error("GROUP_PLACEMENT_MUTATION_ACCEPTED");},error=>{if(error?.code!=="23514")throw error;});
 const tutoring=(await f!.pool.query<{id:string;familyId:string;personId:string}>(`SELECT id,family_id AS "familyId",person_id AS "personId" FROM ls_service_interest.service_interests
  WHERE workspace_id=$1 AND service_type='tutoring' ORDER BY created_at,id LIMIT 1`,[f!.workspaceId])).rows[0];
 if(!tutoring)throw new Error("GROUP_PLACEMENT_TUTORING_FIXTURE_MISSING");
 await f!.pool.query(`INSERT INTO ls_group_admin.proposed_placements(workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id,recorded_by,request_digest,created_at)
  VALUES($1,$2,$3,$4,'group',$5,$6,$7,$8,clock_timestamp())`,[f!.workspaceId,randomUUID(),placement.draftGroupId,tutoring.id,tutoring.familyId,tutoring.personId,placement.recordedBy,"9".repeat(64)]).then(()=>{throw new Error("GROUP_PLACEMENT_TUTORING_ACCEPTED");},error=>{if(error?.code!=="23503")throw error;});
 await f!.pool.query(`INSERT INTO ls_group_admin.proposed_placements(workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id,recorded_by,request_digest,created_at)
  VALUES($1,$2,$3,$4,'group',$5,$6,$7,$8,clock_timestamp())`,[f!.workspaceId,randomUUID(),placement.draftGroupId,placement.serviceInterestId,placement.familyId,placement.personId,placement.recordedBy,"8".repeat(64)]).then(()=>{throw new Error("GROUP_PLACEMENT_DUPLICATE_ACCEPTED");},error=>{if(error?.code!=="23505")throw error;});
 const operationId=randomUUID(),first=await f!.pool.connect(),second=await f!.pool.connect();try{
  await first.query("BEGIN");await first.query(`INSERT INTO ls_group_admin.proposed_placement_operations
   (workspace_id,operation_id,recorded_by,request_digest,proposed_placement_id) VALUES($1,$2,$3,$4,$5)`,[f!.workspaceId,operationId,placement.recordedBy,placement.requestDigest,placement.id]);
  let settled=false;const duplicate=second.query(`INSERT INTO ls_group_admin.proposed_placement_operations
   (workspace_id,operation_id,recorded_by,request_digest,proposed_placement_id) VALUES($1,$2,$3,$4,$5)`,[f!.workspaceId,operationId,placement.recordedBy,placement.requestDigest,placement.id]).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  await new Promise(resolve=>setTimeout(resolve,100));if(settled)throw new Error("GROUP_PLACEMENT_RACE_DID_NOT_BLOCK");await first.query("COMMIT");const error=await duplicate;if(error?.code!=="23505")throw new Error("GROUP_PLACEMENT_DUPLICATE_RACE_ACCEPTED");
 }catch(error){await first.query("ROLLBACK").catch(()=>undefined);throw error;}finally{first.release();second.release();}
 const movement=(await f!.pool.query<{id:string}>("SELECT id FROM ls_group_admin.proposed_placement_moves WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 1",[f!.workspaceId])).rows[0];
 if(!movement)throw new Error("GROUP_PLACEMENT_MOVEMENT_FIXTURE_MISSING");
 await f!.pool.query("UPDATE ls_group_admin.proposed_placement_moves SET recorded_by=$1 WHERE workspace_id=$2 AND id=$3",[randomUUID(),f!.workspaceId,movement.id]).then(()=>{throw new Error("GROUP_PLACEMENT_MOVEMENT_MUTATION_ACCEPTED");},error=>{if(error?.code!=="23514")throw error;});
 await f!.pool.query("DELETE FROM ls_group_admin.proposed_placement_move_operations WHERE workspace_id=$1 AND proposed_placement_move_id=$2",[f!.workspaceId,movement.id]).then(()=>{throw new Error("GROUP_PLACEMENT_MOVEMENT_RECEIPT_DELETE_ACCEPTED");},error=>{if(error?.code!=="23514")throw error;});
}

try{
 const workspaceId=randomUUID(),dataKey=randomBytes(32),lookupKey=randomBytes(32),keyring={activeKeyId:"synthetic",keys:{synthetic:dataKey}};
 f=await fixture({workspaceId,keyring,termsVersion:"Synthetic Group Interest"});
 await f.seed("2026-10-10T08:00:00.000Z");
 await f.seed("2026-10-11T08:00:00.000Z");
 await f.pool.query(`INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role)
  SELECT c.workspace_id,c.family_id,cl.person_id,'child' FROM ls_cases.cases c
  JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
  WHERE c.workspace_id=$1 AND c.id=ANY($2::uuid[])`,[workspaceId,[f.first.id,f.second.id]]);
 async function deniedAccount(role:"adult_client"|"child"|"practitioner",targetWorkspace=workspaceId,revoked=false){
  if(targetWorkspace!==workspaceId)await f!.pool.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,clock_timestamp())",[targetWorkspace]);
  const id=randomUUID(),personId=randomUUID(),token=randomBytes(32).toString("base64url"),now=new Date(),kind=role==="child"?"minor":"adult";
  await f!.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,$3,$4,$5)",[personId,targetWorkspace,kind,seal(JSON.stringify({displayName:`Synthetic denied ${role}`}),`person:${targetWorkspace}:${personId}`,keyring),now]);
  await f!.pool.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
   VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-non-login-hash',$6,$6)`,[id,targetWorkspace,role,createHash("sha256").update(id).digest("hex"),seal(`synthetic-${id}@example.invalid`,`email:${targetWorkspace}:${id}`,keyring),now]);
  await f!.pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[targetWorkspace,id,personId]);
  await f!.pool.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6)",[tokenDigest(token),targetWorkspace,id,now,new Date(now.getTime()+3600000),revoked?now:null]);
  return token;
 }
 const adult=await deniedAccount("adult_client"),child=await deniedAccount("child"),revoked=await deniedAccount("adult_client",workspaceId,true),otherWorkspace=await deniedAccount("practitioner",randomUUID());
 const publicApplicationId=randomUUID(),publicApplicationOperationId=randomUUID(),publicApplicationFields={parentName:"Synthetic public applicant",contact:"synthetic@example.invalid",language:"en" as const,childAge:"10",cityArea:"Hollywood, Florida",neighborhood:"Synthetic neighborhood",programId:"sunday_fishing_academy" as const,schedulePreference:["sunday","flexible"] as const,scheduleNotes:"Synthetic scheduling details only.",permission:{confirmed:true as const,version:floridaGroupApplicationNotice.version,language:"en" as const}};
 const digestKey=lookupKey.toString("hex"),publicRequestDigest=privateDigest({domain:"public-group-application/v1",workspace:workspaceId,fields:publicApplicationFields},digestKey),publicContactDigest=privateDigest({domain:"public-group-application-contact/v1",workspace:workspaceId,contact:publicApplicationFields.contact},digestKey);
 await f.pool.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,[workspaceId,publicApplicationId,publicContactDigest,publicRequestDigest,seal(JSON.stringify(publicApplicationFields),`ls_service_interest/public_application/v1/${workspaceId}/${publicApplicationId}`,keyring),floridaGroupApplicationNotice.version,"en"]);
 await f.pool.query(`INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)`,[workspaceId,publicApplicationOperationId,publicRequestDigest,publicApplicationId]);
 const baseline=await counts();
 let fishingRuntime:object|null=null,fishingBefore:unknown=null,fishingProtectedPerson:string|null=null;
 const protectedFishingTables=["ls_calendar.tasks","ls_calendar.task_history","ls_calendar.appointments","ls_identity.accounts","ls_identity.account_subjects",
  "ls_cases.cases","ls_cases.case_guardians","ls_contact_ops.outbound_projections","ls_identity.auth_mail_outbox","ls_onboarding.first_session_orders"];
 const fishingSnapshot=async()=>Promise.all(protectedFishingTables.map(async table=>({table,rows:(await f!.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[workspaceId])).rows})));
 let protectedProfile:unknown=null;
 if(fishingOnly){
  const {ContactCutoverStore}=await import("../../../src/features/contact-ops/server/cutover-store.ts"),
   {OperationalNativeCrmStore}=await import("../../../src/features/contact-ops/server/operational-store.ts"),
   {FishingLeadStore}=await import("../../../src/features/contact-ops/server/fishing-lead-store.ts"),
   {PublicGroupApplicationStore}=await import("../../../src/features/group-application/store.ts");
  const db=poolStore(f.pool),key=lookupKey.toString("hex"),authority=new ContactCutoverStore(db,keyring,key),crm=new OperationalNativeCrmStore(db,keyring,key);
  const proof=(expectedEpoch:number):CutoverEvidence=>({batchId:"synthetic-fishing-browser",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",expectedEpoch,observedNativeWritesSinceSwitch:0,
   backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,
   consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true}); // Disposable fixture only; not real cutover evidence.
  await authority.advance(f.practitioner.actor,{action:"prepare",operationId:"fixture-prepare",proof:proof(0)});
  await authority.advance(f.practitioner.actor,{action:"freeze",operationId:"fixture-freeze",proof:proof(1)});
  await authority.advance(f.practitioner.actor,{action:"switch_native",operationId:"fixture-switch",proof:proof(2)});
  const credentials:{role:"practitioner"|"parent";email:string;password:string}[]=[];
  for(const [role,account] of [["practitioner",f.practitioner],["parent",f.parent]] as const){
   const email=`synthetic-fishing-${role}@example.invalid`,password=randomBytes(18).toString("base64url");
   await f.pool.query("UPDATE ls_identity.accounts SET password_hash=$3,email_blind=$4,email_ciphertext=$5 WHERE workspace_id=$1 AND id=$2",
    [workspaceId,account.actor.id,await hashPassword(password),blindEmail(email,lookupKey),seal(email,`email:${workspaceId}:${account.actor.id}`,keyring)]);
   credentials.push({role,email,password});
  }
  const existing=await crm.createContact(f.practitioner.actor,{name:"Synthetic preserved contact",phone:"+13055550108",language:"he",source:"synthetic-browser",
   notes:"Original synthetic note\nהערה מקורית",nextAction:"Retain existing action",dueDate:"2026-10-30"},randomUUID(),3);
  fishingProtectedPerson=existing.personId;
  await f.pool.query("INSERT INTO ls_calendar.tasks(workspace_id,id,created_by,title_ciphertext,due_date) VALUES($1,$2,$3,'synthetic-retained-task','2026-10-30')",[workspaceId,randomUUID(),f.practitioner.actor.id]);
  protectedProfile=(await f.pool.query("SELECT to_jsonb(p) AS row FROM ls_contact_ops.profiles p WHERE workspace_id=$1 AND person_id=$2",[workspaceId,existing.personId])).rows;
  // Synthetic provider-fault states in actual native storage, not mocked data
  // API replies or a claim about a live provider. Original profile remains exact.
  for(const program of ["sunday_fishing_academy","private_fishing_life_skills"] as const){
   const membership=new FishingLeadStore(db,keyring,key,program),preview=await membership.preview(f.practitioner.actor,
    {action:"preview_add",operationId:randomUUID(),expectedEpoch:3,source:{kind:"person",id:existing.personId},expectedAssociationVersion:0,relationship:"adult_partner"});
   if(preview.state!=="ready")throw new Error("FISHING_LABEL_UI_SEED_PREVIEW");await membership.confirm(f.practitioner.actor,{action:"confirm",token:preview.token,confirmNewPerson:false});
   const projection=(await membership.read(f.practitioner.actor,existing.personId,3)).projection!;
   await membership.recordLabelProjection(f.practitioner.actor,3,projection,program==="sunday_fishing_academy"?
    {...projection,status:"unsupported",capability:{accountId:"synthetic-browser-channel",labelsSupported:false,checkedAt:new Date().toISOString()}}:
    {...projection,status:"outcome_unknown",binding:{accountId:"synthetic-browser-channel",managedLabelId:"16",chatId:"13055550108@s.whatsapp.net"}});
  }
  const inquiries=[];
  for(const [locale,contact] of [["en","+13055550109"],["he","+13055550110"]] as const){
   const saved=await new PublicGroupApplicationStore(db,f.workspaceId,keyring,key).submit({operationId:randomUUID(),fields:{parentName:`Synthetic fishing ${locale}`,contact,language:locale,
    cityArea:"Synthetic Florida",programId:"sunday_fishing_academy",schedulePreference:["sunday"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:locale}}});
   inquiries.push({locale,id:saved.item.id,name:`Synthetic fishing ${locale}`});
  }
  await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1",[workspaceId]);
  fishingRuntime={credentials,inquiries,protectedPersonId:existing.personId};fishingBefore=await fishingSnapshot();
 }
 // Ordinary Group Intake callers have no react-server loader condition. Do not
 // load the education-only native module into those unchanged test paths.
 const educationModule=educationOnly?await import("../resources/education-fixture.ts"):null;
 const educationRuntime=educationModule?await educationModule.educationBrowserFixture(f,lookupKey):null;
 const educationBefore=educationModule?await educationModule.educationProtectedSnapshot(f):null;
 const communityModule=communityOnly?await import("../community/inbox-fixture.ts"):null;
 const communityLogin=communityModule?await communityModule.communityCredentials(f,lookupKey):null;
 const communityBefore=communityModule?await communityModule.communityProtectedSnapshot(f):null;
 const originalPublic=await f.pool.query("SELECT to_jsonb(a)::text AS snapshot FROM ls_service_interest.public_applications a WHERE workspace_id=$1 AND id=$2",[workspaceId,publicApplicationId]);
 if(baseline.inquiries!==0||baseline.operations!==0||baseline.serviceInterests!==0||baseline.serviceOperations!==0||baseline.draftGroups!==0||baseline.draftOperations!==0||baseline.proposedPlacements!==0||baseline.placementOperations!==0||baseline.placementMoves!==0||baseline.movementOperations!==0||baseline.meetingRevisions!==0||baseline.meetingOperations!==0||baseline.practiceRevisions!==0||baseline.practiceOperations!==0)throw new Error("GROUP_INTEREST_FIXTURE_NOT_EMPTY");
 const runtimePath=join(folder,"synthetic-runtime.json");
 const runtime={origin,workspaceId,practitioner:f.practitioner.token,parent:f.parent.token,adult,child,revoked,otherWorkspace,publicApplicationId,publicApplicantName:publicApplicationFields.parentName,...(fishingRuntime?{fishing:fishingRuntime}:{}),...(educationRuntime?{education:educationRuntime}:{})};
 writeFileSync(runtimePath,JSON.stringify(runtime),{mode:0o600});
 const key=join(folder,"tls.key"),cert=join(folder,"tls.crt");
 phase="tls-certificate";
 const gitOpenSsl="C:/Program Files/Git/mingw64/bin/openssl.exe",openssl=process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl";
 execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"+(communityOnly?",DNS:community-scout-production.up.railway.app":"")],{stdio:"ignore"});
 if(communityModule){
  const {readFileSync}=await import("node:fs");communityTransport=await communityModule.communityReadTransport(readFileSync(key),readFileSync(cert));
  writeFileSync(runtimePath,JSON.stringify({...runtime,community:{credentials:communityLogin,controlOrigin:communityTransport.controlOrigin,secret:communityTransport.secret}}),{mode:0o600});
 }
 phase="next-app-start";
 const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:origin,
  LS_DATABASE_URL:safeTestUrl(),LS_DATABASE_TLS:"disable",LS_PRIVATE_APP_ENABLED:"true",LS_IDENTITY_ENABLED:"true",LS_GROUP_INTEREST_CANDIDATE:"true",LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK:"true",
  LS_IDENTITY_WORKSPACE_ID:workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:"synthetic",LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:dataKey.toString("base64url")}),
  LS_IDENTITY_CSRF_KEY:randomBytes(32).toString("base64url"),LS_IDENTITY_LOOKUP_KEY:lookupKey.toString("base64url"),LS_IDENTITY_RATE_KEY:randomBytes(32).toString("base64url"),
  LS_GROUP_INTEREST_FIXTURE_PATH:runtimePath,LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE:"true",
  ...(educationOnly?{LS_EDUCATION_SYNTHETIC_LOOPBACK:"true",TEST_DATABASE_URL:safeTestUrl(),LS_CHILD_ACCOUNTS_ENABLED:"false",LS_AUTH_EMAIL_ENABLED:"false"}:{})};
 if(communityTransport)Object.assign(env,{LS_COMMUNITY_SCOUT_BRIDGE_SECRET:communityTransport.secret,HTTP_PROXY:communityTransport.proxy,HTTPS_PROXY:communityTransport.proxy,
  NO_PROXY:"localhost,127.0.0.1",NODE_USE_ENV_PROXY:"1",NODE_EXTRA_CA_CERTS:cert,LS_AUTH_EMAIL_ENABLED:"false"});
 app=spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--experimental-https","--experimental-https-key",key,"--experimental-https-cert",cert,"--hostname","127.0.0.1","--port",String(appPort)],{env,stdio:"ignore"});
 phase="next-health";let healthy=false;const probe=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 try{for(let i=0;i<240;i++){if(app.exitCode!==null)throw new Error("ISOLATED_APP_START_FAILED");try{if((await probe.get("/api/health")).status()===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}}finally{await probe.dispose();}
 if(!healthy)throw new Error("ISOLATED_APP_HEALTH_TIMEOUT");
 phase="browser-tests";
 const selection=project?["--project",project,"--output",`tests/e2e/group-interest/test-results/isolated-${project}`]:[];
 if(!fishingOnly&&process.env.LS_GROUP_INTEREST_PUBLIC_ONLY==="true")selection.push("--grep","Florida group inquiry|Israel group application compatibility");
 if(process.env.LS_GROUP_INTEREST_CAPTURE_ONLY==="true")selection.push("--grep","practitioner");
 if(communityOnly){/* Explicit focused read-only Community journey, not a default-suite skip. */}
 else if(educationOnly){/* Existing Playwright config selects the retained Resources journey. */}
 else if(fishingOnly){/* Selection is the retained mounted fishing spec in the same isolated harness. */}
 else if(sampleOnly)selection.push("--grep","Florida owner journey hosted sample");
 else if(process.env.LS_FLORIDA_JOURNEY_TEST_ONLY==="true")selection.push("--grep",process.env.LS_FLORIDA_INSTITUTION_TEST_ONLY==="true"?"Florida owner journey school inquiry|Florida owner journey.*native inquiry replay|Florida owner journey authorization":"Florida owner journey");
 else selection.push("--grep-invert","Florida owner journey");
 const testEnv=educationModule?educationModule.educationBrowserTestEnvironment(env,process.env):env;
 tests=spawn(process.execPath,[resolve("node_modules/@playwright/test/cli.js"),"test","--config","tests/e2e/group-interest/playwright.config.ts",...selection],{env:testEnv,stdio:["ignore","inherit","inherit"]});
 const [code]=await once(tests,"exit");if(code!==0)throw new Error("GROUP_INTEREST_BROWSER_ACCEPTANCE_FAILED");
 if(communityOnly){
  if(!communityModule||!communityTransport)throw new Error("COMMUNITY_FIXTURE_MISSING");
  if(JSON.stringify(await communityModule.communityProtectedSnapshot(f))!==JSON.stringify(communityBefore))throw new Error("COMMUNITY_FORBIDDEN_DATABASE_EFFECT");
  if(communityTransport.blocked.length||!communityTransport.reads.includes("/internal/life-skills/posts"))throw new Error("COMMUNITY_UPSTREAM_BOUNDARY_NOT_PROVED");
  console.log(`COMMUNITY_UI_ACCEPTANCE_PASS project=${project} ordinaryLogin=true upstream=synthetic-loopback readonly=true unrelatedEffects=0`);
 }
 else if(educationOnly){
  if(!educationModule)throw new Error("EDUCATION_FIXTURE_NOT_READY");
  phase="education-native-readback";
  if(JSON.stringify(await educationModule.educationProtectedSnapshot(f))!==JSON.stringify(educationBefore))throw new Error("EDUCATION_UI_FORBIDDEN_DATABASE_EFFECT");
  const count=(await f.pool.query("SELECT count(*)::int AS total FROM ls_education.lesson_events WHERE workspace_id=$1",[workspaceId])).rows[0].total;
  if(count!==9)throw new Error("EDUCATION_UI_EVENT_REPLAY_OR_FLOW_INCOMPLETE");
  console.log(`EDUCATION_BROWSER_ACCEPTANCE_PASS project=${project} ordinaryLogin=true events=${count} unrelatedEffects=0 providerEffects=0`);
 }
 else if(fishingOnly){
  phase="fishing-ui-native-readback";
  if(JSON.stringify(await fishingSnapshot())!==JSON.stringify(fishingBefore))throw new Error("FISHING_UI_FORBIDDEN_DATABASE_EFFECT");
  const profile=(await f.pool.query("SELECT to_jsonb(p) AS row FROM ls_contact_ops.profiles p WHERE workspace_id=$1 AND person_id=$2",[workspaceId,fishingProtectedPerson])).rows;
  if(JSON.stringify(profile)!==JSON.stringify(protectedProfile))throw new Error("FISHING_UI_EXISTING_PROFILE_CHANGED");
  const rows=await f.pool.query(`SELECT (SELECT count(*)::int FROM ls_contact_ops.fishing_lead_revisions WHERE workspace_id=$1) AS revisions,
   (SELECT count(*)::int FROM ls_contact_ops.fishing_lead_operations WHERE workspace_id=$1) AS operations,
   (SELECT count(*)::int FROM ls_contact_ops.profiles WHERE workspace_id=$1) AS profiles,
   (SELECT count(*)::int FROM ls_contact_ops.fishing_label_projection WHERE workspace_id=$1) AS projections`,[workspaceId]);
  if(JSON.stringify(rows.rows[0])!==JSON.stringify({revisions:10,operations:10,profiles:3,projections:4}))throw new Error("FISHING_UI_NATIVE_COUNTS_MISMATCH");
  console.log(`FISHING_LEAD_UI_ACCEPTANCE_PASS project=${project} ordinaryLogin=true revisions=10 operations=10 profiles=3 projections=4 tasksUnchanged=true unrelatedProfileUnchanged=true providerEffects=0`);
 }
 else if(process.env.LS_GROUP_INTEREST_PUBLIC_ONLY==="true"){
  phase="public-boundary-readback";const after=await counts(),writes=project===undefined||project==="desktop"?2:1;
  const expected={...baseline,publicApplications:baseline.publicApplications+writes,publicApplicationOperations:baseline.publicApplicationOperations+writes};
  if(JSON.stringify(after)!==JSON.stringify(expected))throw new Error("FLORIDA_PUBLIC_UNEXPECTED_DATABASE_EFFECT");
  const retainedPublic=await f.pool.query("SELECT to_jsonb(a)::text AS snapshot FROM ls_service_interest.public_applications a WHERE workspace_id=$1 AND id=$2",[workspaceId,publicApplicationId]);
  if(JSON.stringify(retainedPublic.rows)!==JSON.stringify(originalPublic.rows))throw new Error("FLORIDA_PUBLIC_EXISTING_RECEIPT_MUTATED");
  console.log(`FLORIDA_PUBLIC_BROWSER_ACCEPTANCE_PASS project=${project??"all"} inquiries=${writes} operations=${writes} otherDatabaseEffects=0 providerEffects=0`);
 }
 else if(sampleOnly||process.env.LS_FLORIDA_JOURNEY_TEST_ONLY==="true"){
  phase="journey-boundary-readback";
  const after=await counts();
  const writes=sampleOnly?0:8,expected={...baseline,publicApplications:baseline.publicApplications+writes,publicApplicationOperations:baseline.publicApplicationOperations+writes};
  if(JSON.stringify(after)!==JSON.stringify(expected))throw new Error("FLORIDA_JOURNEY_UNEXPECTED_DATABASE_EFFECT");
  const retainedPublic=await f.pool.query("SELECT to_jsonb(a)::text AS snapshot FROM ls_service_interest.public_applications a WHERE workspace_id=$1 AND id=$2",[workspaceId,publicApplicationId]);
  if(JSON.stringify(retainedPublic.rows)!==JSON.stringify(originalPublic.rows))throw new Error("FLORIDA_JOURNEY_EXISTING_RECEIPT_MUTATED");
  console.log(`FLORIDA_JOURNEY_ACCEPTANCE_PASS project=${project??"all"} inquiries=${writes} operations=${writes} otherDatabaseEffects=0 providerEffects=0 downstream=sample`);
 }
 else{
 phase="durable-child-identity";await verifyDurableChildIdentity();
 phase="group-placement-database-boundary";await verifyGroupPlacementDatabaseBoundary();
 phase="boundary-readback";
 const after=await counts();
 if(JSON.stringify(after.otherWorkspaceState)!==JSON.stringify(baseline.otherWorkspaceState))throw new Error("GROUP_INTEREST_WORKSPACE_SIDE_EFFECT");
 const publicWrites=project===undefined||project==="desktop"?2:1;
 if(after.publicApplications!==baseline.publicApplications+publicWrites||after.publicApplicationOperations!==baseline.publicApplicationOperations+publicWrites)throw new Error("GROUP_INTEREST_PUBLIC_RECEIPT_COUNT_MISMATCH");
 const retainedPublic=await f.pool.query("SELECT to_jsonb(a)::text AS snapshot FROM ls_service_interest.public_applications a WHERE workspace_id=$1 AND id=$2",[workspaceId,publicApplicationId]);
 if(JSON.stringify(retainedPublic.rows)!==JSON.stringify(originalPublic.rows))throw new Error("GROUP_INTEREST_EXISTING_PUBLIC_RECEIPT_MUTATED");
 if(after.inquiries!==baseline.inquiries+3||after.operations!==baseline.operations+3||after.serviceInterests!==baseline.serviceInterests+4||after.serviceOperations!==baseline.serviceOperations+5||after.draftGroups!==baseline.draftGroups+8||after.draftOperations!==baseline.draftOperations+8||after.proposedPlacements!==baseline.proposedPlacements+8||after.placementOperations!==baseline.placementOperations+8||after.placementMoves!==baseline.placementMoves+4||after.movementOperations!==baseline.movementOperations+4||after.meetingRevisions!==baseline.meetingRevisions+4||after.meetingOperations!==baseline.meetingOperations+4||after.practiceRevisions!==baseline.practiceRevisions+42||after.practiceOperations!==baseline.practiceOperations+42)throw new Error("GROUP_INTEREST_RECEIPT_COUNT_MISMATCH");
 console.log(`GROUP_INTEREST_ACCEPTANCE_PASS project=${project??"all"} inquiries=3 serviceInterests=4 draftGroups=8 proposedPlacements=8 placementOperations=8 placementMoves=4 movementOperations=4 meetingRevisions=4 meetingOperations=4 practiceRevisions=42 practiceOperations=42 pagedHistory=42 sideEffects=0`);
 }
}catch(error){console.error(`Group Intake browser verification failed at ${phase} (${error instanceof Error?error.message:"unknown error"}). No production or provider state was used.`);process.exitCode=1;}
finally{await cleanup();}
