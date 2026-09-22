import { afterEach, expect, test } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { fixture, poolStore, type Fixture } from "../calendar/fixture.ts";
import { FormsService } from "../../../src/features/forms/service.ts";
import type { IdentityConfig } from "../../../src/features/identity/config.ts";
import { systemClock } from "../../../src/features/identity/types.ts";
import { validateAnswers, type FormDefinition } from "../../../src/features/forms/schema.ts";

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
  expect((await forms.listProtectedSubmissions(f.practitioner.actor, f.first.id, assignment.assignmentId))[0]).toMatchObject({ state: "reviewed", answers });
  await expect(forms.listProtectedSubmissions(f.parent.actor,f.first.id,assignment.assignmentId)).rejects.toMatchObject({code:'FORBIDDEN'});
  const raw=await f.pool.query('SELECT answers_ciphertext FROM ls_forms.form_submissions WHERE workspace_id=$1 AND assignment_id=$2',[f.workspaceId,assignment.assignmentId]);expect(raw.rows).toHaveLength(1);expect(raw.rows[0].answers_ciphertext).not.toContain('completed');
  await f.pool.query('UPDATE ls_cases.case_guardians SET revoked_at=now() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[f.workspaceId,f.first.id,f.parent.actor.id]);
  await expect(forms.submit(f.parent.actor,{assignmentId:assignment.assignmentId,answers,idempotencyKey:key},randomUUID())).rejects.toMatchObject({code:'NOT_FOUND'});
  const other=await fixture();opened.push(other);await expect(forms.listAssignments(other.practitioner.actor,f.first.id)).rejects.toMatchObject({code:'NOT_FOUND'});
});

test("form answer validation rejects empty/unknown/invalid values but accepts false", () => {
  expect(() => validateAnswers(definition, { summary: " ", done: false })).toThrow();
  expect(() => validateAnswers(definition, { summary: "ok", done: false, extra: "x" })).toThrow();
  expect(() => validateAnswers({ ...definition, fields: [{ key: "when", kind: "date", label: "When", required: true }] }, { when: "2026-02-30" })).toThrow();
  expect(() => validateAnswers(definition, { summary: "ok", done: false })).not.toThrow();
});
