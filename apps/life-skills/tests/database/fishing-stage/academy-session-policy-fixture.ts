/** SOURCE ONLY until Root admits the exact disposable recipe. No schema setup,
 * migration, grant, provider, app mount or browser launch is performed here.
 * Authority below is explicitly SYNTHETIC SQL evidence, not Root's production
 * inquiry/payment/delivery resolver. Legacy reservations are reference fixtures;
 * this fixture does not insert, release or rebook a seat. */
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import pg from "pg";
import {nativeCiTarget,admitNativeCi} from '../native-ci-admission.ts';
import {z} from "zod";
import {one,type IdentityStore,type SqlSession} from "../../../src/features/identity/store.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import {AppError} from "../../../src/lib/errors.ts";
import {academyPolicyPreflightVersion,type AcademyOriginalSessionAnchor,type AcademyRecordedDriveLimit} from "../../../src/features/fishing/academy-policy-preflight-contract.ts";
import {academyCalendarCompatibilityVersion,type AcademySessionCreditNativeFacts,type AcademySessionCreditNativeFactsV2,type AcademySessionCreditCommand,type AcademySessionCreditCommandResult,type AcademySessionPolicyNativeAuthority,type AcademySessionCreditNativeContext} from "../../../src/features/fishing/academy-session-policy-native-contract.ts";
import {AcademySessionPolicyNativeService} from "../../../src/features/fishing-stage/academy-session-policy-native.ts";
import {academyCreditDigest,sameAcademyAnchor,sameAcademyCredit,academyCreditFactsSchema,academyCreditFactsV2Schema} from "../../../src/features/fishing-stage/academy-session-credit-store.ts";
import {parseEnrollment,parseTemplate} from "../../../src/features/fishing-stage/native-storage.ts";
import {floridaParentApplicationFieldsSchema,floridaGroupApplicationNotice,type FloridaParentApplicationFields} from "../../../src/features/group-application/contract.ts";
import {ACADEMY_INTAKE_VERSION,academyDriveMinutes} from "../../../src/features/group-application/academy-intake.ts";
import {nativeFixture,poolStore} from "./fixture.ts";
import {requireNativeTarget} from "./database-target.ts";

const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
export function academySessionPolicyFixturePins(){
 const contract=hash(readFileSync(new URL("../../../src/features/fishing/academy-session-policy-native-contract.ts",import.meta.url)));
 const schema=hash(readFileSync(new URL("../../../src/features/fishing-stage/academy-session-credit-schema.sql",import.meta.url)));
 const inputs=["./academy-session-policy-fixture.ts","./academy-session-policy.native.test.ts","./fixture.ts","./fixture.sql",
  "../../../src/features/fishing-stage/candidate.sql","../../../src/features/fishing-stage/academy-session-policy-native.ts",
  "../../../src/features/fishing-stage/academy-session-credit-store.ts","../../../src/features/fishing-stage/academy-session-credit-summary.tsx",
  "../../../src/features/fishing-stage/academy-session-policy-preflight.ts","../../e2e/calendar/academy-session-policy.journey.ts"];
 return {contract,schema,code:hash(JSON.stringify(inputs.map(path=>[path,hash(readFileSync(new URL(path,import.meta.url)))])))};
}
function admitted(){
 if(nativeCiTarget(['stageCredit']))return; // Complete raw CI inventory checked independently of private CAL1136 receipts.
 if(process.env.LS_ACADEMY_SESSION_NATIVE_ALLOW!=="ROOT_REVIEWED_CAL1136_ONLY")throw Error("CAL1136_NATIVE_EXECUTION_NOT_ADMITTED");
 const pins=academySessionPolicyFixturePins();
 if(pins.contract!=="645c4ce700a576a80c9fa2163167ef3293bca70db8f3d83ef5b0a6d9952e8b23"||
  pins.schema!=="1a2ba8cc2c7a39343c37283348aaa6d0d66c0ded8ce1bf8ec39d9f0a824871ad"||
  process.env.LS_ACADEMY_SESSION_CODE_SHA256!==pins.code||process.env.LS_ACADEMY_SESSION_SCHEMA_SHA256!==pins.schema)
  throw Error("CAL1136_EXACT_SOURCE_PINS_REQUIRED");
 // The existing nativeFixture additionally requires the exact local 63-byte
 // database name, process-only credentials and Root's original schema pins.
}
// This fixture exercises enumerated drive preferences; exact numeric limits have their own native suite.
type FixtureFacts=AcademySessionCreditNativeFacts|(AcademySessionCreditNativeFacts&Pick<AcademySessionCreditNativeFactsV2,'compatibility'>);
const fixtureV2Schema=academyCreditFactsV2Schema.extend({travel:academyCreditFactsSchema.shape.travel});
const parseFacts=(value:unknown):FixtureFacts=>value&&typeof value==='object'&&'compatibility' in value?fixtureV2Schema.parse(value):academyCreditFactsSchema.parse(value);
type Proof={kind:"SYNTHETIC_CAL1136_SQL_AUTHORITY";canonical:AcademyOriginalSessionAnchor;facts:FixtureFacts;
 inquiry:FloridaParentApplicationFields;inquiryVerified:boolean;purchaseVerified:boolean;deliveryVerified:boolean;sourceVerified:boolean;
 legacy:AcademySessionCreditNativeFacts["legacyCredit"]};
const proofKey=(enrollment:string,occurrence:string)=>`cal1136:${enrollment}:${occurrence}`;
function proofDigest(facts:FixtureFacts){
 const parsed=parseFacts(facts); // Stable order after JSONB reload.
 return academyCreditDigest({anchor:parsed.anchor,duration:parsed.duration,change:parsed.travel.change,revision:parsed.evidenceRevision,...('compatibility' in parsed?{compatibility:parsed.compatibility}:{})});
}

/** Explicit test-only SQL resolver; also used by the admitted restart child. */
export function createAcademySyntheticAuthority():AcademySessionPolicyNativeAuthority{
  async function resolveSelected(tx:SqlSession,c:AcademySessionCreditNativeContext){
   const row=await one<{payload:unknown}>(tx,"SELECT payload FROM ls_fishing_stage.fixture_enrollments WHERE workspace_id=$1 AND id=$2 AND active FOR SHARE",[c.actor.workspaceId,c.selection.selectedEnrollmentId]);
   if(!row)return null;const e=parseEnrollment(row.payload);
   if(e.workspaceId!==c.actor.workspaceId||e.state!=="confirmed")return null;
   if(c.actor.role==="parent"){
    if(!await one(tx,"SELECT account_id FROM ls_fishing_stage.fixture_guardians WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3 AND active FOR SHARE",[c.actor.workspaceId,e.learnerId,c.actor.id]))return null;
   }else if(c.actor.role!=="practitioner"||!await one(tx,"SELECT instructor_id FROM ls_fishing_stage.fixture_contexts WHERE workspace_id=$1 AND stage_id=$2 AND instructor_id=$3 FOR SHARE",[c.actor.workspaceId,e.stageId,c.actor.id]))return null;
   return e;
  }
  return {
   resolveSelectedEnrollment:async(tx,c)=>{const e=await resolveSelected(tx,c);return e?{workspaceId:e.workspaceId,enrollmentId:e.id,learnerId:e.learnerId}:null;},
   resolveCreditFacts:async(tx,c,command)=>{
    const e=await resolveSelected(tx,c);if(!e||e.id!==command.enrollmentId)return null;
    const row=await one<{payload:Proof}>(tx,"SELECT payload FROM ls_fishing_stage.fixture_templates WHERE workspace_id=$1 AND stage=1 AND version=$2 AND active FOR SHARE",
     [c.actor.workspaceId,proofKey(e.id,command.originalOccurrenceId)]);
    const proof=row?.payload;if(!proof||proof.kind!=="SYNTHETIC_CAL1136_SQL_AUTHORITY"||!proof.inquiryVerified||!proof.purchaseVerified||!proof.deliveryVerified||!proof.sourceVerified)return null;
    const f=parseFacts(proof.facts),complete=floridaParentApplicationFieldsSchema.safeParse(proof.inquiry);
    if(f.evidenceDigest!==proofDigest(f)||!complete.success||!complete.data.academyIntake||complete.data.academyIntake.version!==ACADEMY_INTAKE_VERSION||
     f.inquiry.fieldsDigest!==academyCreditDigest(complete.data)||!complete.data.academyIntake.learners[f.inquiry.learnerIndex]||
     f.inquiry.drivePreferenceDigest!==academyCreditDigest({driveLimit:complete.data.academyIntake.driveLimit})||f.travel.change.recordedDriveLimit!==complete.data.academyIntake.driveLimit||
     !sameAcademyAnchor(proof.canonical,f.anchor)||f.enrollmentId!==e.id||f.anchor.learnerId!==e.learnerId||f.purchaseId!==e.purchaseId||f.purchaseLineId!==e.purchaseLineId||
     f.householdId!==e.householdId||f.guardianBindingId!==e.evidence.verifiedGuardianBindingId||f.acceptedTermsVersion!==e.evidence.acceptedTermsVersion)return null;
    if(Boolean(proof.legacy)!==Boolean(f.legacyCredit)||proof.legacy&&f.legacyCredit&&!sameAcademyCredit(proof.legacy,f.legacyCredit))return null;
    const header=await one<{cohortId:string;stageId:string;ordinal:number;originalStage:number;revision:number;templateVersion:string}>(tx,`SELECT o.cohort_id AS "cohortId",o.stage_id AS "stageId",o.ordinal,p.stage AS "originalStage",p.revision,p.template_version AS "templateVersion"
     FROM ls_fishing_stage.occurrences o JOIN ls_fishing_stage.plans p ON p.workspace_id=o.workspace_id AND p.stage_id=o.stage_id WHERE o.workspace_id=$1 AND o.id=$2 FOR SHARE OF o,p`,[c.actor.workspaceId,command.originalOccurrenceId]);
    if(!header||header.cohortId!==f.anchor.cohortId||header.stageId!==f.anchor.stageId||header.ordinal!==f.anchor.ordinal||header.revision!==f.stageRevision)return null;
    const templateRow=await one<{payload:unknown}>(tx,"SELECT payload FROM ls_fishing_stage.fixture_templates WHERE workspace_id=$1 AND stage=1 AND version=$2 AND active FOR SHARE",[c.actor.workspaceId,header.templateVersion]);
    if(!templateRow)return null;const template=parseTemplate(templateRow.payload),lesson=template.modules[header.ordinal-1];
    if(template.stage!==header.originalStage||template.stage!==e.stage||('compatibility' in f&&f.compatibility.originalStage!==header.originalStage))return null;
    if(!lesson||lesson.moduleId!==f.anchor.moduleId||lesson.moduleVersion!==f.anchor.moduleVersion)return null;return f;
   },
  };
}

export async function academySessionPolicyFixture(options:{driveLimit?:AcademyRecordedDriveLimit;legacy?:"outstanding"|"replacement_reserved"}={}){
 admitted();const base=await nativeFixture();
 try{
  const present=(await base.pool.query(`SELECT to_regclass('ls_fishing_stage.academy_session_policy_evidence')::text AS evidence,
   to_regclass('ls_fishing_stage.academy_session_credits')::text AS credits,to_regclass('ls_fishing_stage.academy_session_credit_events')::text AS events`)).rows[0];
  if(!present?.evidence||!present.credits||!present.events)throw Error("CAL1136_ROOT_SCHEMA_SETUP_REQUIRED");
  await base.createPlan();const draft=(await base.service().read(base.instructor,base.ref))!,first=draft.occurrences[2]!;
  const start=new Date(Date.now()+48*3600000),end=new Date(start.valueOf()+180*60000);
  await base.service().execute(base.instructor,base.ref,{action:"revise",operationId:randomUUID(),expectedRevision:draft.revision,occurrenceId:first.id,expectedOccurrenceRevision:first.revision,
   reason:"Synthetic ordinary 180-minute policy fixture",details:{time:{kind:"scheduled",timeZone:"America/New_York",startsAt:start.toISOString(),endsAt:end.toISOString()},
    location:"Synthetic location",directions:"Synthetic directions",equipment:"Synthetic equipment",logisticalNote:"Synthetic notice",childCapacity:4}});
  const revised=(await base.service().read(base.instructor,base.ref))!;
  await base.service().execute(base.instructor,base.ref,{action:"publish",operationId:randomUUID(),expectedRevision:revised.revision});
  const plan=(await base.service().read(base.instructor,base.ref))!,original=plan.occurrences[2]!;
  const driveLimit=options.driveLimit??"up_to_30",minutes=academyDriveMinutes(driveLimit);
  const inquiry=floridaParentApplicationFieldsSchema.parse({parentName:"SYNTHETIC_CAL1136_PRIVATE_PARENT",contact:"cal1136@example.invalid",language:"en",childAge:"10",cityArea:"Synthetic city",
   programId:"sunday_fishing_academy",schedulePreference:["sunday"],scheduleContext:"program_format_interest",
   academyFit:{version:"RM-FIT-20261014-04-v1",learners:[{approximateAge:10,gear:"needs_advice",experience:"new"}],...(minutes===undefined?{}:{maximumDriveMinutes:minutes}),parentDropoff:"yes"},
   academyIntake:{version:ACADEMY_INTAKE_VERSION,postalCode:"33101",driveLimit,preferredGroupLanguage:"en",stagePreference:"foundation",keysTravel:"discuss",offshoreInterest:"discuss",nextStep:"enrollment_followup",
    learners:[{gradeBand:"grade_3_5",schooling:"school",tackleBox:"need_advice"}]},
   permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}});
  async function seed(enrollment=base.enrolled){
   const anchor:AcademyOriginalSessionAnchor={workspaceId:base.workspaceId,learnerId:enrollment.learnerId,cohortId:base.ref.cohortId,stageId:base.ref.stageId,
    occurrenceId:original.id,ordinal:original.ordinal,moduleId:original.moduleId,moduleVersion:original.moduleVersion,activityId:"synthetic-original-learning-activity"};
   const sourceEvidenceId=randomUUID();
   const facts:AcademySessionCreditNativeFacts={anchor,enrollmentId:enrollment.id,purchaseId:enrollment.purchaseId,purchaseLineId:enrollment.purchaseLineId,
    householdId:enrollment.householdId,guardianBindingId:enrollment.evidence.verifiedGuardianBindingId,acceptedTermsVersion:enrollment.evidence.acceptedTermsVersion,
    inquiry:{workspaceId:base.workspaceId,applicationId:randomUUID(),fieldsDigest:academyCreditDigest(inquiry),learnerIndex:0,drivePreferenceDigest:academyCreditDigest({driveLimit})},
    stageRevision:plan.revision,sourceEvidenceId,evidenceRevision:1,evidenceDigest:"a".repeat(64),
    duration:{version:academyPolicyPreflightVersion,sessionKind:"ordinary",time:original.time},
    travel:{version:academyPolicyPreflightVersion,original:anchor,sessionKind:"ordinary",obligation:{anchor,evidenceId:randomUUID(),state:"purchased_undelivered"},
     change:{anchor,kind:"academy_venue",evidenceId:sourceEvidenceId,weatherQualification:"unknown",recordedDriveLimit:driveLimit,revisedOneWayMinutes:45,familyCannotAttend:true}},
    legacyCredit:options.legacy?{id:randomUUID(),anchor,enrollmentId:enrollment.id,purchaseId:enrollment.purchaseId,purchaseLineId:enrollment.purchaseLineId,
     state:options.legacy,replacementReservationId:options.legacy==="replacement_reserved"?randomUUID():null}:null};
   // The current grant branch derives stage from the saved original, never from a module label.
   const stage=(await base.pool.query('SELECT stage FROM ls_fishing_stage.plans WHERE workspace_id=$1 AND stage_id=$2 AND cohort_id=$3',[base.workspaceId,anchor.stageId,anchor.cohortId])).rows[0]?.stage;
   if(![1,2,3,4].includes(stage)||stage!==base.template.stage)throw Error('SYNTHETIC_ORIGINAL_STAGE_BINDING');
   const current:FixtureFacts=options.legacy?facts:{...facts,compatibility:{version:academyCalendarCompatibilityVersion,originalStage:stage as 1|2|3|4}};
   const value={...current,evidenceDigest:proofDigest(current)};
   const proof:Proof={kind:"SYNTHETIC_CAL1136_SQL_AUTHORITY",canonical:anchor,facts:value,inquiry,inquiryVerified:true,purchaseVerified:true,deliveryVerified:true,sourceVerified:true,legacy:value.legacyCredit};
   // Existing isolated fixture JSON storage; no new table or production row.
   await base.pool.query("INSERT INTO ls_fishing_stage.fixture_templates(workspace_id,stage,version,payload,active) VALUES($1,1,$2,$3::jsonb,true)",
    [base.workspaceId,proofKey(enrollment.id,original.id),JSON.stringify(proof)]);return value;
  }
  const initial=await seed(),siblingInitial=await seed(base.siblingEnrollment);
  const authority=createAcademySyntheticAuthority();
  const clock={now:()=>new Date()};
  function service(actor:Actor=base.parent,selection=base.enrolled.id,database:IdentityStore=base.db,override:AcademySessionPolicyNativeAuthority=authority){
   return new AcademySessionPolicyNativeService({database,keyring:base.keyring,principal:actor,selection:{selectedEnrollmentId:selection},authority:override,clock});
  }
  async function getProof(enrollment=base.enrolled.id):Promise<Proof>{
   return (await base.pool.query("SELECT payload FROM ls_fishing_stage.fixture_templates WHERE workspace_id=$1 AND stage=1 AND version=$2",[base.workspaceId,proofKey(enrollment,original.id)])).rows[0].payload;
  }
  async function change(update:(facts:AcademySessionCreditNativeFacts)=>AcademySessionCreditNativeFacts,enrollment=base.enrolled.id){
   const proof=await getProof(enrollment),facts=parseFacts(update(structuredClone(proof.facts))),next={...facts,evidenceDigest:proofDigest(facts)};
   await base.pool.query("UPDATE ls_fishing_stage.fixture_templates SET payload=$3::jsonb WHERE workspace_id=$1 AND stage=1 AND version=$2",[base.workspaceId,proofKey(enrollment,original.id),JSON.stringify({...proof,facts:next})]);return next;
  }
  async function invalidate(key:"inquiryVerified"|"purchaseVerified"|"deliveryVerified"|"sourceVerified"){
   const proof=await getProof();await base.pool.query("UPDATE ls_fishing_stage.fixture_templates SET payload=$3::jsonb WHERE workspace_id=$1 AND stage=1 AND version=$2",[base.workspaceId,proofKey(base.enrolled.id,original.id),JSON.stringify({...proof,[key]:false})]);
  }
  function command(facts:AcademySessionCreditNativeFacts=initial,operationId:string=randomUUID()):AcademySessionCreditCommand{
   return {operationId,enrollmentId:facts.enrollmentId,originalOccurrenceId:facts.anchor.occurrenceId,expectedStageRevision:facts.stageRevision,sourceEvidenceId:facts.sourceEvidenceId,expectedEvidenceRevision:facts.evidenceRevision};
  }
  async function counts(){return (await base.pool.query(`SELECT
   (SELECT count(*)::integer FROM ls_fishing_stage.academy_session_policy_evidence WHERE workspace_id=$1) AS evidence,
   (SELECT count(*)::integer FROM ls_fishing_stage.academy_session_credits WHERE workspace_id=$1) AS credits,
   (SELECT count(*)::integer FROM ls_fishing_stage.academy_session_credit_events WHERE workspace_id=$1) AS events`,[base.workspaceId])).rows[0] as {evidence:number;credits:number;events:number};}
  async function protectedDigest(){
   const values=[];
   for(const table of ["plans","occurrences","revisions","operations","makeup_links","fixture_seat_effects","fixture_resource_effects","fixture_enrollments"] as const){
    const rows=await base.pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ls_fishing_stage.${table} t WHERE workspace_id=$1`,[base.workspaceId]);values.push([table,rows.rows[0].rows]);
   }return academyCreditDigest(values);
  }
  async function revokeGuardian(tx?:SqlSession){
   if(tx)await tx.query("UPDATE ls_fishing_stage.fixture_guardians SET active=false WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3",[base.workspaceId,base.enrolled.learnerId,base.parent.id]);
   else await base.pool.query("UPDATE ls_fishing_stage.fixture_guardians SET active=false WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3",[base.workspaceId,base.enrolled.learnerId,base.parent.id]);
  }
  return {...base,stageService:base.service,service,authority,clock,initial,siblingInitial,command,change,invalidate,counts,protectedDigest,revokeGuardian,
   restart:(command:AcademySessionCreditCommand)=>restartProcess({principal:base.parent,selection:base.enrolled.id,key:base.keyring.keys.synthetic!.toString("base64url"),command}),
   failAfterEvent:():IdentityStore=>({transaction:work=>base.db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
    const rows=await tx.query<T>(sql,values);if(sql.includes("INSERT INTO ls_fishing_stage.academy_session_credit_events"))throw new AppError("UNAVAILABLE");return rows;
   }}))})};
 }catch(error){await base.close();throw error;}
}
export type AcademySessionPolicyFixture=Awaited<ReturnType<typeof academySessionPolicyFixture>>;

type RestartInput={principal:Actor;selection:string;key:string;command:AcademySessionCreditCommand};
function restartProcess(input:RestartInput):Promise<{pid:number;result:AcademySessionCreditCommandResult}>{
 admitted();return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,["--conditions=react-server","--import","tsx",fileURLToPath(import.meta.url),"--cal1136-restart-child"],{
   cwd:fileURLToPath(new URL("../../../",import.meta.url)),env:{...process.env,TSX_DISABLE_CACHE:"1"},windowsHide:true,stdio:["pipe","pipe","pipe"]});
  let stdout="",stderrBytes=0,settled=false;
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){child.kill();reject(error);return;}
   try{const value=JSON.parse(stdout) as {pid:number;result:AcademySessionCreditCommandResult};if(!Number.isSafeInteger(value.pid)||value.pid===process.pid)throw Error();resolve(value);}
   catch{reject(Error("CAL1136_RESTART_OUTPUT_INVALID"));}};
  const timer=setTimeout(()=>finish(Error("CAL1136_RESTART_TIMEOUT")),30000);
  child.stdout.on("data",chunk=>{stdout+=String(chunk);if(Buffer.byteLength(stdout)>65536)finish(Error("CAL1136_RESTART_OUTPUT_LIMIT"));});
  child.stderr.on("data",chunk=>{stderrBytes+=Buffer.byteLength(chunk);if(stderrBytes>65536)finish(Error("CAL1136_RESTART_ERROR_LIMIT"));});
  child.on("error",()=>finish(Error("CAL1136_RESTART_START_FAILED")));child.on("close",code=>finish(code===0?undefined:Error("CAL1136_RESTART_CHILD_FAILED")));
  child.stdin.on("error",()=>finish(Error("CAL1136_RESTART_INPUT_FAILED")));child.stdin.end(JSON.stringify(input));
 });
}
async function restartChild(){
 const ci=await admitNativeCi(['stageCredit']);
 admitted();let raw="";for await(const chunk of process.stdin){raw+=String(chunk);if(Buffer.byteLength(raw)>16384)throw Error("CAL1136_RESTART_INPUT_LIMIT");}
 const input=JSON.parse(raw) as RestartInput;
 if(!z.uuid().safeParse(input.selection).success||!z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(input.key).success)throw Error("CAL1136_RESTART_INPUT_INVALID");
 const url=requireNativeTarget(process.env,{schemaSha256:hash(readFileSync(new URL("../../../src/features/fishing-stage/candidate.sql",import.meta.url))),fixtureSha256:hash(readFileSync(new URL("./fixture.sql",import.meta.url)))});
 const pool=new pg.Pool({connectionString:url,max:2});
 try{
  const guard=(await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,current_setting('password_encryption') AS mode")).rows[0];
  if(guard?.database!==(ci?.database??process.env.LS_RM_STAGE_TEST_DATABASE)||guard.address!==(ci?.serverAddress??"127.0.0.1")||guard.mode!=="scram-sha-256")throw Error("CAL1136_RESTART_TARGET_MISMATCH");
  const service=new AcademySessionPolicyNativeService({database:poolStore(pool),principal:input.principal,selection:{selectedEnrollmentId:input.selection},
   keyring:{activeKeyId:"synthetic",keys:{synthetic:Buffer.from(input.key,"base64url")}},authority:createAcademySyntheticAuthority(),clock:{now:()=>new Date()}});
  const result=await service.execute(input.command);process.stdout.write(JSON.stringify({pid:process.pid,result})+"\n");
 }finally{await pool.end();}
}
// Importing this authored fixture never opens a connection or starts a child.
if(process.argv[2]==="--cal1136-restart-child")void restartChild().catch(()=>{process.stderr.write("CAL1136_RESTART_FAILED\n");process.exitCode=1;});
