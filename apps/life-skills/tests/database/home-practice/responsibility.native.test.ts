/** Retained native services, production binder and fresh synthetic case actors.
 * Ordinary password-login/UI evidence is separate; these are not login proofs. */
import {afterEach,expect,test} from "vitest";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {HomePracticeService} from "../../../src/features/home-practice/service.ts";
import {CheckInService,practiceReportNoteAad} from "../../../src/features/checkins/service.ts";
import {systemClock,type Actor} from "../../../src/features/identity/types.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import type {ResponsibilityInput} from "../../../src/features/home-practice/responsibility-input.ts";
import {seal,unseal,tokenDigest} from "../../../src/features/identity/crypto.ts";
import {asId} from "../../../src/lib/ids.ts";
import {readFileSync} from "node:fs";
import {practiceResponsibilityIntegrity} from "../../../src/db/practice-responsibility-integrity.ts";
import type {Migration} from "../../../src/db/migration-plan.ts";
import type {SqlSession} from "../../../src/features/identity/store.ts";

let f:Fixture;
afterEach(async()=>{await f?.pool.end();});
async function setup(){
 f=await fixture();const store=poolStore(f.pool),config:IdentityConfig={enabled:true,origin:"https://synthetic.example.invalid",workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600};
 const practice=new HomePracticeService(store,config,systemClock),checkins=new CheckInService(store,systemClock,f.keyring);
 const input:ResponsibilityInput={participant:"client",period:"morning",assigneeAccountIds:[],assistedByParentAccountIds:[f.parent.actor.id],reminderRecipients:[{accountId:f.parentTwo.actor.id,purpose:"remind_child"}],completionMode:"any_assignee",weekdays:[0,1,2,3,4,5,6],localTime:"18:45",timezone:"UTC",timeOrigin:"practitioner",foldChoice:null};
 const startsOn=f.at(24).slice(0,10),endsOn=f.at(240).slice(0,10),occursOn=f.at(48).slice(0,10);
 async function publish(responsibility=input,instructions="Synthetic child practice"){
  const draft=await practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,templateKey:"W01",templateVersion:"synthetic-responsibility-v1",instructions,startsOn,endsOn,responsibility},randomUUID());
  await practice.publish(f.practitioner.actor,draft.assignmentId,draft.versionId,randomUUID());return draft;
 }
 return {practice,checkins,input,startsOn,endsOn,occursOn,publish};
}
async function child(){
 const id=asId(randomUUID(),"account"),personId=asId((await f.pool.query("SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.workspace_id=$1 AND c.id=$2",[f.workspaceId,f.first.id])).rows[0].person_id as string,"person"),now=new Date();
 const actor:Actor={id,workspaceId:f.workspaceId,personId,role:"child",state:"active",locale:"en",sessionDigest:tokenDigest(randomBytes(32).toString("base64url")),expiresAt:Date.now()+3600000};
 await f.pool.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'child','active','en',$3,$4,$5,'synthetic-non-login-hash',$5,$5)`,[id,f.workspaceId,createHash("sha256").update(id).digest("hex"),seal("synthetic-child@example.invalid",`email:${f.workspaceId}:${id}`,f.keyring),now]);
 await f.pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[f.workspaceId,id,personId]);
 await f.pool.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[actor.sessionDigest,f.workspaceId,id,now,new Date(actor.expiresAt)]);
 await f.pool.query("INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,$5)",[f.workspaceId,f.first.id,f.first.audienceId,id,now]);
 return actor;
}
test("no child device: explicit time, deterministic schedule, encrypted real-parent result and exact replay/correction",async()=>{
 const {practice,checkins,input,publish,occursOn}=await setup(),draft=await publish();
  expect((await practice.participants(f.practitioner.actor,f.first.id,f.first.audienceId)).accounts.map(row=>row.role)).toEqual(["parent","parent"]);
  const coordination=await practice.coordination(f.parent.actor,draft.assignmentId);
  expect(coordination).toMatchObject({readOnlyReason:"client_responsibility",eligibleAccountIds:[]});expect(coordination.versions[0]).toMatchObject({responsibilityVersionId:draft.versionId,participant:"client",assigneeAccountIds:[],assistedParentAccountIds:[f.parent.actor.id],reminderCandidateAccountIds:[f.parentTwo.actor.id]});
 const occurrence=await practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn,period:"morning"},randomUUID());
 expect(occurrence.occursAt).toBe(occursOn+"T18:45:00.000Z");expect(await practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn,period:"morning"},randomUUID())).toEqual(occurrence);
 const command={occurrenceId:occurrence.id,status:"partly_done" as const,idempotencyKey:randomUUID(),assistance:{mode:"together" as const,note:"Synthetic together feedback preserved"}};
 await checkins.submit(f.parent.actor,command,randomUUID());await checkins.submit(f.parent.actor,command,randomUUID());
 const saved=(await checkins.list(f.parent.actor,occurrence.id,true))[0]!;
 expect(saved).toMatchObject({authorAccountId:f.parent.actor.id,idempotencyKey:command.idempotencyKey,status:"partly_done",revision:1,attribution:{authorship:"parent_assisted_child",note:command.assistance.note}});
 expect((await checkins.list(f.practitioner.actor,occurrence.id))[0]?.attribution).toEqual(saved.attribution);
 expect((await checkins.list(f.parentTwo.actor,occurrence.id))[0]).not.toHaveProperty("attribution");
 const row=(await f.pool.query("SELECT note_ciphertext FROM ls_practice.completion_reports WHERE workspace_id=$1 AND id=$2",[f.workspaceId,saved.reportId])).rows[0];
 expect(row.note_ciphertext).not.toContain(command.assistance.note);
 expect(()=>unseal(row.note_ciphertext,practiceReportNoteAad(f.workspaceId,f.second.id,draft.versionId,occurrence.id,saved.reportId,f.parent.actor.id,saved.attribution!.subjectPersonId,"parent_assisted_child"),f.keyring)).toThrow();
 await expect(checkins.submit(f.parent.actor,{...command,assistance:{...command.assistance,note:"different"}},randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
 await expect(checkins.submit(f.parentTwo.actor,{...command,idempotencyKey:randomUUID()},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(checkins.submit(f.parent.actor,{...command,assistance:undefined,idempotencyKey:randomUUID()},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(checkins.submit(f.outsider.actor,{...command,idempotencyKey:randomUUID()},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 await checkins.submit(f.parent.actor,{...command,idempotencyKey:randomUUID(),status:"done",correctsReportId:saved.reportId,assistance:{mode:"parent_report",note:"Synthetic corrected note"}},randomUUID());
 const history=await checkins.list(f.practitioner.actor,occurrence.id);expect(history).toHaveLength(2);expect(history[0]?.attribution?.note).toBe(command.assistance.note);expect(history[1]).toMatchObject({revision:2,authorAccountId:f.parent.actor.id,attribution:{authorship:"parent_reporting_child",note:"Synthetic corrected note"}});
 expect((await practice.management(f.practitioner.actor,f.first.id,f.first.audienceId)).items[0]?.responsibility).toEqual(input);
 await f.pool.query("UPDATE ls_cases.case_guardians SET revoked_at=now() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3",[f.workspaceId,f.first.id,f.parent.actor.id]);
 await expect(checkins.submit(f.parent.actor,command,randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
},30000);
test("parent support and optional exact child self practice have independent occurrences and completion",async()=>{
 const {practice,checkins,input,publish,occursOn}=await setup(),client=await child();
 const a=await publish({...input,assigneeAccountIds:[client.id]}),b=await publish({...input,participant:"parent",assigneeAccountIds:[f.parent.actor.id,f.parentTwo.actor.id],assistedByParentAccountIds:[],reminderRecipients:[],completionMode:"each_assignee",period:"evening",localTime:"19:10"},"Synthetic parent support");
 const first=await practice.schedule(f.practitioner.actor,{assignmentId:a.assignmentId,occursOn,period:"morning"},randomUUID()),second=await practice.schedule(f.practitioner.actor,{assignmentId:b.assignmentId,occursOn,period:"evening"},randomUUID());
 const self={occurrenceId:first.id,status:"done" as const,idempotencyKey:randomUUID()};await checkins.submit(client,self,randomUUID());expect((await checkins.list(client,first.id,true))[0]?.attribution?.authorship).toBe("self");
 await expect(checkins.submit(client,{...self,occurrenceId:second.id,idempotencyKey:randomUUID()},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 await checkins.submit(f.parent.actor,{occurrenceId:second.id,status:"done",idempotencyKey:randomUUID()},randomUUID());expect((await f.pool.query("SELECT state FROM ls_practice.practice_occurrences WHERE id=$1",[second.id])).rows[0].state).toBe("open");
 await checkins.submit(f.parentTwo.actor,{occurrenceId:second.id,status:"done",idempotencyKey:randomUUID()},randomUUID());expect((await f.pool.query("SELECT state FROM ls_practice.practice_occurrences WHERE id=$1",[second.id])).rows[0].state).toBe("closed");
 await expect(practice.coordinate(f.parent.actor,{assignmentId:a.assignmentId,assigneeAccountIds:[f.parent.actor.id],completionMode:"any_assignee",reminderCandidateAccountIds:[],effectiveFrom:f.at(1)},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 const coord=await practice.coordinate(f.parent.actor,{assignmentId:b.assignmentId,assigneeAccountIds:[f.parent.actor.id],completionMode:"any_assignee",reminderCandidateAccountIds:[],effectiveFrom:f.at(1)},randomUUID());
 const later=await practice.schedule(f.practitioner.actor,{assignmentId:b.assignmentId,occursOn:f.at(72).slice(0,10),period:"evening"},randomUUID());expect(later.coordinationVersionId).toBe(coord.versionId);
 expect((await f.pool.query("SELECT coordination_version_id FROM ls_practice.practice_occurrences WHERE id=$1",[second.id])).rows[0].coordination_version_id).not.toBe(coord.versionId);
},30000);
test("revision cancels only unreported future timed rows and retains immutable versions and reported results",async()=>{
 const {practice,checkins,publish,occursOn,startsOn,endsOn}=await setup(),draft=await publish();
 const reported=await practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn,period:"morning"},randomUUID()),future=await practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn:f.at(72).slice(0,10),period:"morning"},randomUUID());
 await checkins.submit(f.parent.actor,{occurrenceId:reported.id,status:"done",idempotencyKey:randomUUID(),assistance:{mode:"together",note:"retained"}},randomUUID());
 const old=(await practice.management(f.practitioner.actor,f.first.id,f.first.audienceId)).items[0]!;
 const revised=await practice.revise(f.practitioner.actor,{assignmentId:draft.assignmentId,instructions:"Synthetic new frozen instructions",startsOn,endsOn},randomUUID());await practice.publish(f.practitioner.actor,draft.assignmentId,revised.versionId,randomUUID());
 expect((await f.pool.query("SELECT state FROM ls_practice.practice_occurrences WHERE id=$1",[reported.id])).rows[0].state).toBe("closed");expect((await f.pool.query("SELECT state FROM ls_practice.practice_occurrences WHERE id=$1",[future.id])).rows[0].state).toBe("cancelled");
 const next=await practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn:future.occursOn,period:"morning"},randomUUID());expect(next.id).not.toBe(future.id);expect(next.practiceVersionId).toBe(revised.versionId);
 const versions=(await practice.management(f.practitioner.actor,f.first.id,f.first.audienceId)).items;expect(versions.find(row=>row.versionId===old.versionId)).toEqual({...old,active:false});
 await expect(checkins.submit(f.parent.actor,{occurrenceId:future.id,status:"done",idempotencyKey:randomUUID(),assistance:{mode:"together",note:"not sent"}},randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
},30000);
test("publication waiting for the workspace lock preserves an occurrence that starts before cancellation executes",async()=>{
 const h=await setup(),target=new Date(Date.now()+1800),today=target.toISOString().slice(0,10),responsibility={...h.input,localTime:target.toISOString().slice(11,16)},draft=await h.practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,templateKey:"W01",templateVersion:"synthetic-lock-boundary",instructions:"DEMO — Boundary original",startsOn:today,endsOn:h.endsOn,responsibility},randomUUID());
 await h.practice.publish(f.practitioner.actor,draft.assignmentId,draft.versionId,randomUUID());
 const future=await h.practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn:h.occursOn,period:"morning"},randomUUID()),startedId=asId(randomUUID(),"occurrence"),revised=await h.practice.revise(f.practitioner.actor,{assignmentId:draft.assignmentId,instructions:"DEMO — Boundary revised",startsOn:today,endsOn:h.endsOn},randomUUID());
 // Valid isolated timestamp fixture: source date/time/coordination remain bound,
 // and the unchanged DB trigger still decides whether cancellation is legal.
 await f.pool.query("INSERT INTO ls_practice.practice_occurrences(id,workspace_id,assignment_id,practice_version_id,coordination_version_id,occurs_on,period,state,created_at,occurs_at) VALUES($1,$2,$3,$4,$5,$6,'morning','open',clock_timestamp(),$7)",[startedId,f.workspaceId,draft.assignmentId,draft.versionId,future.coordinationVersionId,today,target]);
 const blocker=await f.pool.connect();let pending:Promise<{ok:boolean;message?:string}>|undefined;
 try{
  await blocker.query("BEGIN");await blocker.query("SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE",[f.workspaceId]);const pid=(await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  expect(target.getTime()).toBeGreaterThan(Date.now());pending=h.practice.publish(f.practitioner.actor,draft.assignmentId,revised.versionId,randomUUID()).then(()=>({ok:true}),error=>({ok:false,message:error.message}));
  let waiting=false;for(let tries=0;tries<100&&!waiting;tries++){waiting=(await f.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting",[pid])).rows[0].waiting;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));}expect(waiting).toBe(true);
  await blocker.query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp()))+0.1))",[target]);await blocker.query("COMMIT");
  expect(await pending).toEqual({ok:true});
  expect((await f.pool.query("SELECT state,cancelled_at,superseded_by_version_id FROM ls_practice.practice_occurrences WHERE id=$1",[startedId])).rows[0]).toEqual({state:"open",cancelled_at:null,superseded_by_version_id:null});
  expect((await f.pool.query("SELECT state FROM ls_practice.practice_occurrences WHERE id=$1",[future.id])).rows[0].state).toBe("cancelled");
  await expect(f.pool.query("UPDATE ls_practice.practice_occurrences SET state='cancelled',cancelled_at=clock_timestamp(),superseded_by_version_id=$2 WHERE id=$1",[startedId,revised.versionId])).rejects.toMatchObject({code:"23514"});
 }finally{await blocker.query("ROLLBACK");blocker.release();if(pending)await pending;}
},30000);

test("within-statement cancellation boundary leaves the newly started row open without rolling back publication",async()=>{
 const h=await setup(),target=new Date(Date.now()+2500),today=target.toISOString().slice(0,10),draft=await h.practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,templateKey:"W01",templateVersion:"synthetic-statement-boundary",instructions:"DEMO — Statement boundary original",startsOn:today,endsOn:h.endsOn,responsibility:{...h.input,localTime:target.toISOString().slice(11,16)}},randomUUID());
 await h.practice.publish(f.practitioner.actor,draft.assignmentId,draft.versionId,randomUUID());
 const future=await h.practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn:h.occursOn,period:"morning"},randomUUID()),startedId=asId(randomUUID(),"occurrence"),revised=await h.practice.revise(f.practitioner.actor,{assignmentId:draft.assignmentId,instructions:"DEMO — Statement boundary revised",startsOn:today,endsOn:h.endsOn},randomUUID());
 await f.pool.query("INSERT INTO ls_practice.practice_occurrences(id,workspace_id,assignment_id,practice_version_id,coordination_version_id,occurs_on,period,state,created_at,occurs_at) VALUES($1,$2,$3,$4,$5,$6,'morning','open',clock_timestamp(),$7)",[startedId,f.workspaceId,draft.assignmentId,draft.versionId,future.coordinationVersionId,today,target]);
 // Isolated delay runs AFTER the UPDATE selects its row, BEFORE the unchanged
 // production cancellation trigger. This is not the earlier workspace-lock case.
 await f.pool.query(`CREATE FUNCTION ls_practice.test_delay_cancellation_boundary() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN IF NEW.id='${startedId}'::uuid AND NEW.state='cancelled' THEN PERFORM pg_sleep(GREATEST(0,extract(epoch FROM (NEW.occurs_at-clock_timestamp()))+0.1)); END IF; RETURN NEW; END $fn$`);
 await f.pool.query("CREATE TRIGGER aa_test_delay_cancellation_boundary BEFORE UPDATE ON ls_practice.practice_occurrences FOR EACH ROW EXECUTE FUNCTION ls_practice.test_delay_cancellation_boundary()");
 try{
  expect(target.getTime()).toBeGreaterThan(Date.now());await h.practice.publish(f.practitioner.actor,draft.assignmentId,revised.versionId,randomUUID());
  expect((await f.pool.query("SELECT state,cancelled_at,superseded_by_version_id FROM ls_practice.practice_occurrences WHERE id=$1",[startedId])).rows[0]).toEqual({state:"open",cancelled_at:null,superseded_by_version_id:null});
  expect((await f.pool.query("SELECT state FROM ls_practice.practice_occurrences WHERE id=$1",[future.id])).rows[0].state).toBe("cancelled");
  expect((await f.pool.query("SELECT active_version_id FROM ls_practice.practice_assignments WHERE id=$1",[draft.assignmentId])).rows[0].active_version_id).toBe(revised.versionId);
  await expect(f.pool.query("UPDATE ls_practice.practice_occurrences SET state='cancelled',cancelled_at=clock_timestamp(),superseded_by_version_id=$2 WHERE id=$1",[startedId,revised.versionId])).rejects.toMatchObject({code:"23514",message:"LS_PRACTICE_OCCURRENCE_CANCELLATION_INVALID"});
 }finally{await f.pool.query("DROP TRIGGER aa_test_delay_cancellation_boundary ON ls_practice.practice_occurrences; DROP FUNCTION ls_practice.test_delay_cancellation_boundary()");}
},30000);

test("a different cancellation constraint failure is not swallowed and publication rolls back",async()=>{
 const h=await setup(),draft=await h.publish(),occurrence=await h.practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn:h.occursOn,period:"morning"},randomUUID()),revised=await h.practice.revise(f.practitioner.actor,{assignmentId:draft.assignmentId,instructions:"DEMO — Failed publication stays draft",startsOn:h.startsOn,endsOn:h.endsOn},randomUUID());
 await f.pool.query("CREATE FUNCTION ls_practice.test_other_cancellation_denial() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN IF NEW.state='cancelled' THEN RAISE EXCEPTION 'DEMO_OTHER_CONSTRAINT_DENIAL' USING ERRCODE='23514'; END IF; RETURN NEW; END $fn$");
 await f.pool.query("CREATE TRIGGER aa_test_other_cancellation_denial BEFORE UPDATE ON ls_practice.practice_occurrences FOR EACH ROW EXECUTE FUNCTION ls_practice.test_other_cancellation_denial()");
 try{
  await expect(h.practice.publish(f.practitioner.actor,draft.assignmentId,revised.versionId,randomUUID())).rejects.toMatchObject({cause:{code:"23514",message:"DEMO_OTHER_CONSTRAINT_DENIAL"}});
  expect((await f.pool.query("SELECT active_version_id FROM ls_practice.practice_assignments WHERE id=$1",[draft.assignmentId])).rows[0].active_version_id).toBe(draft.versionId);
  expect((await f.pool.query("SELECT state FROM ls_practice.practice_assignment_versions WHERE id=$1",[revised.versionId])).rows[0].state).toBe("draft");expect((await f.pool.query("SELECT state FROM ls_practice.practice_occurrences WHERE id=$1",[occurrence.id])).rows[0].state).toBe("open");
 }finally{await f.pool.query("DROP TRIGGER aa_test_other_cancellation_denial ON ls_practice.practice_occurrences; DROP FUNCTION ls_practice.test_other_cancellation_denial()");}
},30000);

test("coordination preserves an eligible support reminder without granting its parent reporting permission",async()=>{
 const h=await setup(),draft=await h.publish({...h.input,participant:"parent",assigneeAccountIds:[f.parent.actor.id],assistedByParentAccountIds:[],reminderRecipients:[{accountId:f.parentTwo.actor.id,purpose:"support"}]},"DEMO — Parent support routing");
 const input={assignmentId:draft.assignmentId,assigneeAccountIds:[f.parent.actor.id],completionMode:"any_assignee" as const,reminderCandidateAccountIds:[f.parentTwo.actor.id],effectiveFrom:f.at(1)};
 const saved=await h.practice.coordinate(f.parent.actor,input,randomUUID());
 const page=await h.practice.coordination(f.parent.actor,draft.assignmentId);expect(page.versions.find(row=>row.versionId===saved.versionId)).toMatchObject({assigneeAccountIds:[f.parent.actor.id],reminderCandidateAccountIds:[f.parentTwo.actor.id]});
 const occurrence=await h.practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn:h.occursOn,period:"morning"},randomUUID());
 await expect(h.checkins.submit(f.parentTwo.actor,{occurrenceId:occurrence.id,status:"done",idempotencyKey:randomUUID()},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await h.practice.management(f.practitioner.actor,f.first.id,f.first.audienceId)).items[0]?.responsibility?.reminderRecipients).toEqual([{accountId:f.parentTwo.actor.id,purpose:"support"}]);
 await expect(h.practice.coordinate(f.parent.actor,{...input,reminderCandidateAccountIds:[f.outsider.actor.id]},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 await f.pool.query("UPDATE ls_cases.case_guardians SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3",[f.workspaceId,f.first.id,f.parentTwo.actor.id]);
 await expect(h.practice.coordinate(f.parent.actor,input,randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
},30000);

test("strict ownership, subject/routing fences, date and DST gaps fail closed without native writes",async()=>{
 const {practice,input,startsOn,endsOn,publish}=await setup();
 await expect(practice.participants(f.parent.actor,f.first.id,f.first.audienceId)).rejects.toMatchObject({code:"NOT_FOUND"});
 const fields={caseId:f.first.id,audienceId:f.first.audienceId,templateKey:"W01",templateVersion:"synthetic",instructions:"Synthetic",startsOn,endsOn};
 await expect(practice.createDraft(f.practitioner.actor,{...fields,responsibility:{...input,assistedByParentAccountIds:[f.outsider.actor.id]}},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(practice.createDraft(f.practitioner.actor,{...fields,endsOn:null,responsibility:input},randomUUID())).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expect(practice.createDraft(f.parent.actor,{...fields,responsibility:input},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 const draft=await publish();await expect(practice.schedule(f.practitioner.actor,{assignmentId:draft.assignmentId,occursOn:startsOn,period:"evening"},randomUUID())).rejects.toMatchObject({code:"INVALID_REQUEST"});
 const gap=await practice.createDraft(f.practitioner.actor,{...fields,startsOn:"2027-03-01",endsOn:"2027-03-31",responsibility:{...input,timezone:"America/New_York",localTime:"02:30"}},randomUUID());await practice.publish(f.practitioner.actor,gap.assignmentId,gap.versionId,randomUUID());
 await expect(practice.schedule(f.practitioner.actor,{assignmentId:gap.assignmentId,occursOn:"2027-03-14",period:"morning"},randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
 expect((await f.pool.query("SELECT count(*)::int AS count FROM ls_practice.practice_occurrences WHERE workspace_id=$1",[f.workspaceId])).rows[0].count).toBe(0);
},30000);
test("actual new catalog/functions/ACL/FKs reject drift; raw SQL cannot substitute actors, sources or attribution",async()=>{
 const {practice,publish,occursOn}=await setup(),a=await publish(),b=await publish(undefined,"Synthetic other source");
 const occurrence=await practice.schedule(f.practitioner.actor,{assignmentId:a.assignmentId,occursOn,period:"morning"},randomUUID());
 const manifest=JSON.parse(readFileSync(new URL("../../../migrations/manifest.json",import.meta.url),"utf8"))as {name:string;sha256:string}[];
 const files:Migration[]=manifest.map(entry=>({name:entry.name,checksum:entry.sha256,sql:readFileSync(new URL("../../../migrations/"+entry.name,import.meta.url),"utf8")}));
 const client=await f.pool.connect(),tx:SqlSession={query:async <R extends object>(sql:string,values:readonly unknown[]=[]) => (await client.query<R>(sql,[...values])).rows};
 try{
  const proof=await practiceResponsibilityIntegrity(tx,files);
  expect(proof.current).toEqual({metadataAbsent:false,schemaCatalog:true,foreignKeys:true,permissions:true,reviewedFunctions:true,immutableHistory:true,referencesSound:true});
  expect(proof.prior).toEqual({baselineFunctions:false,reviewedFunctions:false,immutableHistory:true,schemaCatalog:false,foreignKeys:false,permissions:false,referencesSound:false});
  for(const [sql,key]of [
   ["ALTER FUNCTION ls_practice.check_responsibility_occurrence() SECURITY DEFINER","reviewedFunctions"],
   ["ALTER TABLE ls_practice.practice_occurrences DISABLE TRIGGER check_responsibility_occurrence","schemaCatalog"],
   ["GRANT SELECT ON ls_practice.completion_reports TO PUBLIC","permissions"],
   ["ALTER TABLE ls_practice.completion_reports DROP CONSTRAINT completion_subject_fk","foreignKeys"],
  ]as const){await client.query("BEGIN");try{await client.query(sql);expect((await practiceResponsibilityIntegrity(tx,files)).current[key]).toBe(false);}finally{await client.query("ROLLBACK");}}
  await expect(f.pool.query("UPDATE ls_practice.practice_occurrences SET practice_version_id=$2 WHERE id=$1",[occurrence.id,b.versionId])).rejects.toMatchObject({code:"23514",message:"LS_PRACTICE_OCCURRENCE_FROZEN"});
  await expect(f.pool.query(`INSERT INTO ls_practice.completion_reports(id,workspace_id,occurrence_id,author_account_id,status,revision,reported_at,idempotency_key,subject_person_id,authorship,note_ciphertext)
   VALUES($1,$2,$3,$4,'done',1,now(),$5,$6,'parent_assisted_child','synthetic-invalid-envelope')`,[randomUUID(),f.workspaceId,occurrence.id,f.parentTwo.actor.id,randomUUID(),f.parent.actor.personId])).rejects.toMatchObject({code:"23514",message:"LS_PRACTICE_COMPLETION_ATTRIBUTION_INVALID"});
  const person=(await f.pool.query("SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.id=$1",[f.first.id])).rows[0].person_id;
  await expect(f.pool.query(`INSERT INTO ls_practice.completion_reports(id,workspace_id,occurrence_id,author_account_id,status,revision,reported_at,idempotency_key,subject_person_id,authorship,note_ciphertext)
   VALUES($1,$2,$3,$4,'done',1,now(),$5,$6,'parent_assisted_child','synthetic-invalid-envelope')`,[randomUUID(),f.workspaceId,occurrence.id,f.parentTwo.actor.id,randomUUID(),person])).rejects.toMatchObject({code:"23514",message:"LS_PRACTICE_COMPLETION_AUTHOR_INVALID"});
  expect(await practiceResponsibilityIntegrity(tx,files)).toEqual(proof);
 }finally{client.release();}
},30000);
