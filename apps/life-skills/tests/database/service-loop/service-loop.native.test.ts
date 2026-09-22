/** Full synthetic PostgreSQL service loop. Loopback disposable database only; no providers. */
import { afterEach, expect, test } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { fixture, poolStore, type Fixture } from "../calendar/fixture.ts";
import { systemClock } from "../../../src/features/identity/types.ts";
import { HomePracticeService } from "../../../src/features/home-practice/service.ts";
import { UpdateService } from "../../../src/features/updates/service.ts";
import { ProgressService } from "../../../src/features/progress/service.ts";
import { DatabaseAttendanceReader } from "../../../src/features/progress/sources.ts";
import { DatabaseParentReportReader } from "../../../src/features/updates/sources.ts";
import { CheckInService } from "../../../src/features/checkins/service.ts";
import { PrivateNotesService } from "../../../src/features/private-notes/service.ts";
import type { IdentityConfig } from "../../../src/features/identity/config.ts";

const opened: Fixture[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.pool.end())); });
const narrative = { taughtAndPractised: ["Pause and ask"], parentReportedExamples: ["Asked once"], practitionerObservations: ["Practised together"], usefulChanges: ["Shorter prompt"], continuingDifficulty: ["Transitions"], uncertainty: "Synthetic single-period evidence", nextAdjustment: "Repeat the prompt", informationLimits: "Synthetic test evidence" };

test("native service loop preserves case/audience boundaries and family-only readout", async () => {
  const f = await fixture(); opened.push(f);
  const config: IdentityConfig = { enabled: true, origin: "https://synthetic.example.invalid", workspaceId: f.workspaceId, csrfKey: randomBytes(32), lookupKey: randomBytes(32), rateLimitKey: randomUUID(), keyring: f.keyring, sessionSeconds: 3600 };
  const store = poolStore(f.pool), practice = new HomePracticeService(store, config, systemClock);
  const updates = new UpdateService(store, config, systemClock, practice, practice);
  const draft = await practice.createDraft(f.practitioner.actor, { caseId: f.first.id, audienceId: f.first.audienceId, templateKey: "W01", templateVersion: "Program2.1", instructions: "Synthetic pause practice", startsOn: f.at(-2).slice(0, 10), endsOn: f.at(96).slice(0, 10) }, randomUUID());
  const published = await practice.publish(f.practitioner.actor, draft.assignmentId, draft.versionId, randomUUID());
  await practice.coordinate(f.parent.actor, { assignmentId: draft.assignmentId, assigneeAccountIds: [f.parent.actor.id], completionMode: "any_assignee", reminderCandidateAccountIds: [], effectiveFrom: f.at(1) }, randomUUID());
  // Keep the occurrence well after the future-dated coordination change regardless of
  // the local time at which the suite runs. The production schedule-time gate remains intact.
  const occurrence = await practice.schedule(f.practitioner.actor, { assignmentId: draft.assignmentId, occursOn: f.at(48).slice(0, 10), period: "morning" }, randomUUID());
  const checkins = new CheckInService(store, systemClock);
  await checkins.submit(f.parent.actor, { occurrenceId: occurrence.id, status: "done", idempotencyKey: randomUUID() }, randomUUID());
  const report = await updates.submitParentReport(f.parent.actor, { caseId: f.first.id, audienceId: f.first.audienceId, practiceVersionId: published.versionId, body: "Synthetic parent completion and check-in feedback", idempotencyKey: randomUUID() }, randomUUID());
  await updates.review(f.practitioner.actor, report.id, randomUUID());
  await updates.replyToReport(f.practitioner.actor, { reportId: report.id, body: "Synthetic practitioner response", publish: true, idempotencyKey: randomUUID() }, randomUUID());
  const progress = new ProgressService(store, config, systemClock, new DatabaseAttendanceReader(store), new DatabaseParentReportReader(store), practice);
  const review = await progress.createReview(f.practitioner.actor, { caseId: f.first.id, audienceId: f.first.audienceId, periodStart: "2026-09-01", periodEnd: "2026-09-29", assignmentVersionIds: [published.versionId], parentReportIds: [report.id], narrative }, randomUUID());
  await progress.publishReview(f.practitioner.actor, review.reviewId, randomUUID());
  const family = await progress.listReviews(f.parent.actor, f.first.id); expect(family).toHaveLength(1); expect(family[0]).toMatchObject({ id: review.reviewId, state: "published", caseId: f.first.id, audienceId: f.first.audienceId });
  const notes = new PrivateNotesService(store, config, systemClock), canary = `PRIVATE_CANARY_${randomUUID()}`;
  await notes.save(f.practitioner.actor, { caseId: f.first.id, body: canary, expectedRevision: 0, idempotencyKey: randomUUID() }, randomUUID());
  await expect(notes.read(f.parent.actor, f.first.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(progress.listReviews(f.outsider.actor, f.first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(progress.listReviews(f.parent.actor, f.second.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const raw = await f.pool.query("SELECT narrative_ciphertext FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND id=$2", [f.workspaceId, review.reviewId]); expect(raw.rows[0].narrative_ciphertext).not.toContain(canary);
}, 30_000);
