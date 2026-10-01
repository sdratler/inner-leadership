/** Historical migration fixtures, not an alternate application adapter.
 * Raw seed rows exercise the original native triggers before new columns exist;
 * current service behavior is exercised only after the final migration. */
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import pg from "pg";
import {safeTestUrl,type Fixture} from "../calendar/fixture.ts";
import {migrate} from "../../../src/db/migration-runner.ts";
import type {Migration} from "../../../src/db/migration-plan.ts";
import {seal} from "../../../src/features/identity/crypto.ts";
import {asId} from "../../../src/lib/ids.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
export function practiceMigrationInventory():Migration[]{
 const entries=JSON.parse(readFileSync(new URL("../../../migrations/manifest.json",import.meta.url),"utf8"))as {name:string;sha256:string}[];
 return entries.map(entry=>{const bytes=readFileSync(new URL("../../../migrations/"+entry.name,import.meta.url));if(createHash("sha256").update(bytes).digest("hex")!==entry.sha256)throw Error("HISTORICAL_FIXTURE_SOURCE_MISMATCH");return {name:entry.name,checksum:entry.sha256,sql:bytes.toString("utf8")};});
}
export async function historicalPracticeDatabase(last:"0107_ls_practice_subject_guards.sql"|"0111_ls_adult_practice_coordination.sql"|"0113_ls_speaker_correction_receipts.sql"){
 const url=new URL(safeTestUrl()),db="ls_calendar_test_practice_history_"+randomBytes(8).toString("hex");
 if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname)||url.search||url.hash||!/^ls_calendar_test_practice_history_[a-f0-9]{16}$/.test(db))throw Error("HISTORICAL_FIXTURE_TARGET_INVALID");
 const adminUrl=new URL(url);adminUrl.pathname="/postgres";url.pathname="/"+db;
 const admin=new pg.Pool({connectionString:adminUrl.toString(),ssl:false,max:1}),pool=new pg.Pool({connectionString:url.toString(),ssl:false,max:1});let created=false;
 const close=async()=>{await pool.end();if(created){await admin.query(`DROP DATABASE "${db}"`);created=false;}await admin.end();};
 try{
  await admin.query(`CREATE DATABASE "${db}"`);created=true;
  const inventory=practiceMigrationInventory(),index=inventory.findIndex(file=>file.name===last);if(index<0)throw Error("HISTORICAL_FIXTURE_MIGRATION_MISSING");const files=inventory.slice(0,index+1);
  const client=await pool.connect();try{await migrate({query:async(sql,values)=>client.query(sql,values?[...values]:undefined)},files,false);}finally{client.release();}
  return {url:url.toString(),pool,files,inventory,close};
 }catch(error){await close();throw error;}
}
export async function legacyCoordination(f:Fixture,assignmentId:string,changedBy:Actor,assignees:readonly string[],effectiveFrom:string){
 const versionId=asId(randomUUID(),"coordination_version"),version=Number((await f.pool.query("SELECT coalesce(max(version),0)+1 AS next FROM ls_practice.task_coordination_versions WHERE workspace_id=$1 AND assignment_id=$2",[f.workspaceId,assignmentId])).rows[0].next);
 await f.pool.query(`INSERT INTO ls_practice.task_coordination_versions(id,workspace_id,assignment_id,version,case_id,audience_id,assignee_account_ids,completion_mode,reminder_candidate_account_ids,effective_from,changed_by_account_id,created_at)
  VALUES($1,$2,$3,$4,$5,$6,$7::uuid[],'any_assignee','{}',$8,$9,now())`,[versionId,f.workspaceId,assignmentId,version,f.first.id,f.first.audienceId,assignees,effectiveFrom,changedBy.id]);return {versionId};
}
export async function legacyPracticeSeed(f:Fixture){
 const assignmentId=asId(randomUUID(),"practice_assignment"),versionId=asId(randomUUID(),"practice_version"),now=new Date(),startsOn=f.at(-24).slice(0,10),instructionsCiphertext=seal("Synthetic retained practice instruction",`practice-version:${f.workspaceId}:${versionId}`,f.keyring);
 const digest=createHash("sha256").update(JSON.stringify([f.workspaceId,f.first.id,assignmentId,versionId,1,f.first.audienceId,null,null,"W01","synthetic-historical-v1",instructionsCiphertext,startsOn,null])).digest("hex");
 await f.pool.query(`INSERT INTO ls_practice.practice_assignments(id,workspace_id,case_id,audience_id,state,created_by_account_id,created_at) VALUES($1,$2,$3,$4,'draft',$5,$6)`,[assignmentId,f.workspaceId,f.first.id,f.first.audienceId,f.practitioner.actor.id,now]);
 await f.pool.query(`INSERT INTO ls_practice.practice_assignment_versions(id,workspace_id,assignment_id,version,template_key,template_version,instructions_ciphertext,starts_on,state,created_by_account_id,created_at)
  VALUES($1,$2,$3,1,'W01','synthetic-historical-v1',$4,$5,'draft',$6,$7)`,[versionId,f.workspaceId,assignmentId,instructionsCiphertext,startsOn,f.practitioner.actor.id,now]);
 await f.pool.query("UPDATE ls_practice.practice_assignment_versions SET state='published',published_by_account_id=$3,published_at=$4,immutable_snapshot_digest=$5 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,versionId,f.practitioner.actor.id,now,digest]);
 await f.pool.query("UPDATE ls_practice.practice_assignments SET state='published',active_version_id=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,assignmentId,versionId]);
 const oldCoord=await legacyCoordination(f,assignmentId,f.parent.actor,[f.parent.actor.id],f.at(1)),occurrenceId=asId(randomUUID(),"occurrence"),reportId=asId(randomUUID(),"completion_report"),occursOn=f.at(48).slice(0,10);
 await f.pool.query(`INSERT INTO ls_practice.practice_occurrences(id,workspace_id,assignment_id,practice_version_id,coordination_version_id,occurs_on,period,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'morning','open',$7)`,[occurrenceId,f.workspaceId,assignmentId,versionId,oldCoord.versionId,occursOn,now]);
 await f.pool.query(`INSERT INTO ls_practice.completion_reports(id,workspace_id,occurrence_id,author_account_id,status,revision,reported_at,idempotency_key) VALUES($1,$2,$3,$4,'done',1,$5,$6)`,[reportId,f.workspaceId,occurrenceId,f.parent.actor.id,now,randomUUID()]);
 await f.pool.query("UPDATE ls_practice.practice_occurrences SET state='closed',closed_at=$3 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,occurrenceId,now]);
 for(const action of ["practice_assignment_draft_created","practice_assignment_published","practice_coordination_changed","practice_occurrence_scheduled","practice_checkin_reported"])await f.pool.query("INSERT INTO ls_practice.action_history(id,workspace_id,actor_account_id,request_id,action,occurred_at) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),f.workspaceId,action.includes("coordination")||action.includes("checkin")?f.parent.actor.id:f.practitioner.actor.id,randomUUID(),action,now]);
 return {saved:{assignmentId,versionId},oldCoord,oldOccurrence:{id:occurrenceId,occursOn},oldReport:{id:reportId}};
}
