import {randomUUID} from "node:crypto";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {IdentityAuthService} from "../../../src/features/identity/auth-service.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import {NativeFishingProgram} from "../../../src/features/fishing/native-program.ts";
import {NativeFishingStageStore} from "../../../src/features/fishing-stage/native-store.ts";
import {FishingStageService} from "../../../src/features/fishing-stage/service.ts";
import {programFixture,type ProgramFixture} from "./native-program-fixture.ts";
const fixtures:ProgramFixture[]=[];
afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
async function fixture(options:Parameters<typeof programFixture>[0]={}){const f=await programFixture(options);fixtures.push(f);return f;}
const syntheticFullPayment={kind:"all_native_dues_paid" as const};

test("real password actor populates native cohort/venue; exact replay and conflict preserve source approvals and twelve undated headers",async()=>{
 const f=await fixture(),first=await f.createPlan();expect(first.occurrences).toHaveLength(12);expect(first.occurrences.every(o=>o.time.kind==="undated")).toBe(true);
 expect(await f.program.createCohort(f.owner,f.cohortCommand)).toMatchObject({id:f.ref.stageId,revision:1,replayed:true});await expect(f.program.createCohort(f.owner,{...f.cohortCommand,label:"changed"})).rejects.toMatchObject({code:"CONFLICT"});
 expect((await f.stage().read(f.owner,f.ref))!.occurrences.map(o=>o.id)).toEqual(first.occurrences.map(o=>o.id));
 const rows=(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_fishing_stage.source_approvals WHERE workspace_id=$1) AS sources,(SELECT count(*)::integer FROM ls_fishing_stage.occurrences WHERE workspace_id=$1) AS occurrences,(SELECT count(*)::integer FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND active) AS bookings",[f.workspaceId])).rows[0];expect(rows).toEqual({sources:3,occurrences:12,bookings:0});
 await expect(f.pool.query("UPDATE ls_fishing_stage.source_approvals SET version='rewritten' WHERE workspace_id=$1",[f.workspaceId])).rejects.toThrow("IMMUTABLE_PROGRAM_HISTORY");
});
test("current role and genuine parent/hash/household authority cannot be supplied by another account or request field",async()=>{
 const f=await fixture(),a=await f.family(),b=await f.family();
 await expect(f.program.createCohort({...a.parent,role:"practitioner"},{...f.cohortCommand,commandId:randomUUID(),stageId:randomUUID(),cohortId:randomUUID()})).rejects.toMatchObject({code:"FORBIDDEN"});
 const request={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,learnerId:a.learnerId,householdId:a.householdId,sourceApprovalId:f.termsId,sourceSha256:f.termsHash};
 await expect(f.program.acceptTerms(b.parent,request)).rejects.toMatchObject({code:"FORBIDDEN"});await expect(f.program.acceptTerms(f.owner,request)).rejects.toMatchObject({code:"FORBIDDEN"});await expect(f.program.acceptTerms(a.parent,{...request,sourceSha256:"0".repeat(64)})).rejects.toMatchObject({code:"CONFLICT"});
 expect(()=>f.program.acceptTerms(a.parent,{...request,acceptedBy:a.parent.id})).toThrow();
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});
test("a withdrawn approved-catalog version fails closed instead of turning template metadata into learner access",async()=>{
 const f=await fixture();await f.createPlan();await f.pool.query("UPDATE ls_education.catalog_versions SET approval_state='withdrawn' WHERE workspace_id=$1 AND module_id='RM-101'",[f.workspaceId]);await expect(f.stage().read(f.owner,f.ref)).rejects.toThrow();
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_education.account_grants WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});
test("unselected real-world payment condition cannot confirm enrollment even after synthetic native cash allocation",async()=>{
 const f=await fixture();await f.createPlan();const a=await f.family(),p=await f.prepare(a);await f.settle(p);await expect(f.enroll(p)).rejects.toMatchObject({code:"POLICY_REQUIRED"});
 const counts=(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_fishing_stage.enrollments WHERE workspace_id=$1) AS enrolled,(SELECT count(*)::integer FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1 AND origin='offer_hold' AND state='reserved') AS holds",[f.workspaceId])).rows[0];expect(counts).toEqual({enrolled:0,holds:12});
});
test("a forged paid aggregate without native settlement/processed receipt/operation evidence cannot enroll",async()=>{
 const f=await fixture({confirmation:syntheticFullPayment});await f.createPlan();const a=await f.family(),p=await f.prepare(a),old=(await f.paymentStore.readPayment(f.owner,p.purchaseId))!;
 const fake={...old,revision:old.revision+1,paidCents:old.originalTotalCents,state:"paid",dues:old.dues.map(d=>({...d,paidCents:d.amountCents,state:"paid"}))};await f.pool.query("UPDATE ls_fishing_payments.purchases SET revision=$3,state_json=$4::jsonb WHERE workspace_id=$1 AND id=$2",[f.workspaceId,p.purchaseId,fake.revision,JSON.stringify(fake)]);
 await expect(f.enroll(p)).rejects.toMatchObject({code:"UNAVAILABLE"});expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.enrollments WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});
test("missing or different server merchant/mode/API pin cannot turn test cash into another runtime's enrollment",async()=>{
 const f=await fixture({confirmation:syntheticFullPayment});await f.createPlan();const a=await f.family(),p=await f.prepare(a);await f.settle(p);const state=(await f.paymentStore.readPayment(f.owner,p.purchaseId))!;
 for(const merchant of [null,{...f.merchant,accountId:"acct_different"},{...f.merchant,livemode:true},{...f.merchant,apiVersion:"different-version"}]){
  const program=new NativeFishingProgram(f.db,f.ring,{childAccountsEnabled:false,merchant});await expect(program.confirmEnrollment(f.owner,{commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,purchaseId:p.purchaseId,fitDecisionId:p.fit.id,termsAcceptanceId:p.acceptance.id,policyApprovalId:f.policyId,expectedPaymentRevision:state.revision})).rejects.toThrow();
 }
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.enrollments WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});
test("explicit operator confirmation after synthetic receipt pipeline yields own-family twelve-session view without a child account/case/grant",async()=>{
 const f=await fixture({confirmation:syntheticFullPayment});await f.createPlan();await f.publish();const a=await f.family(),p=await f.prepare(a);await f.settle(p);
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.enrollments WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
 const enrolled=await f.enroll(p);expect(await f.program.confirmEnrollment(f.owner,enrolled.command)).toMatchObject({id:enrolled.result.id,replayed:true});const view=await f.stage(a.parent,enrolled.result.id).read(a.parent,f.ref);expect(view?.occurrences).toHaveLength(12);expect(view?.enrollmentId).toBe(enrolled.result.id);
 expect(JSON.stringify(view)).not.toMatch(/PRIVATE_SYNTHETIC|SYNTHETIC_VENUE_NOT_REAL_PERMISSION|paidCents|password|ciphertext/);
 const fresh=new NativeFishingProgram(f.db,f.ring,{childAccountsEnabled:false,merchant:f.merchant}),service=new FishingStageService(new NativeFishingStageStore(f.db,f.ring,{actor:a.parent,selection:{selectedEnrollmentId:enrolled.result.id}},fresh.stageHooks(null)),systemClock);expect(await service.read(a.parent,f.ref)).toEqual(view);
 const counts=(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_identity.accounts WHERE workspace_id=$1 AND role='child') AS children,(SELECT count(*)::integer FROM ls_cases.cases WHERE workspace_id=$1) AS cases,(SELECT count(*)::integer FROM ls_education.account_grants WHERE workspace_id=$1) AS grants,(SELECT count(*)::integer FROM ls_calendar.appointments WHERE workspace_id=$1) AS clinical",[f.workspaceId])).rows[0];expect(counts).toEqual({children:0,cases:0,grants:0,clinical:0});
});
test("an explicitly synthetic first-due policy shows all twelve sessions with exactly three650 dues, not four lessons",async()=>{
 const f=await fixture({confirmation:{kind:"native_due_indices_paid",indices:[1]}});await f.createPlan();await f.publish();const a=await f.family(),p=await f.prepare(a,"installments");await f.settle(p,1);const enrollment=await f.enroll(p),state=(await f.paymentStore.readPayment(f.owner,p.purchaseId))!;
 expect(state.dues).toHaveLength(3);expect(state.dues.map(d=>d.amountCents)).toEqual([65000,65000,65000]);expect(state.paidCents).toBe(65000);expect((await f.stage(a.parent,enrollment.result.id).read(a.parent,f.ref))?.occurrences).toHaveLength(12);
});
test("two populated families, current guardian revocation and ordinary logout are rechecked on native reads",async()=>{
 const f=await fixture({confirmation:syntheticFullPayment});await f.createPlan();await f.publish();const a=await f.family(),b=await f.family(),pa=await f.prepare(a),pb=await f.prepare(b);await f.settle(pa);await f.settle(pb);const ea=await f.enroll(pa),eb=await f.enroll(pb);
 expect(await f.program.readEnrollment(a.parent,eb.result.id)).toBeNull();expect(await f.stage(a.parent,eb.result.id).read(a.parent,f.ref)).toBeNull();expect((await f.program.readEnrollment(b.parent,eb.result.id))?.learnerId).toBe(b.learnerId);
 await f.pool.query("UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND account_id=$2",[f.workspaceId,a.parent.id]);expect(await f.program.readEnrollment(a.parent,ea.result.id)).toBeNull();expect((await f.program.readEnrollment(b.parent,eb.result.id))?.id).toBe(eb.result.id);
 await new IdentityAuthService(f.db,f.config,systemClock).logout(b.parent,randomUUID());await expect(f.program.readEnrollment(b.parent,eb.result.id)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
test("optional child access needs its own actual account plus independently enabled configuration; no role switch",async()=>{
 const f=await fixture({confirmation:syntheticFullPayment,childAccountsEnabled:true});await f.createPlan();await f.publish();const a=await f.family(),p=await f.prepare(a);await f.settle(p);const enrollment=await f.enroll(p),child=await f.account("child",a.learnerId);
 expect((await f.stage(child,enrollment.result.id).read(child,f.ref))?.role).toBe("child");const disabled=new NativeFishingProgram(f.db,f.ring,{childAccountsEnabled:false,merchant:f.merchant});expect(await disabled.readEnrollment(child,enrollment.result.id)).toBeNull();
 const parentView=await f.stage(a.parent,enrollment.result.id).read(a.parent,f.ref);expect(parentView?.role).toBe("parent");expect(JSON.stringify(await f.stage(child,enrollment.result.id).read(child,f.ref))).not.toMatch(/paidCents|PRIVATE_SYNTHETIC|terms_acceptance|parentIds/);
});
test("two independent native transactions compete for the same shared last seat and roll back the loser",async()=>{
 const f=await fixture({capacity:1});await f.createPlan();const a=await f.family(),b=await f.family(),command=(who:typeof a)=>({commandId:randomUUID(),holdId:randomUUID(),stageId:f.ref.stageId,learnerId:who.learnerId,householdId:who.householdId,payerAccountId:who.parent.id,expectedCohortRevision:1,reason:"Synthetic last seat"});
 const results=await Promise.allSettled([f.program.reserveOfferHold(f.owner,command(a)),f.program.reserveOfferHold(f.owner,command(b))]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
 const counts=(await f.pool.query("SELECT count(*)::integer AS n,count(DISTINCT learner_id)::integer AS learners FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1 AND state<>'released'",[f.workspaceId])).rows[0];expect(counts).toEqual({n:12,learners:1});
 await expect(f.pool.query("INSERT INTO ls_fishing_stage.seat_reservations SELECT workspace_id,$2,hold_id,stage_id,occurrence_id,learner_id,origin,offer_id,enrollment_id,entitlement_id,state,revision,hold_revision,actor_id,command_id,stage_operation_id FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1 LIMIT 1",[f.workspaceId,randomUUID()])).rejects.toMatchObject({code:"23505"});
});
test("explicit revocation is CAS/history-preserving and never releases obligations or rewrites confirmation evidence",async()=>{
 const f=await fixture({confirmation:syntheticFullPayment});await f.createPlan();const a=await f.family(),p=await f.prepare(a);await f.settle(p);const enrolled=await f.enroll(p),command={commandId:randomUUID(),id:enrolled.result.id,expectedRevision:1,state:"revoked",reason:"Synthetic explicit revocation"};await f.program.setEnrollmentState(f.owner,command);
 await expect(f.program.setEnrollmentState(f.owner,{...command,commandId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});expect(await f.program.readEnrollment(a.parent,enrolled.result.id)).toBeNull();expect((await f.program.readEnrollment(f.owner,enrolled.result.id))?.evidence.ownerActionId).toBe(enrolled.command.commandId);
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1 AND state='confirmed'",[f.workspaceId])).rows[0].n).toBe(12);
 await expect(f.pool.query("DELETE FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND command_id=$2",[f.workspaceId,enrolled.command.commandId])).rejects.toThrow("IMMUTABLE_PROGRAM_HISTORY");
});
test("missing/stale real stage revision data cannot be replaced by a permissive hold reader",async()=>{
 const f=await fixture();await f.createPlan();const a=await f.family();
 // Deliberately corrupt only this disposable fixture; assert that the mutation
 // really reached one header rather than swallowing a protected-FK failure.
 const changed=await f.pool.query("DELETE FROM ls_fishing_stage.occurrences WHERE workspace_id=$1 AND stage_id=$2 AND ordinal=12 RETURNING id",[f.workspaceId,f.ref.stageId]);expect(changed.rowCount).toBe(1);
 await expect(f.program.reserveOfferHold(f.owner,{commandId:randomUUID(),holdId:randomUUID(),stageId:f.ref.stageId,learnerId:a.learnerId,householdId:a.householdId,payerAccountId:a.parent.id,expectedCohortRevision:1,reason:"Must not reserve corrupt plan"})).rejects.toThrow();expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});
test("two source cohorts race for one actual makeup seat, preserving one entitlement and the losing protected obligation",async()=>{
 const f=await fixture({capacity:1,confirmation:syntheticFullPayment}),other={cohortId:randomUUID(),stageId:randomUUID(),stage:1 as const},targetRef={cohortId:randomUUID(),stageId:randomUUID(),stage:1 as const};
 await f.createPlan();for(const ref of [other,targetRef]){await f.program.createCohort(f.owner,{...f.cohortCommand,...ref,commandId:randomUUID(),label:"Synthetic separate cohort"});await f.stage().execute(f.owner,ref,{action:"create",operationId:randomUUID(),expectedRevision:0,templateVersion:f.template.version,childCapacity:1});}
 async function schedule(ref:typeof f.ref,hours:number){const current=(await f.stage().read(f.owner,ref))!,o=current.occurrences[0]!,operationId=randomUUID();await f.stage(f.owner,null,{operationId,resources:[{occurrenceId:o.id,expectedRevision:o.revision,venueId:f.venueCommand.id}],makeupFitDecisionId:null}).execute(f.owner,ref,{action:"revise",operationId,expectedRevision:current.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,details:{time:{kind:"scheduled",timeZone:"America/New_York",startsAt:f.at(hours),endsAt:f.at(hours+1)},location:f.venueCommand.label,directions:"",equipment:"",logisticalNote:"Synthetic",childCapacity:1},reason:"Synthetic trip"});const draft=(await f.stage().read(f.owner,ref))!,publish=randomUUID();await f.stage(f.owner,null,{operationId:publish,resources:[],makeupFitDecisionId:null}).execute(f.owner,ref,{action:"publish",operationId:publish,expectedRevision:draft.revision});}
 await schedule(f.ref,48);await schedule(other,72);await schedule(targetRef,96);const target=(await f.stage().read(f.owner,targetRef))!.occurrences[0]!;
 const a=await f.family(),b=await f.family(),pa=await f.prepare(a),pb=await f.prepare(b,"prepay",other.stageId);await f.settle(pa);await f.settle(pb);const ea=await f.enroll(pa),eb=await f.enroll(pb);
 async function request(parent:typeof a.parent,enrollmentId:string,ref:typeof f.ref,learnerId:string){const view=(await f.stage(parent,enrollmentId).read(parent,ref))!,o=view.occurrences[0]!;await f.stage(parent,enrollmentId).execute(parent,ref,{action:"notice",operationId:randomUUID(),expectedRevision:view.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"ordinary_absence"});const notice=(await f.stage(parent,enrollmentId).read(parent,ref))!.notices[0]!;
  const fit={commandId:randomUUID(),id:randomUUID(),stageId:ref.stageId,learnerId,purpose:"makeup",decision:"approved",targetOccurrenceId:target.id,targetRevision:target.revision,note:"Synthetic actual target review"};await f.program.recordFit(f.owner,fit);const owner=(await f.stage().read(f.owner,ref))!,operationId=randomUUID();return {ref,command:{action:"confirm_makeup",operationId,expectedRevision:owner.revision,noticeId:notice.id,replacementOccurrenceId:target.id,expectedReplacementRevision:target.revision,reason:"Explicit synthetic operator confirmation"},intent:{operationId,resources:[],makeupFitDecisionId:fit.id}};
 }
 const ra=await request(a.parent,ea.result.id,f.ref,a.learnerId),rb=await request(b.parent,eb.result.id,other,b.learnerId),results=await Promise.allSettled([f.stage(f.owner,null,ra.intent).execute(f.owner,ra.ref,ra.command),f.stage(f.owner,null,rb.intent).execute(f.owner,rb.ref,rb.command)]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);const rejected=results.find(r=>r.status==="rejected");expect(rejected?.status==="rejected"?rejected.reason.code:null).toBe("CAPACITY");
 const seats=(await f.pool.query("SELECT count(*)::integer AS n,count(DISTINCT entitlement_id)::integer AS credits FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1 AND occurrence_id=$2 AND origin='makeup'",[f.workspaceId,target.id])).rows[0];expect(seats).toEqual({n:1,credits:1});
 const notices=[...(await f.stage(a.parent,ea.result.id).read(a.parent,f.ref))!.notices,...(await f.stage(b.parent,eb.result.id).read(b.parent,other))!.notices];expect(notices.filter(n=>n.replacementOccurrenceId!==null)).toHaveLength(1);expect(notices.every(n=>n.specificTripGuaranteed===false)).toBe(true);
});
