import {createHash} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {loadCase,loadGuardians,loadAudience} from "../cases/data.ts";
import {caseAccess} from "../cases/policy.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {unseal,type Keyring} from "../identity/crypto.ts";
import {one,type IdentityStore} from "../identity/store.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import type {practiceVersionSnapshotDigest} from "./service.ts";
import {authorizeResponsibility,parseSavedResponsibility,nativeResponsibility,nativeResponsibilityOccurrences,nativeOccurrenceId} from "./responsibility-service.ts";
import {recurrenceInput,recurrenceCommand,recurrencePlan,type RecurrenceInput,type RecurrenceCommand,type RecurrencePlan} from "./recurrence-input.ts";
import {recordPracticeAction} from "./history.ts";
type Source=Parameters<typeof practiceVersionSnapshotDigest>[0];
type Ports={store:IdentityStore;clock:IdentityClock;ring:Keyring;versionSelect:string;digest:(source:Source)=>string;instructionsAad:(workspaceId:string,versionId:string)=>string};

/** Same retained practice writer/lock/tables. Planning never creates an event.
 * A confirmed exact plan writes only missing frozen rows, all-or-nothing. */
export async function nativeRecurrence(ports:Ports,actor:Actor,value:RecurrenceInput|RecurrenceCommand,requestId?:string):Promise<RecurrencePlan>{
 const parsed=(requestId===undefined?recurrenceInput:recurrenceCommand).safeParse(value);if(!parsed.success)throw new AppError("INVALID_REQUEST");
 const input=parsed.data,now=ports.clock.now();
 return ports.store.transaction(async tx=>{
  await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,now);
  const source=await one<Source>(tx,ports.versionSelect+" WHERE a.workspace_id=$1 AND a.id=$2 AND a.active_version_id=v.id AND a.state='published' AND v.state='published' FOR UPDATE OF a",[actor.workspaceId,input.assignmentId]);
  if(!source)throw new AppError("NOT_FOUND");const item=await loadCase(tx,actor.workspaceId,source.caseId);
  caseAccess(current,item,await loadGuardians(tx,actor.workspaceId,source.caseId),"write");
  if(current.role!=="practitioner"||!item)throw new AppError("NOT_FOUND");
  if(source.versionId!==input.expectedVersionId||source.immutableSnapshotDigest!==input.expectedSnapshotDigest)throw new AppError("CONFLICT");
  if(!source.publishedAt||ports.digest(source)!==source.immutableSnapshotDigest)throw new AppError("UNAVAILABLE");
  const responsibility=parseSavedResponsibility(source.responsibility),audience=await loadAudience(tx,actor.workspaceId,source.caseId,source.audienceId);
  if(!responsibility||!source.endsOn||!audience?.published||audience.visibility==="private")throw new AppError("NOT_FOUND");
  if(input.from<source.startsOn||input.to>source.endsOn)throw new AppError("INVALID_REQUEST");
   const instructions=unseal(source.instructionsCiphertext,ports.instructionsAad(actor.workspaceId,source.versionId),ports.ring);
  await authorizeResponsibility(tx,current,item,audience,responsibility,source.startsOn,source.endsOn,instructions);
  const native=nativeResponsibility({...source,versionId:source.versionId,instructions},item.clientPersonId,responsibility,audience.accountIds),days=(Date.parse(input.to+"T12:00:00Z")-Date.parse(input.from+"T12:00:00Z"))/86400000+1,planned=nativeResponsibilityOccurrences(native,responsibility,input.from,days);
  // A DST gap/fold or omitted eligible date is not a partial successful schedule.
  if(planned.unresolved.length)throw new AppError("CONFLICT");if(!planned.occurrences.length)throw new AppError("INVALID_REQUEST");
  const proposals=planned.occurrences.map(row=>({id:nativeOccurrenceId(row.id),occursOn:row.localDate,occursAt:row.startsAt}));
  const coordination=await tx.query<{id:string;coordinationVersionId:string|null}>(`SELECT p.id,c.id AS "coordinationVersionId" FROM jsonb_to_recordset($4::jsonb) AS p(id uuid,"occursAt" timestamptz)
   LEFT JOIN LATERAL (SELECT id FROM ls_practice.task_coordination_versions WHERE workspace_id=$1 AND assignment_id=$2 AND responsibility_version_id=$3 AND effective_from<=p."occursAt" ORDER BY effective_from DESC,version DESC LIMIT 1)c ON true`,[actor.workspaceId,input.assignmentId,source.versionId,JSON.stringify(proposals)]);
  if(coordination.length!==proposals.length||coordination.some(row=>!row.coordinationVersionId))throw new AppError("CONFLICT");
  const coordinations=new Map(coordination.map(row=>[row.id,row.coordinationVersionId!]));
  const stored=await tx.query<{id:string;practiceVersionId:string;coordinationVersionId:string;occursOn:string;occursAt:Date|null;state:string}>(`SELECT id,practice_version_id AS "practiceVersionId",coordination_version_id AS "coordinationVersionId",occurs_on::text AS "occursOn",occurs_at AS "occursAt",state FROM ls_practice.practice_occurrences
   WHERE workspace_id=$1 AND assignment_id=$2 AND period=$5 AND (id=ANY($3::uuid[]) OR (occurs_on BETWEEN $4::date AND $6::date AND state<>'cancelled')) ORDER BY id LIMIT 85`,[actor.workspaceId,input.assignmentId,proposals.map(row=>row.id),input.from,responsibility.period,input.to]);
  if(stored.length>84)throw new AppError("UNAVAILABLE");
  const existing=new Map(stored.map(row=>[row.id,row]));
  const rows=proposals.map(proposal=>{
   // Existing entries keep their frozen coordination, including exact replay.
   // Only missing entries use the currently effective coordination version.
   const found=existing.get(proposal.id),coordinationVersionId=found?found.coordinationVersionId:coordinations.get(proposal.id);if(!coordinationVersionId)throw new AppError("UNAVAILABLE");
   if(found&&(found.practiceVersionId!==source.versionId||found.occursAt?.toISOString()!==proposal.occursAt||!['open','closed'].includes(found.state)))throw new AppError("CONFLICT");
   if(stored.some(row=>row.occursOn===proposal.occursOn&&row.id!==proposal.id&&row.state!=='cancelled'))throw new AppError("CONFLICT");
   return {...proposal,assignmentId:input.assignmentId,practiceVersionId:source.versionId,coordinationVersionId,period:responsibility.period,state:found?.state??"open",existing:Boolean(found)};
  });
  const planDigest=createHash('sha256').update(JSON.stringify(['native-practice-range-v1',actor.workspaceId,source.caseId,input.assignmentId,source.versionId,source.immutableSnapshotDigest,input.from,input.to,rows.map(row=>[row.id,row.coordinationVersionId,row.occursOn,row.occursAt,row.period])])).digest('hex');
  if(requestId!==undefined){
   if(!('expectedPlanDigest' in input)||input.expectedPlanDigest!==planDigest)throw new AppError("CONFLICT");const fresh=rows.filter(row=>!row.existing);
   if(fresh.length){const inserted=await tx.query<{id:string}>(`INSERT INTO ls_practice.practice_occurrences(id,workspace_id,assignment_id,practice_version_id,coordination_version_id,occurs_on,period,state,created_at,occurs_at)
    SELECT p.id,$1,$2,$3,p."coordinationVersionId",p."occursOn",$4,'open',$5,p."occursAt" FROM jsonb_to_recordset($6::jsonb) AS p(id uuid,"coordinationVersionId" uuid,"occursOn" date,"occursAt" timestamptz) RETURNING id`,[actor.workspaceId,input.assignmentId,source.versionId,responsibility.period,now,JSON.stringify(fresh)]);
    if(inserted.length!==fresh.length)throw new AppError("CONFLICT");await recordPracticeAction(tx,{requestId,now},actor.workspaceId,actor.id,"practice_occurrence_scheduled");
   }
   for(const row of rows)row.existing=true;
  }
  return recurrencePlan.parse({assignmentId:input.assignmentId,practiceVersionId:source.versionId,caseId:source.caseId,audienceId:source.audienceId,from:input.from,to:input.to,localTime:responsibility.localTime,timezone:responsibility.timezone,weekdays:responsibility.weekdays,planDigest,items:rows});
 });
}
