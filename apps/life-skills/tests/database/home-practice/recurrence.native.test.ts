/** Native retained adapter/service/HTTP proof. Fixture sessions are NOT password-login evidence. */
import {afterEach,expect,test} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {HomePracticeService} from "../../../src/features/home-practice/service.ts";
import {CheckInService} from "../../../src/features/checkins/service.ts";
import {GoalService} from "../../../src/features/goals/service.ts";
import {CommitmentService} from "../../../src/features/commitments/service.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {PostgresIdentityRateStore} from "../../../src/features/identity/rate-store.ts";
import {durableAuditSink} from "../../../src/features/identity/history.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import type {ResponsibilityInput} from "../../../src/features/home-practice/responsibility-input.ts";
import {Ls040Http} from "../../../src/features/home-practice/http.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {shiftOccurrenceDay} from "../../../src/features/home-practice/occurrence-range.ts";
const opened:Fixture[]=[];
afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.pool.end()));});
async function setup(){
 const f=await fixture();opened.push(f);const store=poolStore(f.pool),config:IdentityConfig={enabled:true,origin:"https://synthetic.example.invalid",workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600};
 const practice=new HomePracticeService(store,config,systemClock),checkins=new CheckInService(store,systemClock,f.keyring),sessions=new IdentitySessions(store,config,systemClock);
 const http=new Ls040Http(config,systemClock,{practice,checkins,sessions,goals:new GoalService(store,config,systemClock),commitments:new CommitmentService(store,config,systemClock),limits:new PostgresIdentityRateStore(store),audit:durableAuditSink(store)});
 const responsibility:ResponsibilityInput={participant:"client",period:"morning",assigneeAccountIds:[],assistedByParentAccountIds:[f.parent.actor.id],reminderRecipients:[],completionMode:"any_assignee",weekdays:[0,1,2,3,4,5,6],localTime:"18:45",timezone:"UTC",timeOrigin:"practitioner",foldChoice:null};
 const from=f.at(24).slice(0,10),to=shiftOccurrenceDay(from,3),endsOn=shiftOccurrenceDay(from,30);
 async function publish(r=responsibility,starts=from,end=endsOn){const saved=await practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,templateKey:"Synthetic recurring",templateVersion:"synthetic-v1",instructions:"Synthetic recurring instructions",startsOn:starts,endsOn:end,responsibility:r},randomUUID());await practice.publish(f.practitioner.actor,saved.assignmentId,saved.versionId,randomUUID());const row=(await practice.management(f.practitioner.actor,f.first.id,f.first.audienceId)).items.find(v=>v.versionId===saved.versionId)!;return {saved,input:{assignmentId:saved.assignmentId,expectedVersionId:saved.versionId,expectedSnapshotDigest:row.immutableSnapshotDigest!,from:starts,to:startRangeEnd(starts,end)}};}
 function startRangeEnd(starts:string,end:string){return shiftOccurrenceDay(starts,3)<end?shiftOccurrenceDay(starts,3):end;}
 const counts=async()=>(await f.pool.query(`SELECT (SELECT count(*)::int FROM ls_practice.practice_occurrences WHERE workspace_id=$1) AS occurrences,(SELECT count(*)::int FROM ls_practice.action_history WHERE workspace_id=$1 AND action='practice_occurrence_scheduled') AS audits`,[f.workspaceId])).rows[0];
 function request(method:"GET"|"POST",path:string,body?:unknown,token:string|null=f.practitioner.token,extra:Record<string,string>={}){const headers=new Headers({"x-forwarded-host":"synthetic.example.invalid","x-forwarded-proto":"https"});if(token)headers.set("Cookie",`${SESSION_COOKIE}=${token}`);if(method==="POST"){headers.set("Origin",config.origin);headers.set("Content-Type","application/json");if(token)headers.set("X-CSRF-Token",sessions.csrf(token));}for(const[k,v]of Object.entries(extra))headers.set(k,v);return http.handle(new Request("http://127.0.0.1:8080"+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));}
 return {f,practice,checkins,publish,responsibility,from,to,endsOn,counts,request};
}
test("readonly exact range, atomic frozen entries and concurrent replay without duplicate events",async()=>{
 const h=await setup(),{f,practice}=h,{input}=await h.publish(),before=await h.counts(),plan=await practice.recurrence(f.practitioner.actor,input);
 expect(plan.items).toHaveLength(4);expect(plan.items.every(row=>!row.existing&&row.occursAt===row.occursOn+"T18:45:00.000Z")).toBe(true);expect(await h.counts()).toEqual(before);
 const command={...input,expectedPlanDigest:plan.planDigest},results=await Promise.all([practice.scheduleRange(f.practitioner.actor,command,randomUUID()),practice.scheduleRange(f.practitioner.actor,command,randomUUID())]);expect(results[0]).toEqual(results[1]);expect(results[0]!.items.every(row=>row.existing)).toBe(true);expect(await h.counts()).toEqual({occurrences:4,audits:before.audits+1});
 expect(await practice.recurrence(f.practitioner.actor,input)).toEqual(results[0]);
 const read=await practice.occurrences(f.parent.actor,f.first.id,f.first.audienceId,input.from,shiftOccurrenceDay(input.to,1));expect(read.items.map(row=>row.occurrence.id)).toEqual(plan.items.map(row=>row.id));expect(read.items.every(row=>row.canReport&&row.schedule?.localTime==="18:45"&&row.schedule.caseKind==="minor")).toBe(true);
 await h.checkins.submit(f.parent.actor,{occurrenceId:read.items[0]!.occurrence.id,status:"done",idempotencyKey:randomUUID(),assistance:{mode:"together",note:"Synthetic retained report"}},randomUUID());const report=await h.checkins.list(f.parent.actor,read.items[0]!.occurrence.id,true);expect((await practice.scheduleRange(f.practitioner.actor,command,randomUUID())).items[0]!.state).toBe("closed");expect(await h.checkins.list(f.parent.actor,read.items[0]!.occurrence.id,true)).toEqual(report);expect(await h.counts()).toEqual({occurrences:4,audits:before.audits+1});
},30000);
test("published weekdays and per-date timezone are used; partial or stale plan never writes",async()=>{
 const h=await setup(),{f,practice}=h,{input}=await h.publish({...h.responsibility,weekdays:[new Date(h.from+"T12:00:00Z").getUTCDay()],timezone:"Asia/Jerusalem"}),plan=await practice.recurrence(f.practitioner.actor,input),before=await h.counts();expect(plan.items).toHaveLength(1);expect(plan.items[0]!.occursOn).toBe(input.from);expect(plan.items[0]!.occursAt).not.toBe(input.from+"T18:45:00.000Z");
 await expect(practice.scheduleRange(f.practitioner.actor,{...input,expectedPlanDigest:"0".repeat(64)},randomUUID())).rejects.toMatchObject({code:"CONFLICT"});await expect(practice.recurrence(f.practitioner.actor,{...input,to:shiftOccurrenceDay(h.from,42)})).rejects.toMatchObject({code:"INVALID_REQUEST"});expect(await h.counts()).toEqual(before);
},30000);
test("a genuine native insert failure rolls back the whole batch and its audit",async()=>{
 const h=await setup(),{f,practice}=h,{input}=await h.publish(),plan=await practice.recurrence(f.practitioner.actor,input),before=await h.counts(),name="synthetic_range_failure_"+randomUUID().replaceAll("-","");
 // This additional fail-only constraint is scoped to this disposable workspace.
 // Retained privacy/immutability constraints and triggers remain enabled.
 expect(f.workspaceId).toMatch(/^[a-f0-9-]{36}$/);expect(plan.items[1]!.occursOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
 await f.pool.query(`ALTER TABLE ls_practice.practice_occurrences ADD CONSTRAINT ${name} CHECK (NOT (workspace_id='${f.workspaceId}'::uuid AND occurs_on='${plan.items[1]!.occursOn}'::date))`);
 try{await expect(practice.scheduleRange(f.practitioner.actor,{...input,expectedPlanDigest:plan.planDigest},randomUUID())).rejects.toThrow();expect(await h.counts()).toEqual(before);}
 finally{await f.pool.query(`ALTER TABLE ls_practice.practice_occurrences DROP CONSTRAINT ${name}`);}
 const recovered=await practice.scheduleRange(f.practitioner.actor,{...input,expectedPlanDigest:plan.planDigest},randomUUID());expect(recovered.items.every(row=>row.existing)).toBe(true);expect(await h.counts()).toEqual({occurrences:4,audits:before.audits+1});
},30000);
test("coordination changes require a new preview before writing but preserve exact frozen range readback and replay after commit",async()=>{
 const h=await setup(),{f,practice}=h,{input,saved}=await h.publish({...h.responsibility,participant:"parent",assigneeAccountIds:[f.parent.actor.id,f.parentTwo.actor.id],assistedByParentAccountIds:[],completionMode:"each_assignee"}),plan=await practice.recurrence(f.practitioner.actor,input),before=await h.counts();
 const changed=await practice.coordinate(f.parent.actor,{assignmentId:saved.assignmentId,assigneeAccountIds:[f.parent.actor.id],completionMode:"any_assignee",reminderCandidateAccountIds:[],effectiveFrom:f.at(1)},randomUUID());
 await expect(practice.scheduleRange(f.practitioner.actor,{...input,expectedPlanDigest:plan.planDigest},randomUUID())).rejects.toMatchObject({code:"CONFLICT"});expect((await h.counts()).occurrences).toBe(before.occurrences);
 const fresh=await practice.recurrence(f.practitioner.actor,input);expect(fresh.planDigest).not.toBe(plan.planDigest);expect(fresh.items.every(row=>row.coordinationVersionId===changed.versionId)).toBe(true);await practice.scheduleRange(f.practitioner.actor,{...input,expectedPlanDigest:fresh.planDigest},randomUUID());
 await h.checkins.submit(f.parent.actor,{occurrenceId:fresh.items[0]!.id as Parameters<typeof h.checkins.submit>[1]["occurrenceId"],status:"done",idempotencyKey:randomUUID()},randomUUID());
 const frozen=(await f.pool.query('SELECT * FROM ls_practice.practice_occurrences WHERE workspace_id=$1 ORDER BY id',[f.workspaceId])).rows;
 await practice.coordinate(f.parent.actor,{assignmentId:saved.assignmentId,assigneeAccountIds:[f.parent.actor.id,f.parentTwo.actor.id],completionMode:"each_assignee",reminderCandidateAccountIds:[],effectiveFrom:f.at(2)},randomUUID());
 const read=await practice.recurrence(f.practitioner.actor,input);expect(read.planDigest).toBe(fresh.planDigest);expect(read.items.every(row=>row.existing&&row.coordinationVersionId===changed.versionId)).toBe(true);
 const replay=await practice.scheduleRange(f.practitioner.actor,{...input,expectedPlanDigest:fresh.planDigest},randomUUID());expect(replay).toEqual(read);expect((await f.pool.query('SELECT * FROM ls_practice.practice_occurrences WHERE workspace_id=$1 ORDER BY id',[f.workspaceId])).rows).toEqual(frozen);
 expect((await h.checkins.list(f.parent.actor,fresh.items[0]!.id as Parameters<typeof h.checkins.list>[1],true))[0]!.status).toBe("done");expect((await h.counts()).occurrences).toBe(4);
},30000);
test("extending a range keeps frozen entries and uses current coordination only for missing dates",async()=>{
 const h=await setup(),{f,practice}=h,{input,saved}=await h.publish({...h.responsibility,participant:"parent",assigneeAccountIds:[f.parent.actor.id,f.parentTwo.actor.id],assistedByParentAccountIds:[],completionMode:"each_assignee"});
 const firstInput={...input,to:shiftOccurrenceDay(input.from,1)},first=await practice.recurrence(f.practitioner.actor,firstInput);await practice.scheduleRange(f.practitioner.actor,{...firstInput,expectedPlanDigest:first.planDigest},randomUUID());
 const frozen=(await f.pool.query('SELECT * FROM ls_practice.practice_occurrences WHERE workspace_id=$1 ORDER BY id',[f.workspaceId])).rows;
 const changed=await practice.coordinate(f.parent.actor,{assignmentId:saved.assignmentId,assigneeAccountIds:[f.parent.actor.id],completionMode:"any_assignee",reminderCandidateAccountIds:[],effectiveFrom:f.at(1)},randomUUID());
 const extended=await practice.recurrence(f.practitioner.actor,input);expect(extended.items).toHaveLength(4);expect(extended.items.slice(0,2).map(row=>[row.id,row.coordinationVersionId,row.existing])).toEqual(first.items.map(row=>[row.id,row.coordinationVersionId,true]));expect(extended.items.slice(2).every(row=>!row.existing&&row.coordinationVersionId===changed.versionId)).toBe(true);
 const scheduled=await practice.scheduleRange(f.practitioner.actor,{...input,expectedPlanDigest:extended.planDigest},randomUUID());expect(scheduled.items.every(row=>row.existing)).toBe(true);expect(await practice.recurrence(f.practitioner.actor,input)).toEqual(scheduled);
 expect((await f.pool.query('SELECT * FROM ls_practice.practice_occurrences WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[f.workspaceId,first.items.map(row=>row.id)])).rows).toEqual(frozen);expect((await h.counts()).occurrences).toBe(4);
},30000);

test.each([{from:"2027-03-13",to:"2027-03-15",localTime:"02:30"},{from:"2027-11-06",to:"2027-11-08",localTime:"01:30"}])("DST gap/fold fails the entire range before native writes: $from",async dates=>{
 const h=await setup(),{f,practice}=h,{input}=await h.publish({...h.responsibility,timezone:"America/New_York",localTime:dates.localTime},dates.from,dates.to),before=await h.counts();await expect(practice.recurrence(f.practitioner.actor,{...input,to:dates.to})).rejects.toMatchObject({code:"CONFLICT"});expect(await h.counts()).toEqual(before);
},30000);
test("real retained HTTP rejects unknown/duplicate keys, CSRF, customer scheduling and changed source",async()=>{
 const h=await setup(),{f,practice}=h,{input,saved}=await h.publish(),path="/api/home-practice?"+new URLSearchParams({view:"recurrence",...input}),read=await h.request("GET",path);expect(read.status).toBe(200);const plan=(await read.json()).data,before=await h.counts(),command={action:"schedule_range",...input,expectedPlanDigest:plan.planDigest};
 for(const bad of [path+"&view=recurrence",path+"&accountId="+f.parent.actor.id,path.replace(input.from,"2026-02-30")])expect((await h.request("GET",bad)).status).toBe(400);
 for(const actor of [f.parent,f.parentTwo,f.outsider]){expect((await h.request("GET",path,undefined,actor.token)).status).toBe(404);expect((await h.request("POST","/api/home-practice",command,actor.token)).status).toBe(404);}
 expect((await h.request("GET",path,undefined,null)).status).toBe(401);expect((await h.request("POST","/api/home-practice",command,f.practitioner.token,{"X-CSRF-Token":"invalid"})).status).toBe(403);expect((await h.request("POST","/api/home-practice",{...command,send:true})).status).toBe(400);expect(await h.counts()).toEqual(before);
 const revised=await practice.revise(f.practitioner.actor,{assignmentId:saved.assignmentId,instructions:"Synthetic next version",startsOn:h.from,endsOn:h.endsOn},randomUUID());await practice.publish(f.practitioner.actor,saved.assignmentId,revised.versionId,randomUUID());expect((await h.request("POST","/api/home-practice",command)).status).toBe(409);expect((await h.counts()).occurrences).toBe(0);
 await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);expect((await h.request("GET",path)).status).toBe(401);
},30000);
