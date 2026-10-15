/** Authored for MAIN's later registered PostgreSQL run. No schema lifecycle.
 * Hooks below are SYNTHETIC SQL proofs, not the actual shared business owners. */
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";
import {drizzle} from "drizzle-orm/node-postgres";
import {bindStatement} from "../../../src/features/identity/sql-binding.ts";
import {normalizeDatabaseRows,type DatabaseField} from "../../../src/features/integration/normalize-database-result.ts";
import {seal,tokenDigest} from "../../../src/features/identity/crypto.ts";
import {one,type IdentityStore,type SqlSession} from "../../../src/features/identity/store.ts";
import {asId} from "../../../src/lib/ids.ts";
import {AppError} from "../../../src/lib/errors.ts";
import type {Actor,ApprovedStageTemplate,EnrollmentProjection,FishingStageRef} from "../../../src/features/fishing-stage/contract.ts";
import type {FishingStageNativeHooks,NativeStageHookContext} from "../../../src/features/fishing/native-stage-ports.ts";
import {NativeFishingStageStore} from "../../../src/features/fishing-stage/native-store.ts";
import {parseEnrollment,parseTemplate} from "../../../src/features/fishing-stage/native-storage.ts";
import {FishingStageService} from "../../../src/features/fishing-stage/service.ts";
import {requireNativeTarget} from "./database-target.ts";

const sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
export function poolStore(pool:pg.Pool):IdentityStore{
 const database=drizzle(pool);
 return {transaction:work=>database.transaction(tx=>work({query:async<R extends object>(statement:string,values:readonly unknown[]=[])=>{
  const result=await tx.execute(bindStatement(statement,values)) as unknown as {rows:Record<string,unknown>[];fields:DatabaseField[]};
  return normalizeDatabaseRows(result.rows,result.fields) as R[];
 }}))};
}
export async function nativeFixture(){
 const schemaSha256=sha(readFileSync(new URL("../../../src/features/fishing-stage/candidate.sql",import.meta.url)));
 const fixtureSha256=sha(readFileSync(new URL("./fixture.sql",import.meta.url)));
 const url=requireNativeTarget(process.env,{schemaSha256,fixtureSha256});
 const pool=new pg.Pool({connectionString:url,max:8});
 try{
  const guard=(await pool.query(`SELECT current_database() AS database,host(inet_server_addr()) AS address,current_setting('password_encryption') AS mode,
   to_regclass('ls_fishing_stage.plans')::text AS plans,to_regclass('ls_fishing_stage.fixture_contexts')::text AS fixture`)).rows[0];
  if(!guard||guard.database!==process.env.LS_RM_STAGE_TEST_DATABASE||guard.address!=="127.0.0.1"||guard.mode!=="scram-sha-256"||!guard.plans||!guard.fixture)throw Error("RM_STAGE_NATIVE_TARGET_OR_SCHEMA_MISMATCH");
  const workspaceId=asId(randomUUID(),"workspace"),keyring={activeKeyId:"synthetic",keys:{synthetic:randomBytes(32)}},db=poolStore(pool);
  const now=Date.now(),ago=new Date(now-86400000),expiresAt=now+8*3600000;
  await pool.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,ago]);
  async function account(role:Actor["role"]):Promise<Actor>{
   const id=asId(randomUUID(),"account"),personId=asId(randomUUID(),"person"),sessionDigest=tokenDigest(randomBytes(32).toString("base64url"));
   await db.transaction(async tx=>{
    await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,$3,$4,$5)",[personId,workspaceId,role==="child"?"minor":"adult",seal("Synthetic person",`person:${workspaceId}:${personId}`,keyring),ago]);
    await tx.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
     VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-non-login-hash',$6,$6)`,[id,workspaceId,role,sha(id),seal(`synthetic-${id}@example.invalid`,`email:${workspaceId}:${id}`,keyring),ago]);
    await tx.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[workspaceId,id,personId]);
    await tx.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[sessionDigest,workspaceId,id,ago,new Date(expiresAt)]);
   });
   return {id,workspaceId,personId,role,state:"active",locale:"en",sessionDigest,expiresAt};
  }
  const instructor=await account("practitioner"),parent=await account("parent"),otherParent=await account("parent"),child=await account("child"),sibling=await account("child");
  const ref:FishingStageRef={cohortId:randomUUID(),stageId:randomUUID(),stage:1};
  const template:ApprovedStageTemplate={stage:1,version:"native-synthetic-v1",status:"approved",policyVersion:"synthetic-policy",sourceVersion:"synthetic-source",sourceSha256:"a".repeat(64),modules:Array.from({length:12},(_,i)=>({moduleId:`RM-1${String(i+1).padStart(2,"0")}`,moduleVersion:"synthetic-v1",learnerContent:"approved"}))};
  await pool.query("INSERT INTO ls_fishing_stage.fixture_templates(workspace_id,stage,version,payload,active) VALUES($1,1,$2,$3::jsonb,true)",[workspaceId,template.version,JSON.stringify(template)]);
  async function cohort(r:FishingStageRef=ref){await pool.query("INSERT INTO ls_fishing_stage.fixture_contexts(workspace_id,stage_id,cohort_id,stage,instructor_id,child_capacity,resource_approved) VALUES($1,$2,$3,$4,$5,4,true)",[workspaceId,r.stageId,r.cohortId,r.stage,instructor.id]);}
  await cohort();
  async function enrollment(learner:Actor=child,r:FishingStageRef=ref):Promise<EnrollmentProjection>{
   const e:EnrollmentProjection={...r,id:randomUUID(),revision:1,workspaceId,program:"sunday_fishing_academy",purchaseId:randomUUID(),purchaseLineId:randomUUID(),learnerId:learner.personId,householdId:randomUUID(),state:"confirmed",
    evidence:{verifiedGuardianBindingId:randomUUID(),capacityReservationId:randomUUID(),fitDecisionId:randomUUID(),acceptedTermsVersion:"synthetic-terms",ownerActionId:randomUUID()},authorizedAccountIds:[parent.id,learner.id]};
   await pool.query("INSERT INTO ls_fishing_stage.fixture_enrollments(workspace_id,id,learner_id,stage_id,payload,active,child_enabled) VALUES($1,$2,$3,$4,$5::jsonb,true,true)",[workspaceId,e.id,e.learnerId,r.stageId,JSON.stringify(e)]);
   await pool.query("INSERT INTO ls_fishing_stage.fixture_guardians(workspace_id,learner_id,account_id,active) VALUES($1,$2,$3,true) ON CONFLICT DO NOTHING",[workspaceId,e.learnerId,parent.id]);return e;
  }
  const enrolled=await enrollment(),siblingEnrollment=await enrollment(sibling);
  const fault={resources:false,afterSeat:false};
  const readEnrollment=async(tx:SqlSession,context:NativeStageHookContext,id:string)=>{
   const row=await one<{payload:unknown}>(tx,"SELECT payload FROM ls_fishing_stage.fixture_enrollments WHERE workspace_id=$1 AND id=$2 AND stage_id=$3 AND active FOR SHARE",[context.actor.workspaceId,id,context.scope.stageId]);return row?parseEnrollment(row.payload):null;
  };
  const hooks:FishingStageNativeHooks={
   resolveContext:async(tx,a,r,selection)=>{
    const c=await one<{cohortId:string;stage:number;instructorId:string;capacity:number}>(tx,`SELECT cohort_id AS "cohortId",stage,instructor_id AS "instructorId",child_capacity AS capacity FROM ls_fishing_stage.fixture_contexts WHERE workspace_id=$1 AND stage_id=$2 FOR SHARE`,[a.workspaceId,r.stageId]);
    if(!c||c.cohortId!==r.cohortId||c.stage!==r.stage)return null;
    let e:EnrollmentProjection|null=null,guardian=false,enabled=false;
    if(selection.selectedEnrollmentId!==null){
     const row=await one<{payload:unknown;enabled:boolean}>(tx,`SELECT payload,child_enabled AS enabled FROM ls_fishing_stage.fixture_enrollments WHERE workspace_id=$1 AND id=$2 AND stage_id=$3 AND active FOR SHARE`,[a.workspaceId,selection.selectedEnrollmentId,r.stageId]);
     if(!row)return null;e=parseEnrollment(row.payload);enabled=row.enabled;
     guardian=(await tx.query("SELECT account_id FROM ls_fishing_stage.fixture_guardians WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3 AND active FOR SHARE",[a.workspaceId,e.learnerId,a.id])).length===1;
    }
    return {scope:{...r,workspaceId:a.workspaceId,program:"sunday_fishing_academy"},instructor:{accountId:asId(c.instructorId,"account"),displayName:"Synthetic instructor"},operatorAccountIds:[c.instructorId],approvedChildCapacity:c.capacity,enrollment:e,guardianRelationshipCurrent:guardian,childAccountEnabled:enabled};
   },
   resolveApprovedTemplate:async(tx,c,version)=>{const row=await one<{payload:unknown}>(tx,"SELECT payload FROM ls_fishing_stage.fixture_templates WHERE workspace_id=$1 AND stage=$2 AND version=$3 AND active FOR SHARE",[c.actor.workspaceId,c.scope.stage,version]);return row?parseTemplate(row.payload):null;},
   readEnrollment,
   occupiedSeats:async(tx,c,id)=>{
    const row=await one<{included:number}>(tx,"SELECT included_places AS included FROM ls_fishing_stage.fixture_capacity WHERE workspace_id=$1 AND occurrence_id=$2 FOR UPDATE",[c.actor.workspaceId,id]);if(!row)throw new AppError("UNAVAILABLE");
    const seats=await one<{total:number}>(tx,"SELECT count(*)::integer AS total FROM ls_fishing_stage.fixture_seat_effects WHERE workspace_id=$1 AND occurrence_id=$2",[c.actor.workspaceId,id]);if(!seats)throw new AppError("UNAVAILABLE");return row.included+seats.total;
   },
   reconcileResources:async(tx,c,_before,after)=>{
    const permission=await one<{approved:boolean}>(tx,"SELECT resource_approved AS approved FROM ls_fishing_stage.fixture_contexts WHERE workspace_id=$1 AND stage_id=$2 FOR SHARE",[c.actor.workspaceId,c.scope.stageId]);if(permission?.approved!==true)throw new AppError("FORBIDDEN");
    for(const o of after){if(o.state==="published"&&o.time.kind==="scheduled")await tx.query("INSERT INTO ls_fishing_stage.fixture_resource_effects(workspace_id,occurrence_id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(workspace_id,occurrence_id) DO UPDATE SET payload=EXCLUDED.payload",[c.actor.workspaceId,o.id,JSON.stringify(o.time)]);
     else await tx.query("DELETE FROM ls_fishing_stage.fixture_resource_effects WHERE workspace_id=$1 AND occurrence_id=$2",[c.actor.workspaceId,o.id]);}
    if(fault.resources)throw new AppError("UNAVAILABLE");
   },
   replacementSuitable:async(tx,c,_e,o)=>{const row=await one<{suitable:boolean}>(tx,"SELECT suitable FROM ls_fishing_stage.fixture_capacity WHERE workspace_id=$1 AND occurrence_id=$2 FOR SHARE",[c.actor.workspaceId,o.id]);return row?.suitable===true;},
   reserveMakeup:async(tx,c,input)=>{
    const occupied=await hooks.occupiedSeats(tx,c,input.target.id);if(occupied>=input.target.childCapacity)throw new AppError("CONFLICT");
    const id=randomUUID();await tx.query("INSERT INTO ls_fishing_stage.fixture_seat_effects(workspace_id,id,learner_id,occurrence_id,entitlement_id) VALUES($1,$2,$3,$4,$5)",[c.actor.workspaceId,id,input.enrollment.learnerId,input.target.id,input.entitlementId]);
    if(fault.afterSeat)throw new AppError("UNAVAILABLE");return id;
   },
  };
  function service(a:Actor=instructor,selectedEnrollmentId:string|null=null,store:IdentityStore=db,override:FishingStageNativeHooks=hooks){return new FishingStageService(new NativeFishingStageStore(store,keyring,{actor:a,selection:{selectedEnrollmentId}},override),{now:()=>new Date()});}
  const create=()=>({action:"create" as const,operationId:randomUUID(),expectedRevision:0,templateVersion:template.version,childCapacity:4});
  async function createPlan(r:FishingStageRef=ref){const result=await service().execute(instructor,r,create());
   const rows=await pool.query("SELECT id FROM ls_fishing_stage.occurrences WHERE workspace_id=$1 AND stage_id=$2 ORDER BY ordinal",[workspaceId,r.stageId]);
   for(const row of rows.rows)await pool.query("INSERT INTO ls_fishing_stage.fixture_capacity(workspace_id,occurrence_id,included_places,suitable) VALUES($1,$2,0,true)",[workspaceId,row.id]);return result;}
  async function schedule(r:FishingStageRef=ref,hours=48,capacity=4){
   const view=(await service().read(instructor,r))!,o=view.occurrences[0]!,start=new Date(Date.now()+hours*3600000),end=new Date(start.valueOf()+3600000);
   await service().execute(instructor,r,{action:"revise",operationId:randomUUID(),expectedRevision:view.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"Synthetic schedule",details:{time:{kind:"scheduled",timeZone:"America/New_York",startsAt:start.toISOString(),endsAt:end.toISOString()},location:"Synthetic site",directions:"Synthetic directions",equipment:"Synthetic equipment",logisticalNote:"Synthetic logistics",childCapacity:capacity}});
   const updated=(await service().read(instructor,r))!;await service().execute(instructor,r,{action:"publish",operationId:randomUUID(),expectedRevision:updated.revision});return (await service().read(instructor,r))!;
  }
  async function report(e:EnrollmentProjection=enrolled){const r={cohortId:e.cohortId,stageId:e.stageId,stage:e.stage},current=(await service(parent,e.id).read(parent,r))!,o=current.occurrences[0]!;
   const command={action:"notice" as const,operationId:randomUUID(),expectedRevision:current.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"ordinary_absence" as const};await service(parent,e.id).execute(parent,r,command);return {command,notice:(await service(parent,e.id).read(parent,r))!.notices[0]!};}
  async function counts(){return (await pool.query(`SELECT
   (SELECT count(*)::integer FROM ls_fishing_stage.occurrences WHERE workspace_id=$1) AS occurrences,
   (SELECT count(*)::integer FROM ls_fishing_stage.revisions WHERE workspace_id=$1) AS revisions,
   (SELECT count(*)::integer FROM ls_fishing_stage.operations WHERE workspace_id=$1) AS operations,
   (SELECT count(*)::integer FROM ls_fishing_stage.makeup_links WHERE workspace_id=$1) AS links,
   (SELECT count(*)::integer FROM ls_fishing_stage.fixture_resource_effects WHERE workspace_id=$1) AS resources,
   (SELECT count(*)::integer FROM ls_fishing_stage.fixture_seat_effects WHERE workspace_id=$1) AS seats`,[workspaceId])).rows[0] as Record<string,number>;}
  return {pool,db,keyring,workspaceId,instructor,parent,otherParent,child,sibling,enrolled,siblingEnrollment,ref,template,hooks,fault,cohort,enrollment,service,create,createPlan,schedule,report,counts,close:()=>pool.end()};
 }catch(error){await pool.end();throw error;}
}
export type NativeFixture=Awaited<ReturnType<typeof nativeFixture>>;
