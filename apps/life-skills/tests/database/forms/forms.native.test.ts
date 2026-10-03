import { afterEach, expect, test } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { fixture, poolStore, type Fixture } from "../calendar/fixture.ts";
import { FormsService } from "../../../src/features/forms/service.ts";
import type { IdentityConfig } from "../../../src/features/identity/config.ts";
import { systemClock } from "../../../src/features/identity/types.ts";
import { validateAnswers, type FormDefinition } from "../../../src/features/forms/schema.ts";
import { FormsHttp } from "../../../src/features/forms/http.ts";
import { IdentitySessions } from "../../../src/features/identity/session-adapter.ts";
import { PostgresIdentityRateStore } from "../../../src/features/identity/rate-store.ts";
import { durableAuditSink } from "../../../src/features/identity/history.ts";

const opened: Fixture[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((f) => f.pool.end())); });
const definition: FormDefinition = { title: "Synthetic check-in", introduction: "", fields: [
  { key: "summary", kind: "short_text", label: "Summary", required: true },
  { key: "done", kind: "boolean", label: "Done", required: true },
] };

test("FormsService native flow enforces authorization and exact idempotent replay", async () => {
  const f = await fixture(); opened.push(f);
  const config: IdentityConfig = { enabled: true, origin: "https://synthetic.example.invalid", workspaceId: f.workspaceId, csrfKey: randomBytes(32), lookupKey: randomBytes(32), rateLimitKey: randomUUID(), keyring: f.keyring, sessionSeconds: 3600 };
  const forms = new FormsService(poolStore(f.pool), config, systemClock);
  const template = await forms.createTemplate(f.practitioner.actor, { key: "SYNTHETIC_FORM", version: 1, locale: "en", targetRole: "parent", definition, provenance: "native-test", published: true }, randomUUID());
  const assignment = await forms.assign(f.practitioner.actor, { caseId: f.first.id, templateId: template.templateId, assignedAccountId: f.parent.actor.id, dueDate: null, postSubmissionAudienceId: f.first.audienceId }, randomUUID());
  const key = randomUUID(), answers = { summary: "completed", done: false };
  const concurrent=await Promise.all([1,2].map(()=>forms.submit(f.parent.actor,{assignmentId:assignment.assignmentId,answers,idempotencyKey:key},randomUUID())));
  const first = concurrent[0]!;expect(concurrent[1]!.submissionId).toBe(first.submissionId);expect(concurrent.filter(result=>!result.duplicate)).toHaveLength(1);
  expect(await forms.submit(f.parent.actor, { assignmentId: assignment.assignmentId, answers, idempotencyKey: key }, randomUUID())).toMatchObject({ submissionId: first.submissionId, duplicate: true });
  await expect(forms.submit(f.parent.actor, { assignmentId: assignment.assignmentId, answers: { summary: "changed", done: false }, idempotencyKey: key }, randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(forms.listAssignments(f.outsider.actor, f.first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await forms.markReviewed(f.practitioner.actor, first.submissionId, randomUUID());
  const metadata=(await forms.listAssignments(f.parent.actor,f.first.id)).find(item=>item.id===assignment.assignmentId)!;
  expect(metadata).toMatchObject({state:'reviewed',submissionId:first.submissionId,submissionAuthorAccountId:f.parent.actor.id});
  expect(Date.parse(metadata.submittedAt!)).toBeGreaterThan(0);expect(Date.parse(metadata.reviewedAt!)).toBeGreaterThan(0);
  expect(JSON.stringify(metadata)).not.toContain('completed');expect(metadata).not.toHaveProperty('answers');
  expect((await forms.listProtectedSubmissions(f.practitioner.actor, f.first.id, assignment.assignmentId))[0]).toMatchObject({ state: "reviewed", answers });
  await expect(forms.listProtectedSubmissions(f.parent.actor,f.first.id,assignment.assignmentId)).rejects.toMatchObject({code:'FORBIDDEN'});
  const raw=await f.pool.query('SELECT answers_ciphertext FROM ls_forms.form_submissions WHERE workspace_id=$1 AND assignment_id=$2',[f.workspaceId,assignment.assignmentId]);expect(raw.rows).toHaveLength(1);expect(raw.rows[0].answers_ciphertext).not.toContain('completed');
  await f.pool.query('UPDATE ls_cases.case_guardians SET revoked_at=now() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[f.workspaceId,f.first.id,f.parent.actor.id]);
  await expect(forms.submit(f.parent.actor,{assignmentId:assignment.assignmentId,answers,idempotencyKey:key},randomUUID())).rejects.toMatchObject({code:'NOT_FOUND'});
  const other=await fixture();opened.push(other);await expect(forms.listAssignments(other.practitioner.actor,f.first.id)).rejects.toMatchObject({code:'NOT_FOUND'});
});

test("targeted native assignment readback survives case-list overflow without widening role or case access", async () => {
  const f=await fixture();opened.push(f);
  const config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600};
  const store=poolStore(f.pool),forms=new FormsService(store,config,systemClock);
  const template=await forms.createTemplate(f.practitioner.actor,{key:'SYNTHETIC_OVERFLOW',version:1,locale:'en',targetRole:'parent',definition,provenance:'native-test',published:true},randomUUID());
  const original=await forms.assign(f.practitioner.actor,{caseId:f.first.id,templateId:template.templateId,assignedAccountId:f.parent.actor.id,dueDate:null,postSubmissionAudienceId:null},randomUUID());
  const seed=async(from:number,to:number)=>f.pool.query(`INSERT INTO ls_forms.form_assignments(id,workspace_id,case_id,template_id,assigned_account_id,state,assigned_by_account_id,assigned_at)
    SELECT gen_random_uuid(),workspace_id,case_id,template_id,assigned_account_id,'assigned',assigned_by_account_id,assigned_at+n*interval '1 millisecond'
    FROM ls_forms.form_assignments CROSS JOIN generate_series($2::int,$3::int) n WHERE workspace_id=$1 AND id=$4`,[f.workspaceId,from,to,original.assignmentId]);
  await seed(1,99);expect((await forms.listAssignments(f.parent.actor,f.first.id)).at(-1)?.id).toBe(original.assignmentId);
  await seed(100,100);const listed=await forms.listAssignments(f.parent.actor,f.first.id);expect(listed).toHaveLength(100);expect(listed.some(row=>row.id===original.assignmentId)).toBe(false);
  const key=randomUUID(),answers={summary:'Synthetic retained answer',done:false};
  const submitted=await forms.submit(f.parent.actor,{assignmentId:original.assignmentId,answers,idempotencyKey:key},randomUUID());
  const targeted=await forms.listAssignments(f.parent.actor,f.first.id,original.assignmentId);
  expect(targeted).toHaveLength(1);expect(targeted[0]).toMatchObject({id:original.assignmentId,state:'submitted',submissionId:submitted.submissionId,submissionAuthorAccountId:f.parent.actor.id});
  expect(await forms.listAssignments(f.practitioner.actor,f.first.id,original.assignmentId)).toMatchObject([{id:original.assignmentId,submissionId:submitted.submissionId}]);
  expect(targeted[0]).not.toHaveProperty('answers');expect(JSON.stringify(targeted)).not.toContain('Synthetic retained answer');
  expect(await forms.submit(f.parent.actor,{assignmentId:original.assignmentId,answers,idempotencyKey:key},randomUUID())).toMatchObject({submissionId:submitted.submissionId,duplicate:true});
  expect(await forms.listAssignments(f.parent.actor,f.second.id,original.assignmentId)).toEqual([]);
  await expect(forms.listAssignments(f.outsider.actor,f.first.id,original.assignmentId)).rejects.toMatchObject({code:'NOT_FOUND'});
  const sessions=new IdentitySessions(store,config,systemClock),http=new FormsHttp({config,clock:systemClock,sessions,limits:new PostgresIdentityRateStore(store),audit:durableAuditSink(store)},forms);
  const path=`/api/forms/assignments?caseId=${f.first.id}&assignmentId=${original.assignmentId}`;
  const request=(suffix='',token:string|null=f.parent.token)=>http.handle(new Request('http://127.0.0.1:8080'+path+suffix,{headers:{'x-forwarded-host':'synthetic.example.invalid','x-forwarded-proto':'https',...(token?{cookie:`__Host-ls-session=${token}`}:{})}}));
  const read=await request();expect(read.status).toBe(200);expect(read.headers.get('cache-control')).toBe('private, no-store');expect((await read.json()).data).toMatchObject([{id:original.assignmentId,submissionId:submitted.submissionId}]);
  expect((await request('',f.practitioner.token)).status).toBe(200);
  expect((await request('',null)).status).toBe(401);expect((await request('',f.outsider.token)).status).toBe(404);
  expect((await request('&assignmentId='+original.assignmentId)).status).toBe(400);expect((await request('&unexpected=1')).status).toBe(400);
  await f.pool.query('UPDATE ls_cases.case_guardians SET revoked_at=now() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[f.workspaceId,f.first.id,f.parent.actor.id]);
  await expect(forms.listAssignments(f.parent.actor,f.first.id,original.assignmentId)).rejects.toMatchObject({code:'NOT_FOUND'});
});

test("native case consent history reads every version without granting customer access or changing records", async () => {
  const f=await fixture();opened.push(f);
  const config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600};
  const store=poolStore(f.pool),forms=new FormsService(store,config,systemClock),id=randomUUID();
  await f.pool.query(`INSERT INTO ls_sessions.recording_consents(workspace_id,case_id,id,version,signed_by_account_id,signed_at,withdrawn_at,authority_state,recording_allowed,transcription_allowed,ai_processing_allowed,child_informed,policy_version,evidence_ciphertext)
    SELECT $1,$2,$3,n,$4,'2026-09-01T12:00:00Z'::timestamptz,CASE WHEN n=62 THEN '2026-09-02T12:00:00Z'::timestamptz ELSE NULL END,'checked',true,true,true,true,'DEMO-v'||n,'SYNTHETIC-PRIVATE-EVIDENCE-NEVER-READ' FROM generate_series(1,62) n`,[f.workspaceId,f.first.id,id,f.parent.actor.id]);
  const rawBefore=(await f.pool.query('SELECT * FROM ls_sessions.recording_consents WHERE workspace_id=$1 ORDER BY version',[f.workspaceId])).rows;
  const first=await forms.consentHistory(f.practitioner.actor,f.first.id,'recording');
  expect(first.items).toHaveLength(50);expect(first.hasMore).toBe(true);expect(first.nextCursor).toBeTruthy();
  expect(first.items[0]).toMatchObject({kind:'recording',version:62,isCurrent:true,withdrawnAt:'2026-09-02T12:00:00.000Z'});
  const next=await forms.consentHistory(f.practitioner.actor,f.first.id,'recording',first.nextCursor);
  expect(next.hasMore).toBe(false);expect(next.nextCursor).toBeNull();expect(next.items).toHaveLength(12);
  expect([...first.items,...next.items].map(row=>row.kind==='recording'?row.version:0)).toEqual(Array.from({length:62},(_,i)=>62-i));
  expect(next.items.every(row=>row.kind==='recording'&&!row.isCurrent)).toBe(true);
  expect(JSON.stringify(first)).not.toMatch(/evidence|ciphertext|SYNTHETIC-PRIVATE/);
  for(const actor of [f.parent.actor,f.outsider.actor,{...f.parent.actor,role:'practitioner' as const}])await expect(forms.consentHistory(actor,f.first.id,'recording')).rejects.toMatchObject({code:'FORBIDDEN'});
  const other=await fixture();opened.push(other);await expect(forms.consentHistory(other.practitioner.actor,f.first.id,'recording')).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(forms.consentHistory(f.practitioner.actor,f.second.id,'recording',first.nextCursor)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  await expect(forms.consentHistory(f.practitioner.actor,f.first.id,'disclosure',first.nextCursor)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  await expect(forms.consentHistory(f.practitioner.actor,f.first.id,'recording','malformed')).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect((await forms.consentHistory(f.practitioner.actor,f.second.id,'recording')).items).toEqual([]);
  const sessions=new IdentitySessions(store,config,systemClock),http=new FormsHttp({config,clock:systemClock,sessions,limits:new PostgresIdentityRateStore(store),audit:durableAuditSink(store)},forms);
  const path=`/api/forms/consent-history?caseId=${f.first.id}&kind=recording`;
  const request=(suffix='',token:string|null=f.practitioner.token,method='GET')=>http.handle(new Request('http://127.0.0.1:8080'+path+suffix,{method,headers:{'x-forwarded-host':'synthetic.example.invalid','x-forwarded-proto':'https',...(token?{cookie:`__Host-ls-session=${token}`}:{})}}));
  const read=await request();expect(read.status).toBe(200);expect(read.headers.get('cache-control')).toBe('private, no-store');expect((await read.json()).data.items).toHaveLength(50);
  expect((await request('',null)).status).toBe(401);expect((await request('',f.parent.token)).status).toBe(403);
  expect((await request('&kind=recording')).status).toBe(400);expect((await request('&unexpected=1')).status).toBe(400);
  expect((await request('',f.practitioner.token,'POST')).status).toBe(404);
  expect((await f.pool.query('SELECT * FROM ls_sessions.recording_consents WHERE workspace_id=$1 ORDER BY version',[f.workspaceId])).rows).toEqual(rawBefore);
  await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
  await expect(forms.consentHistory(f.practitioner.actor,f.first.id,'recording')).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});

test("native disclosure metadata preserves microsecond cursor order and reports actual revoke/use/expiry without decrypting private scope", async () => {
  const f=await fixture();opened.push(f);
  const config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600};
  const forms=new FormsService(poolStore(f.pool),config,systemClock),ids:Array<string>=[];
  for(let n=0;n<52;n++){
    const id=randomUUID();ids.push(id);
    await f.pool.query(`INSERT INTO ls_sessions.disclosure_authorizations(workspace_id,case_id,id,recipient_ciphertext,purpose_ciphertext,topic_ciphertext,authority_evidence_ciphertext,channel,authorized_by_account_id,recorded_by_practitioner_id,child_discussion_recorded,authorized_at,expires_at,revoked_at,used_at)
      VALUES($1,$2,$3,'SYNTHETIC-PRIVATE-RECIPIENT','SYNTHETIC-PRIVATE-PURPOSE','SYNTHETIC-PRIVATE-TOPIC','SYNTHETIC-PRIVATE-EVIDENCE','secure_message',$4,$5,true,('2026-09-01T12:00:00Z'::timestamptz+$6::int*interval '1 microsecond'),'2026-12-01T12:00:00Z',CASE WHEN $6=51 THEN '2026-09-02T12:00:00Z'::timestamptz ELSE NULL END,CASE WHEN $6=50 THEN '2026-09-03T12:00:00Z'::timestamptz ELSE NULL END)`,[f.workspaceId,f.first.id,id,f.parent.actor.id,f.practitioner.actor.id,n]);
  }
  const before=(await f.pool.query('SELECT * FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 ORDER BY authorized_at,id',[f.workspaceId])).rows;
  const first=await forms.consentHistory(f.practitioner.actor,f.first.id,'disclosure'),second=await forms.consentHistory(f.practitioner.actor,f.first.id,'disclosure',first.nextCursor);
  expect(first.items).toHaveLength(50);expect(second.items).toHaveLength(2);expect([...first.items,...second.items].map(row=>row.id)).toEqual(ids.reverse());
  expect(first.items[0]).toMatchObject({kind:'disclosure',revokedAt:'2026-09-02T12:00:00.000Z'});expect(first.items[1]).toMatchObject({kind:'disclosure',usedAt:'2026-09-03T12:00:00.000Z'});
  expect(JSON.stringify(first)).not.toMatch(/ciphertext|SYNTHETIC-PRIVATE|recipient|purpose|topic/);
  for(const at of ['2026-99-99 12:00:00+00','2026-09-01 not-a-time','2026-02-30 12:00:00+00']){
    const cursor=Buffer.from(JSON.stringify({kind:'disclosure',caseId:f.first.id,at,id:ids[0]})).toString('base64url');
    await expect(forms.consentHistory(f.practitioner.actor,f.first.id,'disclosure',cursor)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  }
  expect((await f.pool.query('SELECT * FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 ORDER BY authorized_at,id',[f.workspaceId])).rows).toEqual(before);
  await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
  await expect(forms.consentHistory(f.practitioner.actor,f.first.id,'disclosure')).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});

test("form answer validation rejects empty/unknown/invalid values but accepts false", () => {
  expect(() => validateAnswers(definition, { summary: " ", done: false })).toThrow();
  expect(() => validateAnswers(definition, { summary: "ok", done: false, extra: "x" })).toThrow();
  expect(() => validateAnswers({ ...definition, fields: [{ key: "when", kind: "date", label: "When", required: true }] }, { when: "2026-02-30" })).toThrow();
  expect(() => validateAnswers(definition, { summary: "ok", done: false })).not.toThrow();
});
