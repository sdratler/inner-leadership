/** Native production adapter and authorization tests. The fixture sessions are
 * not password-login evidence; ordinary retained-app browser proof is separate. */
import {afterEach,expect,test} from "vitest";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {seal} from "../../../src/features/identity/crypto.ts";
import {asId} from "../../../src/lib/ids.ts";
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {SessionDatabaseService} from "../../../src/features/session-workflow/database.ts";
import {HomePracticeService} from "../../../src/features/home-practice/service.ts";
import {SessionHttp} from "../../../src/features/session-workflow/http.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {PostgresIdentityRateStore} from "../../../src/features/identity/rate-store.ts";
import {durableAuditSink} from "../../../src/features/identity/history.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {blankMetrics} from "../../../src/features/session-workflow/metrics.ts";
const opened:Fixture[]=[];
afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.pool.end()));});
async function setup(){
 const f=await fixture();opened.push(f);const store=poolStore(f.pool),origin="https://synthetic.invalid",config:IdentityConfig={enabled:true,origin,workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString("hex"),keyring:f.keyring,sessionSeconds:28800};
 const sessions=new IdentitySessions(store,config,systemClock),service=new SessionDatabaseService(store,f.keyring,systemClock),practice=new HomePracticeService(store,config,systemClock),http=new SessionHttp({config,sessions,limits:new PostgresIdentityRateStore(store),audit:durableAuditSink(store),clock:systemClock},service);
 const sessionId=(await service.ensureForAppointment(f.practitioner.actor,f.first.id,await f.seed(f.at(-48)))).sessionId;
 const request=(path:string,body?:unknown,token=f.practitioner.token,key=randomUUID(),csrf=true)=>new Request(origin+"/api/sessions"+path,{method:body===undefined?"GET":"POST",headers:{cookie:`${SESSION_COOKIE}=${token}`,...(body===undefined?{}:{origin,"content-type":"application/json","idempotency-key":key,...(csrf?{"x-csrf-token":sessions.csrf(token)}:{})})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const draft={locale:"he" as const,focus:["regulation" as const],nextStep:"DEMO — הצעד הבא בלבד",expectedVersion:0};
 async function publish(instructions="DEMO — Published child practice",audienceId=f.first.audienceId){const result=await practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId,templateKey:"W01",templateVersion:"DEMO-recap-source",instructions,startsOn:f.at(24).slice(0,10),endsOn:f.at(240).slice(0,10),responsibility:{participant:"client",period:"morning",assigneeAccountIds:[],assistedByParentAccountIds:[f.parent.actor.id],reminderRecipients:[],completionMode:"any_assignee",weekdays:[0,1,2,3,4,5,6],localTime:"18:45",timezone:"UTC",timeOrigin:"practitioner",foldChoice:null}},randomUUID());await practice.publish(f.practitioner.actor,result.assignmentId,result.versionId,randomUUID());return result;}
 return {f,service,practice,http,request,sessionId,draft,publish};
}
test("the retained native constraints bound case recipients to two guardians and one optional child without blocking session detail",async()=>{
 const s=await setup(),childId=randomUUID(),now=new Date(),ids=[s.f.parent.actor.id,s.f.parentTwo.actor.id,childId];
 const personId=(await s.f.pool.query('SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.workspace_id=$1 AND c.id=$2',[s.f.workspaceId,s.f.first.id])).rows[0].person_id;
 for(const accountId of [childId,randomUUID()])await s.f.pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'child','active','en',$3,$4,$5,'synthetic-non-login-hash',$5,$5)",[accountId,s.f.workspaceId,createHash('sha256').update(accountId).digest('hex'),seal(`demo-${accountId}@example.invalid`,`email:${s.f.workspaceId}:${accountId}`,s.f.keyring),now]);
 await s.f.pool.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[s.f.workspaceId,childId,personId]);
 const extraChild=(await s.f.pool.query("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND role='child' AND id<>$2",[s.f.workspaceId,childId])).rows[0].id;
 await expect(s.f.pool.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[s.f.workspaceId,extraChild,personId])).rejects.toMatchObject({code:'23505'});
 await expect(s.f.pool.query('INSERT INTO ls_cases.case_guardians(workspace_id,case_id,account_id,granted_at) VALUES($1,$2,$3,$4)',[s.f.workspaceId,s.f.first.id,s.f.outsider.actor.id,now])).rejects.toMatchObject({code:'23514',message:'CASE_GUARDIAN_LIMIT'});
 const detail=await s.service.detail(s.f.practitioner.actor,s.sessionId);
 expect(detail.recipients.map(row=>row.accountId).sort()).toEqual([...ids].sort());expect(detail.consentSigners.map(row=>row.accountId).sort()).toEqual(ids.slice(0,2).sort());
 await s.service.saveObservations(s.f.practitioner.actor,s.sessionId,blankMetrics(),0,randomUUID());
 await s.service.saveRecap(s.f.practitioner.actor,s.sessionId,{...s.draft,practices:[]},randomUUID());
 expect((await s.service.recapPreview(s.f.practitioner.actor,s.sessionId,1,[ids[1]!])).recipients.map(row=>row.accountId)).toEqual([ids[1]!]);
 const tooMany=Array.from({length:9},()=>randomUUID()),query=new URLSearchParams({version:'1'});tooMany.forEach(id=>query.append('recipient',id));
 expect((await s.http.handle(s.request(`/${s.sessionId}/recap-preview?${query}`),[s.sessionId,'recap-preview'])).status).toBe(400);
 expect((await s.http.handle(s.request(`/${s.sessionId}/share`,{expectedVersion:1,expectedDigest:'a'.repeat(64),recipientAccountIds:tooMany}),[s.sessionId,'share'])).status).toBe(400);
},30000);

test("bounded source pages can reach eligible practice behind twenty-one ineligible newer versions",async()=>{
 const s=await setup(),eligible=await s.publish(),audienceId=asId(randomUUID(),'audience');
 await s.f.pool.query("INSERT INTO ls_cases.audiences(id,workspace_id,case_id,visibility,published,created_at) VALUES($1,$2,$3,'family_title_completion',true,clock_timestamp())",[audienceId,s.f.workspaceId,s.f.first.id]);
 for(const accountId of [s.f.parent.actor.id,s.f.parentTwo.actor.id])await s.f.pool.query('INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,clock_timestamp())',[s.f.workspaceId,s.f.first.id,audienceId,accountId]);
 for(let i=0;i<21;i++)await s.publish(`DEMO — ineligible full-routine source ${i}`,audienceId);
 let cursor:string|undefined,found=false;
 for(let page=0;page<3;page++){
  const query=cursor?`?cursor=${cursor}`:'',response=await s.http.handle(s.request(`/${s.sessionId}/practice-choices${query}`),[s.sessionId,'practice-choices']);expect(response.status).toBe(200);
  const body=await response.json();expect(body.data.items.length).toBeLessThanOrEqual(20);found ||= body.data.items.some((item:{versionId:string})=>item.versionId===eligible.versionId);
  if(!body.data.hasMore)break;
  expect(body.data.nextCursor).toMatch(/^[a-f0-9-]{36}$/);expect(body.data.nextCursor).not.toBe(cursor);cursor=body.data.nextCursor;
 }
 expect(found).toBe(true);
 for(const query of ['?cursor=constructor','?cursor='+randomUUID()+'&cursor='+randomUUID(),'?cursor='+randomUUID()+'&extra=1'])expect((await s.http.handle(s.request(`/${s.sessionId}/practice-choices${query}`),[s.sessionId,'practice-choices'])).status).toBe(400);
},30000);

test("exact source practices, current future meeting and version readback persist; publication is one receipt across keys",async()=>{
 const s=await setup();await s.f.seed(s.f.at(-24));const next=await s.f.seed(s.f.at(48)),practice=await s.publish(),choices=await s.service.recapPracticeChoices(s.f.practitioner.actor,s.sessionId),choice=choices.items[0]!;
 expect(choice).toMatchObject({versionId:practice.versionId,participant:"client",localTime:"18:45",timezone:"UTC",completionMode:"any_assignee"});expect(choices.hasMore).toBe(false);
 const input={...s.draft,practiceSelections:[{versionId:choice.versionId,expectedSourceDigest:choice.sourceDigest,instructions:"DEMO — Reviewed short routine"}]},path=`/${s.sessionId}/recap`,key=randomUUID();
 for(let attempt=0;attempt<2;attempt++)expect((await s.http.handle(s.request(path,input,s.f.practitioner.token,key),[s.sessionId,"recap"])).status).toBe(201);
 const saved=await s.service.recapVersion(s.f.practitioner.actor,s.sessionId,1);expect(saved.recap.nextAppointment?.id).toBe(next);expect(saved.recap.practices).toMatchObject([{responsibilityId:practice.versionId,version:1,instructions:input.practiceSelections[0]!.instructions,localTime:"18:45",timezone:"UTC"}]);
 const preview=await s.service.recapPreview(s.f.practitioner.actor,s.sessionId,1,[s.f.parent.actor.id,s.f.parentTwo.actor.id]);
 const body={expectedVersion:1,expectedDigest:preview.digest,recipientAccountIds:preview.recipients.map(row=>row.accountId)},shareKey=randomUUID();
 const results=await Promise.all([shareKey,shareKey,randomUUID()].map(id=>s.service.share(s.f.practitioner.actor,s.sessionId,body,id)));expect(results[1]).toEqual(results[0]);expect(results[2]).toEqual(results[0]);
 const proof=await s.service.publication(s.f.practitioner.actor,s.sessionId,results[0]!.publicationId);expect(proof).toMatchObject({...results[0],contentDigest:preview.digest,recap:saved.recap});
 for(const table of ["publications","publication_events"])expect((await s.f.pool.query(`SELECT count(*)::int AS n FROM ls_sessions.${table} WHERE workspace_id=$1`,[s.f.workspaceId])).rows[0].n).toBe(1);
 const stored=(await s.f.pool.query("SELECT body_ciphertext FROM ls_sessions.routine_recap_versions WHERE workspace_id=$1",[s.f.workspaceId])).rows[0];expect(stored.body_ciphertext).not.toContain(input.practiceSelections[0]!.instructions);
 for(const actor of [s.f.parent.actor,s.f.parentTwo.actor]){const read=await s.service.sharedRecaps(actor,s.f.first.id);expect(read).toHaveLength(1);expect(read[0]!.recap).toEqual(saved.recap);}
},30000);
test("privacy whitelist and exact recipient history never expose private observations or auto-grant an added parent",async()=>{
 const s=await setup(),values=blankMetrics();values.engagement={score:9,notObservedReason:null,note:"DEMO_PRIVATE_NEVER_SHARED"};await s.service.saveObservations(s.f.practitioner.actor,s.sessionId,values,0,randomUUID());
 await s.service.saveRecap(s.f.practitioner.actor,s.sessionId,{...s.draft,practices:[]},randomUUID());const preview=await s.service.recapPreview(s.f.practitioner.actor,s.sessionId,1,[s.f.parent.actor.id]);
 await s.service.share(s.f.practitioner.actor,s.sessionId,{expectedVersion:1,expectedDigest:preview.digest,recipientAccountIds:[s.f.parent.actor.id]},randomUUID());
 expect(await s.service.sharedRecaps(s.f.parentTwo.actor,s.f.first.id)).toEqual([]);const raw=JSON.stringify(await s.service.sharedRecaps(s.f.parent.actor,s.f.first.id));for(const text of ["DEMO_PRIVATE_NEVER_SHARED","metrics","transcript","analysis","recordedByAccountId","Ciphertext"])expect(raw).not.toContain(text);
 await expect(s.service.sharedRecaps(s.f.outsider.actor,s.f.first.id)).rejects.toMatchObject({code:"NOT_FOUND"});
 await s.f.pool.query("UPDATE ls_cases.case_guardians SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3",[s.f.workspaceId,s.f.first.id,s.f.parent.actor.id]);await expect(s.service.sharedRecaps(s.f.parent.actor,s.f.first.id)).rejects.toMatchObject({code:"NOT_FOUND"});
},30000);
test("each selected recipient must retain each practice grant; changed native source cannot publish a stale recap",async()=>{
 const s=await setup(),practice=await s.publish(),choice=(await s.service.recapPracticeChoices(s.f.practitioner.actor,s.sessionId)).items[0]!,input={...s.draft,practices:[],practiceSelections:[{versionId:choice.versionId,expectedSourceDigest:choice.sourceDigest,instructions:"DEMO — Reviewed routine"}]};
 await s.service.saveRecap(s.f.practitioner.actor,s.sessionId,input,randomUUID());const all=[s.f.parent.actor.id,s.f.parentTwo.actor.id],preview=await s.service.recapPreview(s.f.practitioner.actor,s.sessionId,1,all);
 await s.f.pool.query("UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND audience_id=$2 AND account_id=$3",[s.f.workspaceId,s.f.first.audienceId,s.f.parentTwo.actor.id]);
 await expect(s.service.recapPreview(s.f.practitioner.actor,s.sessionId,1,all)).rejects.toMatchObject({code:"NOT_FOUND"});await expect(s.service.share(s.f.practitioner.actor,s.sessionId,{expectedVersion:1,expectedDigest:preview.digest,recipientAccountIds:all},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 const revised=await s.practice.revise(s.f.practitioner.actor,{assignmentId:practice.assignmentId,instructions:"DEMO — Revised source",startsOn:choice.startsOn,endsOn:choice.endsOn},randomUUID());await s.practice.publish(s.f.practitioner.actor,practice.assignmentId,revised.versionId,randomUUID());
 await expect(s.service.recapPreview(s.f.practitioner.actor,s.sessionId,1,[s.f.parent.actor.id])).rejects.toMatchObject({code:"CONFLICT"});await expect(s.service.saveRecap(s.f.practitioner.actor,s.sessionId,{...input,expectedVersion:1},randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_sessions.publications WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
},30000);
test("calendar changes require a new reviewed version; immutable version readback and old command replay remain exact",async()=>{
 const s=await setup(),key=randomUUID(),old=await s.service.saveRecap(s.f.practitioner.actor,s.sessionId,{...s.draft,practices:[]},key);expect(old.recap.nextAppointment).toBeNull();await s.f.seed(s.f.at(48));
 await expect(s.service.recapPreview(s.f.practitioner.actor,s.sessionId,1,[s.f.parent.actor.id])).rejects.toMatchObject({code:"CONFLICT"});
 const latest=await s.service.saveRecap(s.f.practitioner.actor,s.sessionId,{...s.draft,expectedVersion:1,nextStep:"DEMO — Renewed review",practices:[]},randomUUID());expect(latest.recap.nextAppointment).not.toBeNull();expect(await s.service.recapVersion(s.f.practitioner.actor,s.sessionId,1)).toEqual(old);expect(await s.service.saveRecap(s.f.practitioner.actor,s.sessionId,{...s.draft,practices:[]},key)).toEqual(old);
 await expect(s.service.recapPreview(s.f.practitioner.actor,s.sessionId,1,[s.f.parent.actor.id])).rejects.toMatchObject({code:"CONFLICT"});
},30000);
test("strict protected reads, CSRF and malformed selections fail closed with no partial recap",async()=>{
 const s=await setup(),path=`/${s.sessionId}/recap`;for(const body of [{...s.draft,privateAnalysis:"no"},{...s.draft,practices:[]},{...s.draft,focus:["regulation","regulation"]},{...s.draft,practiceSelections:[{versionId:randomUUID(),expectedSourceDigest:"a".repeat(64),instructions:" "}]}])expect((await s.http.handle(s.request(path,body),[s.sessionId,"recap"])).status).toBe(400);
 expect((await s.http.handle(s.request(path,s.draft,s.f.practitioner.token,randomUUID(),false),[s.sessionId,"recap"])).status).toBe(403);
 expect((await s.http.handle(s.request(path,s.draft),[s.sessionId,"recap"])).status).toBe(201);
 for(const query of ["?version=0","?version=1e0","?version=2147483648","?version=1&version=1","?version=1&extra=1","?version=1&recipient="+s.f.parent.actor.id])expect((await s.http.handle(s.request(path+query),[s.sessionId,"recap"])).status).toBe(400);
 const previewPath=`/${s.sessionId}/recap-preview?version=1&recipient=${s.f.parent.actor.id}`;expect((await s.http.handle(s.request(previewPath),[s.sessionId,"recap-preview"])).status).toBe(200);
 expect((await s.http.handle(s.request(previewPath+"&recipient="+s.f.parent.actor.id),[s.sessionId,"recap-preview"])).status).toBe(400);
 for(const [url,parts]of [["/invalid/practice-choices",["invalid","practice-choices"]],["/invalid/recap?version=1",["invalid","recap"]],[`/${s.sessionId}/publications/invalid`,[s.sessionId,"publications","invalid"]]]as const)expect((await s.http.handle(s.request(url),parts)).status).toBe(400);
 for(const token of [s.f.parent.token,s.f.parentTwo.token,s.f.outsider.token])for(const [url,parts] of [[path+"?version=1",[s.sessionId,"recap"]],[previewPath,[s.sessionId,"recap-preview"]],[`/${s.sessionId}/practice-choices`,[s.sessionId,"practice-choices"]]] as const)expect((await s.http.handle(s.request(url,undefined,token),parts)).status).toBe(404);
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_sessions.routine_recap_versions WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(1);
},30000);
