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
import {request as playwrightRequest} from "@playwright/test";
import {fixture,safeTestUrl} from "../../database/calendar/fixture.ts";
import {seal,tokenDigest} from "../../../src/features/identity/crypto.ts";

const projects={desktop:3105,mobile390:3106,mobile340:3107} as const;
const project=process.env.LS_GROUP_INTEREST_TEST_PROJECT as keyof typeof projects|undefined;
if(project!==undefined&&!(project in projects))throw new Error("GROUP_INTEREST_BROWSER_PROJECT_NOT_SUPPORTED");
if(process.env.LS_GROUP_INTEREST_TEST_ALLOW!=="true")throw new Error("GROUP_INTEREST_BROWSER_OPT_IN_REQUIRED");
const appPort=projects[project??"desktop"],origin=`https://localhost:${appPort}`;
safeTestUrl();
const folder=mkdtempSync(join(tmpdir(),"ls-group-interest-browser-"));
let app:ChildProcess|null=null,tests:ChildProcess|null=null;
let f:Awaited<ReturnType<typeof fixture>>|null=null,phase="fixture";
async function terminate(child:ChildProcess|null){if(!child||child.exitCode!==null)return;child.kill("SIGTERM");await Promise.race([once(child,"exit"),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill("SIGKILL");}
let cleanupPromise:Promise<void>|null=null;
function cleanup(){cleanupPromise??=(async()=>{await terminate(tests);await terminate(app);await f?.pool.end();rmSync(folder,{recursive:true,force:true});})();return cleanupPromise;}
process.once("SIGTERM",()=>{void cleanup().finally(()=>process.exit(143));});
process.once("SIGINT",()=>{void cleanup().finally(()=>process.exit(130));});

type WorkspaceSnapshot={count:number;snapshot:string};
type BoundaryCounts={inquiries:number;operations:number;serviceInterests:number;serviceOperations:number;draftGroups:number;draftOperations:number;proposedPlacements:number;placementOperations:number;otherWorkspaceState:Record<string,WorkspaceSnapshot>};
const quoteIdentifier=(value:string)=>`"${value.replaceAll('"','""')}"`;
async function counts():Promise<BoundaryCounts>{
 const allowed=new Set(["ls_service_interest.inquiries","ls_service_interest.operations","ls_service_interest.service_interests","ls_service_interest.service_interest_operations",
  "ls_group_admin.draft_groups","ls_group_admin.draft_group_operations","ls_group_admin.proposed_placements","ls_group_admin.proposed_placement_operations"]);
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
  (SELECT count(*)::integer FROM ls_service_interest.inquiries WHERE workspace_id=$1) AS inquiries,
  (SELECT count(*)::integer FROM ls_service_interest.operations WHERE workspace_id=$1) AS operations,
  (SELECT count(*)::integer FROM ls_service_interest.service_interests WHERE workspace_id=$1) AS "serviceInterests",
  (SELECT count(*)::integer FROM ls_service_interest.service_interest_operations WHERE workspace_id=$1) AS "serviceOperations",
  (SELECT count(*)::integer FROM ls_group_admin.draft_groups WHERE workspace_id=$1) AS "draftGroups",
  (SELECT count(*)::integer FROM ls_group_admin.draft_group_operations WHERE workspace_id=$1) AS "draftOperations",
  (SELECT count(*)::integer FROM ls_group_admin.proposed_placements WHERE workspace_id=$1) AS "proposedPlacements",
  (SELECT count(*)::integer FROM ls_group_admin.proposed_placement_operations WHERE workspace_id=$1) AS "placementOperations"`,[f!.workspaceId]);
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
}

try{
 const workspaceId=randomUUID(),dataKey=randomBytes(32),lookupKey=randomBytes(32),keyring={activeKeyId:"synthetic",keys:{synthetic:dataKey}};
 f=await fixture({workspaceId,keyring,termsVersion:"Synthetic Group Interest"});
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
 const baseline=await counts();
 if(baseline.inquiries!==0||baseline.operations!==0||baseline.serviceInterests!==0||baseline.serviceOperations!==0||baseline.draftGroups!==0||baseline.draftOperations!==0||baseline.proposedPlacements!==0||baseline.placementOperations!==0)throw new Error("GROUP_INTEREST_FIXTURE_NOT_EMPTY");
 const runtimePath=join(folder,"synthetic-runtime.json");
 writeFileSync(runtimePath,JSON.stringify({origin,workspaceId,practitioner:f.practitioner.token,parent:f.parent.token,adult,child,revoked,otherWorkspace}),{mode:0o600});
 const key=join(folder,"tls.key"),cert=join(folder,"tls.crt");
 phase="tls-certificate";
 const gitOpenSsl="C:/Program Files/Git/mingw64/bin/openssl.exe",openssl=process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl";
 execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"],{stdio:"ignore"});
 phase="next-app-start";
 const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",LS_APP_MODE:"foundation_preview",LS_APP_ORIGIN:origin,
  LS_DATABASE_URL:safeTestUrl(),LS_DATABASE_TLS:"disable",LS_PRIVATE_APP_ENABLED:"true",LS_IDENTITY_ENABLED:"true",LS_GROUP_INTEREST_CANDIDATE:"true",
  LS_IDENTITY_WORKSPACE_ID:workspaceId,LS_IDENTITY_ACTIVE_KEY_ID:"synthetic",LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:dataKey.toString("base64url")}),
  LS_IDENTITY_CSRF_KEY:randomBytes(32).toString("base64url"),LS_IDENTITY_LOOKUP_KEY:lookupKey.toString("base64url"),LS_IDENTITY_RATE_KEY:randomBytes(32).toString("base64url"),
  LS_GROUP_INTEREST_FIXTURE_PATH:runtimePath,LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE:"true"};
 app=spawn(process.execPath,[resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--experimental-https","--experimental-https-key",key,"--experimental-https-cert",cert,"--hostname","127.0.0.1","--port",String(appPort)],{env,stdio:"ignore"});
 phase="next-health";let healthy=false;const probe=await playwrightRequest.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 try{for(let i=0;i<240;i++){if(app.exitCode!==null)throw new Error("ISOLATED_APP_START_FAILED");try{if((await probe.get("/api/health")).status()===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}}finally{await probe.dispose();}
 if(!healthy)throw new Error("ISOLATED_APP_HEALTH_TIMEOUT");
 phase="browser-tests";
 const selection=project?["--project",project,"--output",`tests/e2e/group-interest/test-results/isolated-${project}`]:[];
 tests=spawn(process.execPath,[resolve("node_modules/@playwright/test/cli.js"),"test","--config","tests/e2e/group-interest/playwright.config.ts",...selection],{env,stdio:["ignore","inherit","inherit"]});
 const [code]=await once(tests,"exit");if(code!==0)throw new Error("GROUP_INTEREST_BROWSER_ACCEPTANCE_FAILED");
 phase="durable-child-identity";await verifyDurableChildIdentity();
 phase="group-placement-database-boundary";await verifyGroupPlacementDatabaseBoundary();
 phase="boundary-readback";
 const after=await counts();
 if(JSON.stringify(after.otherWorkspaceState)!==JSON.stringify(baseline.otherWorkspaceState))throw new Error("GROUP_INTEREST_WORKSPACE_SIDE_EFFECT");
 if(after.inquiries!==baseline.inquiries+3||after.operations!==baseline.operations+3||after.serviceInterests!==baseline.serviceInterests+4||after.serviceOperations!==baseline.serviceOperations+5||after.draftGroups!==baseline.draftGroups+2||after.draftOperations!==baseline.draftOperations+2||after.proposedPlacements!==baseline.proposedPlacements+2||after.placementOperations!==baseline.placementOperations+4)throw new Error("GROUP_INTEREST_RECEIPT_COUNT_MISMATCH");
 console.log(`GROUP_INTEREST_ACCEPTANCE_PASS project=${project??"all"} inquiries=3 serviceInterests=4 draftGroups=2 proposedPlacements=2 placementOperations=4 sideEffects=0`);
}catch(error){console.error(`Group Intake browser verification failed at ${phase} (${error instanceof Error?error.message:"unknown error"}). No production or provider state was used.`);process.exitCode=1;}
finally{await cleanup();}
