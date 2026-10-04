import "server-only";
import {AppError} from "../../lib/errors.ts";
import type {Actor} from "../identity/types.ts";
import type {IdentityStore} from "../identity/store.ts";
import {freshActor} from "../identity/data.ts";
import {requirePractitioner} from "../cases/policy.ts";
import {identityRuntime} from "../identity/runtime.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {readAuthoritativeProspects} from "../contact-ops/server/authoritative-prospects.ts";
import {readProspectJourneysFromTx} from "../prospects/journey-read.ts";
import type {Prospect} from "../prospects/bridge.ts";
import {prospectContactSuppressed,prospectArchived} from "../prospects/native-edit.ts";
import {loadMarketingSnapshot} from "../marketing-overview/provider.ts";
import type {MarketingSnapshot} from "../marketing-overview/contracts.ts";
import {contentDayKey} from "../marketing-overview/calendar-model.ts";
import {buildOwnerDigest,summarizeProspects,validateDigestProspects,type TaskCounts} from "./model.ts";

type Runtime=Awaited<ReturnType<typeof identityRuntime>>;
async function assertOwner(store:IdentityStore,actor:Actor,now:Date){return store.transaction(async tx=>{const current=await freshActor(tx,actor,now);requirePractitioner(current);return current;});}
function count(value:unknown):number{const result=typeof value==="string"&&/^\d+$/.test(value)?Number(value):value;if(typeof result!=="number"||!Number.isSafeInteger(result)||result<0)throw new AppError("UNAVAILABLE");return result;}
/** Aggregate task facts only. Never decrypt session/clinical/task narratives. */
export async function readTaskCounts(store:IdentityStore,actor:Actor,now:Date):Promise<TaskCounts>{
 return store.transaction(async tx=>{
  await tx.query("SET TRANSACTION READ ONLY");const current=await freshActor(tx,actor,now);requirePractitioner(current);
  const rows=await tx.query<{due:unknown;overdue:unknown;future:unknown}>(`SELECT
   COUNT(*) FILTER(WHERE t.due_date=$3::date) AS due,
   COUNT(*) FILTER(WHERE t.due_date<$3::date) AS overdue,
   COUNT(*) FILTER(WHERE t.due_date>$3::date) AS future
   FROM ls_calendar.tasks t LEFT JOIN ls_cases.cases c ON c.workspace_id=t.workspace_id AND c.id=t.case_id
   WHERE t.workspace_id=$1 AND t.created_by=$2 AND t.state='open'
   AND (to_jsonb(t)->>'source_kind') IS DISTINCT FROM 'crm_followup'
   AND (t.case_id IS NULL OR c.practitioner_account_id=$2)
   AND NOT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=t.workspace_id AND d.case_id=t.case_id)
   AND NOT EXISTS(SELECT 1 FROM ls_demo.records d WHERE d.workspace_id=t.workspace_id AND d.entity_kind='task' AND d.entity_key=t.id::text)`,
   [current.workspaceId,current.id,contentDayKey(now.toISOString())]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");const row=rows[0]!;return {due:count(row.due),overdue:count(row.overdue),future:count(row.future)};
 });
}
async function realProspects(store:IdentityStore,actor:Actor,rows:readonly Prospect[],now:Date){
 return store.transaction(async tx=>{
  await tx.query("SET TRANSACTION READ ONLY");const current=await freshActor(tx,actor,now);requirePractitioner(current);
  const demo=await tx.query<{id:string}>(`SELECT entity_key AS id FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='prospect' AND entity_key IN(SELECT jsonb_array_elements_text($2::jsonb))`,[current.workspaceId,JSON.stringify(rows.map(row=>row.leadId))]);
  const excluded=new Set(demo.map(row=>row.id));return rows.filter(row=>!excluded.has(row.leadId));
 });
}
export async function readIntakeFacts(store:IdentityStore,actor:Actor,rows:readonly Prospect[],now:Date){
 return store.transaction(async tx=>{
  await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");const current=await freshActor(tx,actor,now);requirePractitioner(current);
  validateDigestProspects(rows);
  const ids=rows.filter(row=>!prospectArchived(row)&&!prospectContactSuppressed(row)).map(row=>row.leadId),journeys=await readProspectJourneysFromTx(tx,current.workspaceId,ids);
  // A canonical journey is created by submission. Another unused invitation
  // must not reintroduce form work or a second acceptance step afterward.
  const pendingFormIds=ids.filter(id=>!journeys.has(id));
  const forms=await tx.query<{total:unknown}>(`SELECT COUNT(DISTINCT i.stable_lead_ref) AS total FROM ls_intake.pre_enrollment_invitations i
   WHERE i.workspace_id=$1 AND i.created_by_account_id=$2 AND i.stable_lead_ref IN(SELECT jsonb_array_elements_text($3::jsonb))
   AND i.revoked_at IS NULL AND i.consumed_at IS NULL AND i.expires_at>$4
   AND NOT EXISTS(SELECT 1 FROM ls_intake.pre_enrollment_receipts r WHERE r.workspace_id=i.workspace_id AND r.invitation_id=i.invitation_id)`,
   [current.workspaceId,current.id,JSON.stringify(pendingFormIds),now]);
  if(forms.length!==1)throw new AppError("UNAVAILABLE");return {journeys,awaitingForm:count(forms[0]!.total)};
 });
}
export async function loadOwnerDigest(actor:Actor,runtime:Runtime,marketing:MarketingSnapshot,locale:"he"|"en",now=runtime.clock.now()){
 await assertOwner(runtime.store,actor,now);
 const [prospects,tasks]=await Promise.allSettled([
  readAuthoritativeProspects(actor,runtime).then(rows=>{validateDigestProspects(rows);return realProspects(runtime.store,actor,rows,now);}),
  readTaskCounts(runtime.store,actor,now),
 ]);
 const rows=prospects.status==="fulfilled"?prospects.value:null;
 const intake=rows?await readIntakeFacts(runtime.store,actor,rows,now).catch(error=>{if(error instanceof AppError&&["UNAUTHENTICATED","FORBIDDEN"].includes(error.code))throw error;return null;}):null;
 const facts=rows?.map(row=>({...row,...(intake?.journeys.get(row.leadId)??{journeyState:"prospect",paymentVerified:false,bookingConfirmed:false})}));
 let counts=null;
 try{counts=facts?summarizeProspects(facts,contentDayKey(now.toISOString()),Boolean(intake)):null;}
 catch(error){if(!(error instanceof Error)||error.message!=="INVALID_DIGEST_PROSPECTS")throw error;}
 if(counts)counts.awaitingForm=intake?.awaitingForm??null;
 // Do not return aggregates after revocation or a role change during remote reads.
 await assertOwner(runtime.store,actor,runtime.clock.now());
 return buildOwnerDigest({now,locale,marketing,followups:counts?{data:counts,asOf:now.toISOString()}:null,tasks:tasks.status==="fulfilled"?{data:tasks.value,asOf:now.toISOString()}:null,journeysAvailable:Boolean(intake)});
}
export async function ownerDigestContext(cookie:string|null){
 const values=(cookie??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
 if(values.length!==1)throw new AppError("UNAUTHENTICATED");
 const runtime=await identityRuntime(),actor=await runtime.services.sessions.actor(values[0]!.slice(SESSION_COOKIE.length+1));
 if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");return {actor,runtime};
}
export async function ownerDigestForRequest(request:Request,marketing?:MarketingSnapshot){
 if(new URL(request.url).searchParams.size)throw new AppError("INVALID_REQUEST");
 const {actor,runtime}=await ownerDigestContext(request.headers.get("cookie"));
 return {digest:await loadOwnerDigest(actor,runtime,marketing??await loadMarketingSnapshot(),actor.locale),origin:runtime.config.origin,locale:actor.locale};
}
