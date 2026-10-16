/** Retained native adapters + real password/preauth/CSRF over Request/Response.
 * Synthetic sources, merchant and receipt setup are NOT provider, mounted Next,
 * invitation or production activation proof. No session/authority is injected. */
import {randomUUID} from "node:crypto";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {IdentityAuthService} from "../../../src/features/identity/auth-service.ts";
import {IdentityAccountService} from "../../../src/features/identity/account-service.ts";
import {IdentityPreferenceService} from "../../../src/features/identity/preferences.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {IdentityHttp} from "../../../src/features/identity/http.ts";
import {PostgresIdentityRateStore} from "../../../src/features/identity/rate-store.ts";
import {durableAuditSink} from "../../../src/features/identity/history.ts";
import {systemClock,type Actor} from "../../../src/features/identity/types.ts";
import {CaseService} from "../../../src/features/cases/service.ts";
import {handleFishingCalendar,type FishingCalendarDependencies} from "../../../src/features/fishing/program-calendar-http.ts";
import {fishingCalendarSearch,type FishingCalendarSelection} from "../../../src/features/fishing/program-calendar-contract.ts";
import type {StageCommand} from "../../../src/features/fishing-stage/contract.ts";
import type {NativeProgramCommandIntent} from "../../../src/features/fishing/native-program-contract.ts";
import {programFixture,type ProgramFixture} from "./native-program-fixture.ts";

const fixtures:ProgramFixture[]=[];afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
type Auth={cookie:string;csrf:string};
async function fixture(childAccountsEnabled=false){
 const f=await programFixture({childAccountsEnabled,confirmation:{kind:"all_native_dues_paid"}});fixtures.push(f);
 const config={...f.config,childAccountsEnabled},origin=config.origin;
 function runtime(){
  const sessions=new IdentitySessions(f.db,config,systemClock),limits=new PostgresIdentityRateStore(f.db),audit=durableAuditSink(f.db),clock=systemClock;
  const services={auth:new IdentityAuthService(f.db,config,clock),accounts:new IdentityAccountService(f.db,config,clock),preferences:new IdentityPreferenceService(f.db,config,clock),sessions,cases:new CaseService(f.db,config,clock),limits,audit};
  return {identity:new IdentityHttp(config,clock,services),dependencies:{runtime:{config,sessions,limits,audit,clock},store:f.db} satisfies FishingCalendarDependencies};
 }
 async function login(actor:Actor,password="Ab12cd"):Promise<Auth>{
  const identity=runtime().identity,pre=await identity.handle(new Request(origin+"/api/identity/csrf"));expect(pre.status).toBe(200);const token=(await pre.json()).data.csrfToken;
  const response=await identity.handle(new Request(origin+"/api/identity/login",{method:"POST",headers:{cookie:pre.headers.getSetCookie()[0]!.split(";")[0]!,origin,"sec-fetch-site":"same-origin","content-type":"application/json","x-csrf-token":token},body:JSON.stringify({email:`${actor.id}@example.invalid`,password})}));
  expect(response.status).toBe(200);const cookie=response.headers.getSetCookie().find(c=>c.startsWith(SESSION_COOKIE+"="));expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);return {cookie:cookie!.split(";")[0]!,csrf:(await response.json()).data.csrfToken};
 }
 const read=(auth:Auth,part="context",query="")=>handleFishingCalendar(new Request(`${origin}/api/calendar/fishing/${part}${query?"?"+query:""}`,{headers:{cookie:auth.cookie}}),[part],async()=>runtime().dependencies);
 const write=(auth:Auth,selection:FishingCalendarSelection,command:StageCommand,intent:NativeProgramCommandIntent={operationId:command.operationId,resources:[],makeupFitDecisionId:null},headers:Record<string,string>={})=>handleFishingCalendar(new Request(origin+"/api/calendar/fishing/command",{method:"POST",headers:{cookie:auth.cookie,origin,"sec-fetch-site":"same-origin","content-type":"application/json","x-csrf-token":auth.csrf,"idempotency-key":command.operationId,...headers},body:JSON.stringify({selection,command,intent})}),["command"],async()=>runtime().dependencies);
 const operatorSelection:FishingCalendarSelection={learnerId:null,enrollmentId:null,reference:f.ref};
 const effects=async()=>(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_cases.cases WHERE workspace_id=$1) AS cases,(SELECT count(*)::integer FROM ls_calendar.appointments WHERE workspace_id=$1) AS appointments,(SELECT count(*)::integer FROM ls_payments.charges WHERE workspace_id=$1) AS charges,(SELECT count(*)::integer FROM ls_payments.credit_events WHERE workspace_id=$1) AS credits,(SELECT count(*)::integer FROM ls_education.account_grants WHERE workspace_id=$1) AS grants,(SELECT count(*)::integer FROM ls_fishing_payments.outbox WHERE workspace_id=$1) AS outbound",[f.workspaceId])).rows[0];
 async function enrolled(){await f.createPlan();const family=await f.family(),purchase=await f.prepare(family);await f.settle(purchase);const enrollment=await f.enroll(purchase);return {family,purchase,enrollment,selection:{learnerId:family.learnerId,enrollmentId:enrollment.result.id,reference:f.ref} satisfies FishingCalendarSelection};}
 return {...f,config,origin,runtime,login,read,write,effects,operatorSelection,enrolled};
}

test("ordinary HTTP login discovers only native operator choices and creates/replays one actual undated plan without clinical or financial effects",async()=>{
 const f=await fixture(),auth=await f.login(f.owner),before=await f.effects(),response=await f.read(auth);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
 const choices=(await response.json()).data;expect(choices).toMatchObject({availability:"ready",role:"practitioner",children:[],selectedLearnerId:null});expect(choices.stages).toHaveLength(1);expect(choices.stages[0]).toMatchObject({...f.ref,enrollmentId:null,learnerId:null});
 const command:StageCommand={action:"create",operationId:randomUUID(),expectedRevision:0,templateVersion:f.template.version,childCapacity:2};
 expect((await f.write(auth,f.operatorSelection,command)).status).toBe(200);const replay=await f.write(auth,f.operatorSelection,command);expect(replay.status).toBe(200);expect((await replay.json()).data.replayed).toBe(true);
 const loaded=await f.read(auth,"plan",fishingCalendarSearch(f.operatorSelection)),body=await loaded.json();expect(loaded.status).toBe(200);expect(body.data.view.occurrences).toHaveLength(12);expect(body.data.view.occurrences.every((o:{time:{kind:string}})=>o.time.kind==="undated")).toBe(true);
 expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SYNTHETIC|SYNTHETIC_NOT_REAL_CANONICAL_APPROVAL|payload_ciphertext|verifiedBindingId/);expect(await f.effects()).toEqual(before);
});

test("current selected parent context is explicit and case-free; two populated same-name families cannot borrow each other's child or enrollment",async()=>{
 const f=await fixture(),a=await f.enrolled(),b=await f.family(),auth=await f.login(a.family.parent),other=await f.login(b.parent),before=await f.effects();
 const noSelection=(await (await f.read(auth)).json()).data;expect(noSelection.selectedLearnerId).toBeNull();expect(noSelection.stages).toEqual([]);expect(noSelection.children).toEqual([{learnerId:a.family.learnerId,displayName:"Same name / אותו שם"}]);
 expect((await f.read(auth,"context","learnerId="+b.learnerId)).status).toBe(404);expect((await f.read(other,"plan",fishingCalendarSearch(a.selection))).status).toBe(404);
 const result=await f.read(auth,"context","learnerId="+a.family.learnerId);expect(result.status).toBe(200);expect((await result.json()).data.stages[0].enrollmentId).toBe(a.enrollment.result.id);
 const plan=await f.read(auth,"plan",fishingCalendarSearch(a.selection));expect(plan.status).toBe(200);const view=(await plan.json()).data;expect(view.operator).toEqual({venues:[],roster:[],makeupNotices:[],makeupFits:[]});expect(view.selection.learnerId).toBe(a.family.learnerId);expect(await f.effects()).toEqual(before);expect(before.cases).toBe(0);expect(before.grants).toBe(0);
});

test("native ordinary-password parent notice uses exact replay after a deliberately discarded response, with no duplicate notice or other effects",async()=>{
 const f=await fixture(),a=await f.enrolled(),plan=(await f.stage().read(f.owner,f.ref))!;await f.revise(plan.occurrences[0]!.id);await f.publish();const auth=await f.login(a.family.parent),before=await f.effects();
 const current=(await (await f.read(auth,"plan",fishingCalendarSearch(a.selection))).json()).data.view,o=current.occurrences[0];
 const command:StageCommand={action:"notice",operationId:randomUUID(),expectedRevision:current.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:"ordinary_absence"};
 // Discard this real committed response, not the write. Retry the SAME body/key.
 expect((await f.write(auth,a.selection,command)).status).toBe(200);const replay=await f.write(auth,a.selection,command);expect(replay.status).toBe(200);expect((await replay.json()).data.replayed).toBe(true);
 const reloaded=(await (await f.read(auth,"plan",fishingCalendarSearch(a.selection))).json()).data.view;expect(reloaded.notices).toHaveLength(1);expect(reloaded.notices[0].receivedAt).toMatch(/Z$/);expect(await f.effects()).toEqual(before);
});

test("actual session/origin/CSRF/idempotency/strict-intent failures precede stage writes; changed replay is a conflict",async()=>{
 const f=await fixture(),auth=await f.login(f.owner),command:StageCommand={action:"create",operationId:randomUUID(),expectedRevision:0,templateVersion:f.template.version,childCapacity:2},before=await f.effects();
 expect((await f.write(auth,f.operatorSelection,command,undefined,{origin:"https://untrusted.invalid"})).status).toBe(403);expect((await f.write({...auth,csrf:"wrong"},f.operatorSelection,command)).status).toBe(403);
 expect((await f.write(auth,f.operatorSelection,command,undefined,{"idempotency-key":randomUUID()})).status).toBe(400);
 expect((await f.write(auth,f.operatorSelection,command,{operationId:randomUUID(),resources:[],makeupFitDecisionId:null})).status).toBe(400);
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_stage.plans WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
 expect((await f.write(auth,f.operatorSelection,command)).status).toBe(200);expect((await f.write(auth,f.operatorSelection,{...command,childCapacity:1})).status).toBe(409);expect(await f.effects()).toEqual(before);
});

test("current guardian revocation, native logout and role changes remove access on fresh HTTP reads",async()=>{
 const f=await fixture(),a=await f.enrolled(),auth=await f.login(a.family.parent);expect((await f.read(auth,"plan",fishingCalendarSearch(a.selection))).status).toBe(200);
 await f.pool.query("UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND account_id=$2",[f.workspaceId,a.family.parent.id]);expect((await f.read(auth,"plan",fishingCalendarSearch(a.selection))).status).toBe(404);
 await f.pool.query("UPDATE ls_education.guardian_authorities SET active=true WHERE workspace_id=$1 AND account_id=$2",[f.workspaceId,a.family.parent.id]);
 await f.pool.query("UPDATE ls_identity.accounts SET role='adult_client' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,a.family.parent.id]);expect((await f.read(auth)).status).toBe(403);
 await f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,a.family.parent.id]);
 const logout=await f.runtime().identity.handle(new Request(f.origin+"/api/identity/logout",{method:"POST",headers:{cookie:auth.cookie,origin:f.origin,"sec-fetch-site":"same-origin","content-type":"application/json","x-csrf-token":auth.csrf},body:"{}"}));expect(logout.status).toBe(200);expect((await f.read(auth)).status).toBe(401);
});

test("a separately enabled child's own real login is read-only and does not confer parent, roster or billing access",async()=>{
 const f=await fixture(true),a=await f.enrolled(),child=await f.account("child",a.family.learnerId),auth=await f.login(child),before=await f.effects();await f.publish();
 const context=await f.read(auth);expect(context.status).toBe(200);expect((await context.json()).data.selectedLearnerId).toBe(a.family.learnerId);
 const response=await f.read(auth,"plan",fishingCalendarSearch(a.selection));expect(response.status).toBe(200);const plan=(await response.json()).data;expect(plan.view.role).toBe("child");expect(plan.view.notices).toEqual([]);expect(plan.operator.roster).toEqual([]);expect(plan.lessonLinks).toEqual([]);expect(JSON.stringify(plan)).not.toMatch(/paidCents|privateNote|PRIVATE_SYNTHETIC|termsAcceptanceId/);
 expect((await f.write(auth,a.selection,{action:"publish",operationId:randomUUID(),expectedRevision:plan.view.revision})).status).toBe(403);expect(await f.effects()).toEqual(before);
});

test("unenabled child access, expired ordinary sessions, malformed or foreign context never fall back to a first child",async()=>{
 const f=await fixture(),a=await f.enrolled(),child=await f.account("child",a.family.learnerId),childAuth=await f.login(child),parent=await f.login(a.family.parent);
 expect((await f.read(childAuth)).status).toBe(403);expect((await f.read(parent,"context","learnerId=constructor")).status).toBe(400);expect((await f.read(parent,"context",`learnerId=${a.family.learnerId}&learnerId=${a.family.learnerId}`)).status).toBe(400);
 const wrong={...a.selection,reference:{...a.selection.reference,stageId:randomUUID()}};expect((await f.read(parent,"plan",fishingCalendarSearch(wrong))).status).toBe(404);
 await f.pool.query("UPDATE ls_identity.sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE workspace_id=$1 AND revoked_at IS NULL",[f.workspaceId]);expect((await f.read(parent)).status).toBe(401);
});

test("global educational revocation and foreign-workspace operator login are denied without native timeline leakage",async()=>{
 const f=await fixture(),a=await f.enrolled(),auth=await f.login(a.family.parent),plan=(await f.stage().read(f.owner,f.ref))!;await f.revise(plan.occurrences[0]!.id);await f.publish();
 const from="2000-01-01",to="2000-01-02";expect((await f.read(auth,"timeline",new URLSearchParams({from,to,learnerId:a.family.learnerId}).toString())).status).toBe(200);
 await f.pool.query("INSERT INTO ls_education.access_revocations(workspace_id,id,account_id,learner_id,module_id,version,recorded_by) VALUES($1,$2,$3,$4,NULL,NULL,$5)",[f.workspaceId,randomUUID(),a.family.parent.id,a.family.learnerId,f.owner.id]);
 expect((await f.read(auth,"plan",fishingCalendarSearch(a.selection))).status).toBe(404);expect((await f.read(auth,"timeline",new URLSearchParams({from,to,learnerId:a.family.learnerId}).toString())).status).toBe(404);
 const other=await fixture(),foreign=await other.login(other.owner);expect((await f.read(foreign,"plan",fishingCalendarSearch(f.operatorSelection))).status).toBe(401);
});

test("native timeline contains published scheduled occurrences once in Florida days and never turns drafts into bookings",async()=>{
 const f=await fixture(),a=await f.enrolled(),auth=await f.login(f.owner),plan=(await f.stage().read(f.owner,f.ref))!,when=f.at(48),day=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(when));
 await f.revise(plan.occurrences[0]!.id,when,f.at(49));const query=new URLSearchParams({from:day,to:day}).toString();
 expect((await(await f.read(auth,"timeline",query)).json()).data.items).toEqual([]);await f.publish();
 const response=await f.read(auth,"timeline",query);expect(response.status).toBe(200);const items=(await response.json()).data.items;expect(items).toHaveLength(1);expect(items[0]).toMatchObject({id:plan.occurrences[0]!.id,timeZone:"America/New_York",state:"published",selections:[f.operatorSelection]});
 const parent=await f.login(a.family.parent);expect((await(await f.read(parent,"timeline",query)).json()).data.items).toEqual([]);
 const own=await f.read(parent,"timeline",query+"&learnerId="+a.family.learnerId);expect(own.status).toBe(200);expect((await own.json()).data.items[0].selections).toEqual([a.selection]);
 for(const bad of[query+"&from="+day,"from=2026-01-01&to=2026-04-01",query+"&role=practitioner"])expect((await f.read(auth,"timeline",bad)).status).toBe(400);
});
