/** Disposable synthetic fixture only. No real catalog/account/grant importer. */
import {randomBytes,randomUUID,createHash} from "node:crypto";
import type {Fixture} from "../../database/calendar/fixture.ts";
import {hashPassword,blindEmail,seal} from "../../../src/features/identity/crypto.ts";
import {learnerLessonSchema,type LessonReference} from "../../../src/features/resources/fishing-lesson-journey.ts";
import {educationCatalogAad} from "../../../src/features/resources/fishing-lesson-native-store.ts";
import {educationArtifactAad,type EducationStorageBinding} from "../../../src/features/resources/fishing-lesson-storage-contract.ts";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
/** App and test processes share one admitted target, not one execution mode.
 * Keep the original strict fixture input (including an absent CI raw URL). */
export function educationBrowserTestEnvironment(app:Record<string,string|undefined>,fixture:Record<string,string|undefined>):NodeJS.ProcessEnv{
 const environment:NodeJS.ProcessEnv={...app,NODE_ENV:"test"};
 for(const key of["LS_APP_MODE","TEST_DATABASE_URL"]as const){
  if(fixture[key]===undefined)delete environment[key];else environment[key]=fixture[key];
 }
 return environment;
}
const protectedTables=["ls_calendar.tasks","ls_calendar.task_history","ls_calendar.appointments","ls_cases.cases","ls_cases.case_guardians",
 "ls_contact_ops.profiles","ls_contact_ops.outbound_projections","ls_onboarding.first_session_orders","ls_identity.auth_mail_outbox"];
export async function educationProtectedSnapshot(f:Fixture){return Promise.all(protectedTables.map(async table=>{
 const rows=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows;
 return {table,count:rows.length,digest:hash(JSON.stringify(rows))};
}));}
export async function educationBrowserFixture(f:Fixture,lookupKey:Buffer){
 const learnerId=(await f.pool.query("SELECT c.person_id AS id FROM ls_cases.cases x JOIN ls_cases.clients c ON c.workspace_id=x.workspace_id AND c.id=x.client_id WHERE x.workspace_id=$1 AND x.id=$2",[f.workspaceId,f.first.id])).rows[0].id as string;
 const credentials:{role:string;accountId:string;email:string;password:string}[]=[];
 for(const [role,account]of[["practitioner",f.practitioner],["parent",f.parent],["other_parent",f.parentTwo],["unauthorized_parent",f.outsider]]as const){
  const email=`synthetic-education-${role}@example.invalid`,password=randomBytes(18).toString("base64url");
  await f.pool.query("UPDATE ls_identity.accounts SET password_hash=$3,email_blind=$4,email_ciphertext=$5 WHERE workspace_id=$1 AND id=$2",
   [f.workspaceId,account.actor.id,await hashPassword(password),blindEmail(email,lookupKey),seal(email,`email:${f.workspaceId}:${account.actor.id}`,f.keyring)]);
  credentials.push({role,accountId:account.actor.id,email,password});
 }
 for(const role of["adult_client","child"]as const){
  const id=randomUUID(),personId=role==="child"?learnerId:randomUUID(),email=`synthetic-education-${role}@example.invalid`,password=randomBytes(18).toString("base64url");
  if(role!=="child")await f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,clock_timestamp())",
   [personId,f.workspaceId,seal(JSON.stringify({displayName:"Synthetic adult only"}),`person:${f.workspaceId}:${personId}`,f.keyring)]);
  await f.pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,clock_timestamp(),$6,clock_timestamp(),clock_timestamp())",
   [id,f.workspaceId,role,blindEmail(email,lookupKey),seal(email,`email:${f.workspaceId}:${id}`,f.keyring),await hashPassword(password)]);
  await f.pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[f.workspaceId,id,personId]);
  credentials.push({role,accountId:id,email,password});
 }
 const references:Record<string,LessonReference>={};
 for(const [name,moduleId]of[["en","RM-101"],["he","RM-102"],["control","RM-103"],["draft-en","RM-104"],["draft-he","RM-105"]]as const){
  const ref={learnerId,moduleId,version:`synthetic-${name}-v1`},session=Number(moduleId.slice(4));references[name]=ref;
  const sourceSha=hash(`Synthetic source ${name}`),lesson=learnerLessonSchema.parse({moduleId,version:ref.version,stage:1,locale:"en",title:`Synthetic lesson ${name}`,
   instruction:"Synthetic hookless instruction only. No activity clearance or real curriculum approval.",questions:Array.from({length:name.startsWith("draft-")?3:1},(_,index)=>({id:`Q${String(session).padStart(2,"0")}-${index+1}`,prompt:index===0?"Describe your synthetic hookless practice.":`Synthetic draft question ${index+1}`})),sourceSha256:sourceSha,status:"approved"});
  const learnerBytes=JSON.stringify(lesson),teacherBytes="SYNTHETIC TEACHER KEY NOT FOR FAMILY",learnerArtifact=randomUUID(),teacherArtifact=randomUUID();
  const binding:EducationStorageBinding={workspaceId:f.workspaceId,moduleId,version:ref.version,state:"approved",source:{sourceId:"synthetic-browser-source",revision:"synthetic-only",sha256:sourceSha},
   learner:{sourceId:`synthetic-learner-${learnerArtifact}`,version:"1",locale:"en",sha256:hash(learnerBytes),storageClass:"resource_learner",state:"approved"},
   teacher:{sourceId:`synthetic-teacher-${teacherArtifact}`,version:"1",locale:"en",sha256:hash(teacherBytes),storageClass:"protected_teacher",state:"approved"}};
  for(const[id,reference,bytes]of[[learnerArtifact,binding.learner,learnerBytes],[teacherArtifact,binding.teacher,teacherBytes]]as const)
   await f.pool.query("INSERT INTO ls_education.artifact_versions(workspace_id,id,source_id,version,locale,storage_class,sha256,reference,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)",
    [f.workspaceId,id,reference.sourceId,reference.version,reference.locale,reference.storageClass,reference.sha256,JSON.stringify(reference),seal(bytes,educationArtifactAad(f.workspaceId,reference),f.keyring)]);
  await f.pool.query("INSERT INTO ls_education.catalog_versions(workspace_id,module_id,version,source_id,source_revision,source_sha256,learner_artifact_id,teacher_artifact_id,payload_ciphertext,approval_state,approval_provenance,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved','synthetic-browser-only',$10,clock_timestamp())",
   [f.workspaceId,moduleId,ref.version,binding.source.sourceId,binding.source.revision,sourceSha,learnerArtifact,teacherArtifact,seal(JSON.stringify(binding),educationCatalogAad(f.workspaceId,moduleId,ref.version),f.keyring),f.practitioner.actor.id]);
  await f.pool.query("INSERT INTO ls_education.educational_assignments(workspace_id,learner_id,module_id,version,active,assigned_by) VALUES($1,$2,$3,$4,true,$5)",[f.workspaceId,learnerId,moduleId,ref.version,f.practitioner.actor.id]);
  const parents=name==="control"?[f.parent,f.parentTwo]:[f.parent];
  for(const parent of parents){
   await f.pool.query("INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,clock_timestamp(),'synthetic-independent-guardian',$4) ON CONFLICT(workspace_id,learner_id,account_id) DO NOTHING",
    [f.workspaceId,learnerId,parent.actor.id,f.practitioner.actor.id]);
   await f.pool.query("INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,$4,$5,true,ARRAY['submit','read_learner','read_parent'],$6)",
    [f.workspaceId,parent.actor.id,learnerId,moduleId,ref.version,f.practitioner.actor.id]);
  }
  await f.pool.query("INSERT INTO ls_education.account_grants(workspace_id,account_id,learner_id,module_id,version,active,permissions,granted_by) VALUES($1,$2,$3,$4,$5,true,ARRAY['observe','publish_parent_summary','read_teacher'],$6)",
   [f.workspaceId,f.practitioner.actor.id,learnerId,moduleId,ref.version,f.practitioner.actor.id]);
 }
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1",[f.workspaceId]);
 return {credentials,references,workspaceId:f.workspaceId};
}
