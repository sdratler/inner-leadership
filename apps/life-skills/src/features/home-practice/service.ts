import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId, type Id } from "../../lib/ids.ts";
import { instant } from "../../lib/time.ts";
import type { CaseScope } from "../../lib/workspace.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { audienceAccess, caseAccess, validateAssignees } from "../cases/policy.ts";
import { seal, unseal } from "../identity/crypto.ts";
import type { IdentityConfig } from "../identity/config.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type {
  CoordinationSnapshot,
  CoordinationVersionId,
  PracticeAssignmentId,
  PracticeVersionId,
  PracticeVersionReader,
  PracticeVersionReference,
} from "../identity/interfaces.ts";
import { one, type IdentityStore } from "../identity/store.ts";
import type { AccountId, Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import { assertCalendarDate, assertPeriod } from "./policy.ts";
import { recordPracticeAction } from "./history.ts";
import type {
  CommitmentId,
  CompletionMode,
  GoalId,
  OccurrencePeriod,
  PublishedPracticeVersion,
  ScheduledOccurrence,
} from "./types.ts";

const instructionsAad = (workspaceId: string, versionId: string) => `practice-version:${workspaceId}:${versionId}`;
function immutableVersionDigest(row: VersionRow): string {
  return createHash("sha256").update(JSON.stringify([
    row.workspaceId, row.caseId, row.assignmentId, row.versionId, row.version, row.audienceId,
    row.goalId, row.commitmentId, row.templateKey, row.templateVersion, row.instructionsCiphertext,
    row.startsOn, row.endsOn,
  ]), "utf8").digest("hex");
}

interface VersionRow {
  workspaceId: Actor["workspaceId"];
  caseId: CaseId;
  assignmentId: PracticeAssignmentId;
  versionId: PracticeVersionId;
  version: number;
  audienceId: AudienceId;
  goalId: GoalId | null;
  commitmentId: CommitmentId | null;
  templateKey: string;
  templateVersion: string;
  instructionsCiphertext: string;
  startsOn: string;
  endsOn: string | null;
  publishedAt: Date | null;
  immutableSnapshotDigest: string | null;
}

interface AdaptationInput {
  scope: CaseScope;
  sourceReportId: Id<"parent_report">;
  currentVersion: PracticeVersionReference;
  adaptedInstructions: string;
  practitionerAccountId: AccountId;
  idempotencyKey: string;
}

interface AdaptationResult {
  assignmentId: PracticeAssignmentId;
  previousVersionId: PracticeVersionId;
  newVersionId: PracticeVersionId;
  state: "draft";
}

interface AdaptationReceiptRow extends AdaptationResult {
  requestDigest: string;
}

function adaptationDigest(input: AdaptationInput): string {
  const version = input.currentVersion;
  return createHash("sha256").update(JSON.stringify([
    input.scope.workspaceId, input.scope.accountId, input.scope.caseId,
    input.sourceReportId, version.workspaceId, version.caseId, version.assignmentId,
    version.versionId, version.audienceId, version.visibility, version.publishedAt,
    version.immutableSnapshotDigest, input.adaptedInstructions,
    input.practitionerAccountId, input.idempotencyKey,
  ]), "utf8").digest("hex");
}

const VERSION_SELECT = `SELECT a.workspace_id AS "workspaceId",a.case_id AS "caseId",a.id AS "assignmentId",
 v.id AS "versionId",v.version,a.audience_id AS "audienceId",a.goal_id AS "goalId",a.commitment_id AS "commitmentId",
 v.template_key AS "templateKey",v.template_version AS "templateVersion",v.instructions_ciphertext AS "instructionsCiphertext",
 v.starts_on::text AS "startsOn",v.ends_on::text AS "endsOn",v.published_at AS "publishedAt",
 v.immutable_snapshot_digest AS "immutableSnapshotDigest"
 FROM ls_practice.practice_assignments a JOIN ls_practice.practice_assignment_versions v
 ON v.workspace_id=a.workspace_id AND v.assignment_id=a.id`;

export class HomePracticeService implements PracticeVersionReader {
  constructor(private readonly store: IdentityStore, private readonly config: IdentityConfig, private readonly clock: IdentityClock) {}

  private project(row: VersionRow): PublishedPracticeVersion {
    if (!row.publishedAt || !row.immutableSnapshotDigest) throw new AppError("UNAVAILABLE");
    return {
      ...row,
      instructions: unseal(row.instructionsCiphertext, instructionsAad(row.workspaceId, row.versionId), this.config.keyring),
      publishedAt: row.publishedAt.toISOString(),
      immutableSnapshotDigest: row.immutableSnapshotDigest,
    };
  }

  /** Integration-owned LS-080 adapter. It creates a draft only and never publishes. */
  async createDraftFromReport(input: AdaptationInput): Promise<AdaptationResult> {
    const { scope, currentVersion } = input;
    if (scope.accountId !== input.practitionerAccountId ||
      currentVersion.workspaceId !== scope.workspaceId || currentVersion.caseId !== scope.caseId ||
      currentVersion.visibility !== "family_full" || !/^[0-9a-f]{64}$/.test(currentVersion.immutableSnapshotDigest) ||
      !/^[0-9a-f-]{36}$/i.test(input.idempotencyKey) || input.adaptedInstructions.length < 1 || input.adaptedInstructions.length > 8_000) {
      throw new AppError("INVALID_REQUEST");
    }
    const requestDigest = adaptationDigest(input), now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, scope.workspaceId);
      const authorized = await one<{ id: CaseId }>(tx, `SELECT c.id FROM ls_cases.cases c
        JOIN ls_identity.accounts a ON a.workspace_id=c.workspace_id AND a.id=c.practitioner_account_id
        WHERE c.workspace_id=$1 AND c.id=$2 AND c.practitioner_account_id=$3
          AND a.id=$4 AND a.role='practitioner' AND a.state='active' FOR UPDATE OF c,a`,
      [scope.workspaceId, scope.caseId, input.practitionerAccountId, scope.accountId]);
      if (!authorized) throw new AppError("NOT_FOUND");

      const report = await one<{ assignmentId: PracticeAssignmentId; versionId: PracticeVersionId; audienceId: AudienceId; publishedAt: Date; snapshotDigest: string }>(tx, `SELECT
        r.practice_assignment_id AS "assignmentId",r.practice_version_id AS "versionId",r.audience_id AS "audienceId",
        r.practice_published_at AS "publishedAt",r.practice_snapshot_digest AS "snapshotDigest"
        FROM ls_updates.parent_reports r JOIN ls_cases.audiences au
          ON au.workspace_id=r.workspace_id AND au.case_id=r.case_id AND au.id=r.audience_id
        WHERE r.workspace_id=$1 AND r.case_id=$2 AND r.id=$3 AND r.review_state<>'new'
          AND r.reviewed_by_account_id=$4 AND au.published=true AND au.visibility='family_full' FOR UPDATE OF r`,
      [scope.workspaceId, scope.caseId, input.sourceReportId, input.practitionerAccountId]);
      if (!report || report.assignmentId !== currentVersion.assignmentId || report.versionId !== currentVersion.versionId ||
        report.audienceId !== currentVersion.audienceId || new Date(report.publishedAt).toISOString() !== new Date(currentVersion.publishedAt).toISOString() ||
        report.snapshotDigest !== currentVersion.immutableSnapshotDigest) throw new AppError("CONFLICT");

      const existing = await one<AdaptationReceiptRow>(tx, `SELECT assignment_id AS "assignmentId",
        previous_version_id AS "previousVersionId",new_version_id AS "newVersionId",state,request_digest AS "requestDigest"
        FROM ls_integration.practice_adaptation_receipts
        WHERE workspace_id=$1 AND source_report_id=$2 AND idempotency_key=$3`,
      [scope.workspaceId, input.sourceReportId, input.idempotencyKey]);
      if (existing) {
        if (existing.requestDigest !== requestDigest || existing.assignmentId !== currentVersion.assignmentId ||
          existing.previousVersionId !== currentVersion.versionId || existing.state !== "draft" ||
          !await one(tx, `SELECT id FROM ls_practice.practice_assignment_versions
            WHERE workspace_id=$1 AND assignment_id=$2 AND id=$3 AND state='draft' AND supersedes_version_id=$4`,
          [scope.workspaceId, existing.assignmentId, existing.newVersionId, existing.previousVersionId])) throw new AppError("CONFLICT");
        return { assignmentId: existing.assignmentId, previousVersionId: existing.previousVersionId, newVersionId: existing.newVersionId, state: "draft" };
      }

      const active = await one<VersionRow & { nextVersion: number }>(tx, VERSION_SELECT + `
        WHERE a.workspace_id=$1 AND a.case_id=$2 AND a.id=$3 AND a.audience_id=$4
          AND a.state='published' AND a.active_version_id=v.id AND v.id=$5 AND v.state='published'
        FOR UPDATE OF a,v`,
      [scope.workspaceId, scope.caseId, currentVersion.assignmentId, currentVersion.audienceId, currentVersion.versionId]);
      if (!active || !active.publishedAt || active.publishedAt.toISOString() !== new Date(currentVersion.publishedAt).toISOString() ||
        active.immutableSnapshotDigest !== currentVersion.immutableSnapshotDigest) throw new AppError("CONFLICT");
      if (await one(tx, `SELECT id FROM ls_practice.practice_assignment_versions
        WHERE workspace_id=$1 AND assignment_id=$2 AND state='draft'`, [scope.workspaceId, active.assignmentId])) throw new AppError("CONFLICT");
      const next = await one<{ version: number }>(tx, `SELECT COALESCE(MAX(version),0)+1 AS version
        FROM ls_practice.practice_assignment_versions WHERE workspace_id=$1 AND assignment_id=$2`, [scope.workspaceId, active.assignmentId]);
      if (!next || !Number.isSafeInteger(Number(next.version))) throw new AppError("UNAVAILABLE");

      const newVersionId = asId(randomUUID(), "practice_version");
      const ciphertext = seal(input.adaptedInstructions, instructionsAad(scope.workspaceId, newVersionId), this.config.keyring);
      await tx.query(`INSERT INTO ls_practice.practice_assignment_versions
        (id,workspace_id,assignment_id,version,template_key,template_version,instructions_ciphertext,starts_on,ends_on,state,created_by_account_id,created_at,supersedes_version_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12)`,
      [newVersionId, scope.workspaceId, active.assignmentId, Number(next.version), active.templateKey, active.templateVersion,
        ciphertext, active.startsOn, active.endsOn, input.practitionerAccountId, now, active.versionId]);
      await tx.query(`INSERT INTO ls_integration.practice_adaptation_receipts
        (workspace_id,source_report_id,idempotency_key,request_digest,case_id,assignment_id,previous_version_id,new_version_id,practitioner_account_id,state,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10)`,
      [scope.workspaceId, input.sourceReportId, input.idempotencyKey, requestDigest, scope.caseId, active.assignmentId,
        active.versionId, newVersionId, input.practitionerAccountId, now]);
      await recordPracticeAction(tx, { requestId: input.idempotencyKey, now }, scope.workspaceId, input.practitionerAccountId, "practice_assignment_revision_drafted");
      return { assignmentId: active.assignmentId, previousVersionId: active.versionId, newVersionId, state: "draft" };
    });
  }

  async createDraft(actor: Actor, input: {
    caseId: CaseId; audienceId: AudienceId; goalId?: GoalId | undefined; commitmentId?: CommitmentId | undefined;
    templateKey: string; templateVersion: string; instructions: string; startsOn: string; endsOn?: string | null | undefined;
  }, requestId: string): Promise<{ assignmentId: PracticeAssignmentId; versionId: PracticeVersionId }> {
    const startsOn = assertCalendarDate(input.startsOn);
    const endsOn = input.endsOn ? assertCalendarDate(input.endsOn) : null;
    if (endsOn && endsOn < startsOn) throw new AppError("INVALID_REQUEST");
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, input.caseId);
      caseAccess(current, item, guardians, "write");
      const audience = await loadAudience(tx, actor.workspaceId, input.caseId, input.audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      if (input.goalId && !await one(tx, "SELECT id FROM ls_practice.goals WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3 AND id=$4", [actor.workspaceId, input.caseId, input.audienceId, input.goalId])) throw new AppError("NOT_FOUND");
      if (input.commitmentId && !await one(tx, "SELECT id FROM ls_practice.commitments WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3 AND id=$4 AND ($5::uuid IS NULL OR goal_id=$5)", [actor.workspaceId, input.caseId, input.audienceId, input.commitmentId, input.goalId ?? null])) throw new AppError("NOT_FOUND");
      const assignmentId = asId(randomUUID(), "practice_assignment");
      const versionId = asId(randomUUID(), "practice_version");
      const ciphertext = seal(input.instructions, instructionsAad(actor.workspaceId, versionId), this.config.keyring);
      await tx.query(`INSERT INTO ls_practice.practice_assignments
        (id,workspace_id,case_id,audience_id,goal_id,commitment_id,state,active_version_id,created_by_account_id,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,'draft',NULL,$7,$8)`, [assignmentId, actor.workspaceId, input.caseId, input.audienceId, input.goalId ?? null, input.commitmentId ?? null, actor.id, now]);
      await tx.query(`INSERT INTO ls_practice.practice_assignment_versions
        (id,workspace_id,assignment_id,version,template_key,template_version,instructions_ciphertext,starts_on,ends_on,state,created_by_account_id,created_at)
        VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,'draft',$9,$10)`, [versionId, actor.workspaceId, assignmentId, input.templateKey, input.templateVersion, ciphertext, startsOn, endsOn, actor.id, now]);
      await recordPracticeAction(tx, { requestId, now }, actor.workspaceId, actor.id, "practice_assignment_draft_created");
      return { assignmentId, versionId };
    });
  }

  async revise(actor: Actor, input: { assignmentId: PracticeAssignmentId; instructions: string; startsOn: string; endsOn?: string | null | undefined }, requestId: string): Promise<{ versionId: PracticeVersionId; version: number }> {
    const startsOn = assertCalendarDate(input.startsOn), endsOn = input.endsOn ? assertCalendarDate(input.endsOn) : null;
    if (endsOn && endsOn < startsOn) throw new AppError("INVALID_REQUEST");
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const assignment = await one<{ caseId: CaseId; activeVersionId: PracticeVersionId; templateKey: string; templateVersion: string; nextVersion: number }>(tx,
        `SELECT a.case_id AS "caseId",a.active_version_id AS "activeVersionId",v.template_key AS "templateKey",v.template_version AS "templateVersion",
         (SELECT COALESCE(MAX(allv.version),0)+1 FROM ls_practice.practice_assignment_versions allv
          WHERE allv.workspace_id=a.workspace_id AND allv.assignment_id=a.id) AS "nextVersion"
         FROM ls_practice.practice_assignments a
         JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=a.workspace_id AND v.id=a.active_version_id
         WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='published'
         FOR UPDATE OF a`, [actor.workspaceId, input.assignmentId]);
      if (!assignment) throw new AppError("NOT_FOUND");
      const current = await freshActor(tx, actor, now);
      caseAccess(current, await loadCase(tx, actor.workspaceId, assignment.caseId), await loadGuardians(tx, actor.workspaceId, assignment.caseId), "write");
      if (await one(tx, "SELECT id FROM ls_practice.practice_assignment_versions WHERE workspace_id=$1 AND assignment_id=$2 AND state='draft'", [actor.workspaceId, input.assignmentId])) throw new AppError("CONFLICT");
      const versionId = asId(randomUUID(), "practice_version");
      const ciphertext = seal(input.instructions, instructionsAad(actor.workspaceId, versionId), this.config.keyring);
      await tx.query(`INSERT INTO ls_practice.practice_assignment_versions
        (id,workspace_id,assignment_id,version,template_key,template_version,instructions_ciphertext,starts_on,ends_on,state,created_by_account_id,created_at,supersedes_version_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12)`, [versionId, actor.workspaceId, input.assignmentId, assignment.nextVersion, assignment.templateKey, assignment.templateVersion, ciphertext, startsOn, endsOn, actor.id, now, assignment.activeVersionId]);
      await recordPracticeAction(tx, { requestId, now }, actor.workspaceId, actor.id, "practice_assignment_revision_drafted");
      return { versionId, version: Number(assignment.nextVersion) };
    });
  }

  async publish(actor: Actor, assignmentId: PracticeAssignmentId, versionId: PracticeVersionId, requestId: string): Promise<PracticeVersionReference> {
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const row = await one<VersionRow>(tx, VERSION_SELECT + " WHERE a.workspace_id=$1 AND a.id=$2 AND v.id=$3 AND v.state='draft' FOR UPDATE OF a,v", [actor.workspaceId, assignmentId, versionId]);
      if (!row) throw new AppError("NOT_FOUND");
      const current = await freshActor(tx, actor, now);
      caseAccess(current, await loadCase(tx, actor.workspaceId, row.caseId), await loadGuardians(tx, actor.workspaceId, row.caseId), "publish");
      const immutableSnapshotDigest = immutableVersionDigest(row);
      await tx.query("UPDATE ls_practice.practice_assignment_versions SET state='published',published_by_account_id=$4,published_at=$5,immutable_snapshot_digest=$6 WHERE workspace_id=$1 AND assignment_id=$2 AND id=$3 AND state='draft'", [actor.workspaceId, assignmentId, versionId, actor.id, now, immutableSnapshotDigest]);
      await tx.query("UPDATE ls_practice.practice_assignments SET state='published',active_version_id=$3 WHERE workspace_id=$1 AND id=$2", [actor.workspaceId, assignmentId, versionId]);
      await recordPracticeAction(tx, { requestId, now }, actor.workspaceId, actor.id, "practice_assignment_published");
      return { workspaceId: actor.workspaceId, caseId: row.caseId, assignmentId, versionId, audienceId: row.audienceId, visibility: (await loadAudience(tx, actor.workspaceId, row.caseId, row.audienceId))?.visibility ?? "private", publishedAt: now.toISOString(), immutableSnapshotDigest };
    });
  }

  async coordinate(actor: Actor, input: {
    assignmentId: PracticeAssignmentId; assigneeAccountIds: readonly AccountId[]; completionMode: CompletionMode;
    reminderCandidateAccountIds: readonly AccountId[]; effectiveFrom: string;
  }, requestId: string): Promise<CoordinationSnapshot> {
    const effectiveFrom = instant(input.effectiveFrom);
    if (Date.parse(effectiveFrom) < this.clock.now().getTime()) throw new AppError("INVALID_REQUEST");
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const row = await one<{ caseId: CaseId; audienceId: AudienceId; nextVersion: number }>(tx,
        `SELECT a.case_id AS "caseId",a.audience_id AS "audienceId",
         (SELECT COALESCE(MAX(c.version),0)+1 FROM ls_practice.task_coordination_versions c
          WHERE c.workspace_id=a.workspace_id AND c.assignment_id=a.id) AS "nextVersion"
         FROM ls_practice.practice_assignments a
         WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='published'
         FOR UPDATE OF a`, [actor.workspaceId, input.assignmentId]);
      if (!row) throw new AppError("NOT_FOUND");
      const current = await freshActor(tx, actor, now);
      if (current.role !== "parent") throw new AppError("NOT_FOUND");
      const item = await loadCase(tx, actor.workspaceId, row.caseId), guardians = await loadGuardians(tx, actor.workspaceId, row.caseId);
      const audience = await loadAudience(tx, actor.workspaceId, row.caseId, row.audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      const clientAccounts=item?await tx.query<{id:AccountId}>(`SELECT a.id FROM ls_identity.accounts a
        JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
        WHERE a.workspace_id=$1 AND a.state='active' AND s.person_id=$2
        AND (($3='minor' AND a.role='child') OR ($3='adult' AND a.role='adult_client'))
        AND a.id=ANY($4::uuid[])`,[actor.workspaceId,item.clientPersonId,item.kind,audience.accountIds]):[];
      const assignees = validateAssignees(current, item!, guardians, audience, input.assigneeAccountIds, clientAccounts.map(row=>row.id));
      if (input.completionMode === "each_assignee" && assignees.length < 2) throw new AppError("INVALID_REQUEST");
      if (new Set(input.reminderCandidateAccountIds).size !== input.reminderCandidateAccountIds.length || input.reminderCandidateAccountIds.some(id => !assignees.includes(id))) throw new AppError("INVALID_REQUEST");
      const versionId = asId(randomUUID(), "coordination_version");
      await tx.query(`INSERT INTO ls_practice.task_coordination_versions
        (id,workspace_id,assignment_id,version,case_id,audience_id,assignee_account_ids,completion_mode,reminder_candidate_account_ids,effective_from,changed_by_account_id,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [versionId, actor.workspaceId, input.assignmentId, row.nextVersion, row.caseId, row.audienceId, assignees, input.completionMode, input.reminderCandidateAccountIds, new Date(effectiveFrom), actor.id, now]);
      await recordPracticeAction(tx, { requestId, now }, actor.workspaceId, actor.id, "practice_coordination_changed");
      return { versionId, caseId: row.caseId, audienceId: row.audienceId, assigneeAccountIds: assignees, completionMode: input.completionMode, effectiveFrom, changedByAccountId: actor.id };
    });
  }

  async schedule(actor: Actor, input: { assignmentId: PracticeAssignmentId; occursOn: string; period: OccurrencePeriod }, requestId: string): Promise<ScheduledOccurrence> {
    const occursOn = assertCalendarDate(input.occursOn), period = assertPeriod(input.period), now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const assignment = await one<{ caseId: CaseId; practiceVersionId: PracticeVersionId }>(tx,
        `SELECT a.case_id AS "caseId",a.active_version_id AS "practiceVersionId" FROM ls_practice.practice_assignments a
         JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=a.workspace_id AND v.id=a.active_version_id
         WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='published' AND v.state='published'
          AND v.starts_on<=$3::date AND (v.ends_on IS NULL OR v.ends_on>=$3::date) FOR UPDATE OF a`, [actor.workspaceId, input.assignmentId, occursOn]);
      if (!assignment) throw new AppError("NOT_FOUND");
      const current = await freshActor(tx, actor, now);
      caseAccess(current, await loadCase(tx, actor.workspaceId, assignment.caseId), await loadGuardians(tx, actor.workspaceId, assignment.caseId), "write");
      const coordination = await one<{ versionId: CoordinationVersionId }>(tx,
        `SELECT id AS "versionId" FROM ls_practice.task_coordination_versions
         WHERE workspace_id=$1 AND assignment_id=$2 AND effective_from<=($3::date + CASE WHEN $4='morning' THEN time '08:00' ELSE time '20:00' END) AT TIME ZONE 'Asia/Jerusalem'
         ORDER BY effective_from DESC,version DESC LIMIT 1`, [actor.workspaceId, input.assignmentId, occursOn, period]);
      if (!coordination) throw new AppError("CONFLICT");
      const id = asId(randomUUID(), "occurrence");
      await tx.query(`INSERT INTO ls_practice.practice_occurrences
        (id,workspace_id,assignment_id,practice_version_id,coordination_version_id,occurs_on,period,state,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8)`, [id, actor.workspaceId, input.assignmentId, assignment.practiceVersionId, coordination.versionId, occursOn, period, now]);
      await recordPracticeAction(tx, { requestId, now }, actor.workspaceId, actor.id, "practice_occurrence_scheduled");
      return { id, assignmentId: input.assignmentId, practiceVersionId: assignment.practiceVersionId, coordinationVersionId: coordination.versionId, occursOn, period, state: "open" };
    });
  }

  async list(actor: Actor, caseId: CaseId, audienceId: AudienceId): Promise<PublishedPracticeVersion[]> {
    return this.store.transaction(async tx => {
      const current = await freshActor(tx, actor, this.clock.now());
      const audience = await loadAudience(tx, actor.workspaceId, caseId, audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      audienceAccess(current, await loadCase(tx, actor.workspaceId, caseId), await loadGuardians(tx, actor.workspaceId, caseId), audience);
      const rows = await tx.query<VersionRow>(VERSION_SELECT + " WHERE a.workspace_id=$1 AND a.case_id=$2 AND a.audience_id=$3 AND v.state='published' ORDER BY v.published_at DESC,v.id LIMIT 100", [actor.workspaceId, caseId, audienceId]);
      return rows.map(row => this.project(row));
    });
  }

  async getAuthorizedVersion(scope: CaseScope, versionId: PracticeVersionId): Promise<PracticeVersionReference | null> {
    return this.store.transaction(async tx => {
      const row = await one<VersionRow>(tx, VERSION_SELECT + ` WHERE a.workspace_id=$1 AND a.case_id=$2 AND v.id=$3 AND v.state='published'
        AND (EXISTS(SELECT 1 FROM ls_cases.cases c WHERE c.workspace_id=a.workspace_id AND c.id=a.case_id AND c.practitioner_account_id=$4)
        OR EXISTS(SELECT 1 FROM ls_cases.audience_accounts aa JOIN ls_identity.accounts ac ON ac.workspace_id=aa.workspace_id AND ac.id=aa.account_id
          JOIN ls_cases.case_guardians g ON g.workspace_id=aa.workspace_id AND g.case_id=aa.case_id AND g.account_id=aa.account_id
          WHERE aa.workspace_id=a.workspace_id AND aa.case_id=a.case_id AND aa.audience_id=a.audience_id AND aa.account_id=$4
           AND aa.revoked_at IS NULL AND g.revoked_at IS NULL AND ac.state='active' AND ac.role='parent')
        OR EXISTS(SELECT 1 FROM ls_cases.audience_accounts aa JOIN ls_identity.accounts ac ON ac.workspace_id=aa.workspace_id AND ac.id=aa.account_id
          JOIN ls_identity.account_subjects s ON s.workspace_id=ac.workspace_id AND s.account_id=ac.id
          JOIN ls_cases.cases c ON c.workspace_id=aa.workspace_id AND c.id=aa.case_id
          JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id AND cl.person_id=s.person_id
          JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
          WHERE aa.workspace_id=a.workspace_id AND aa.case_id=a.case_id AND aa.audience_id=a.audience_id AND aa.account_id=$4
           AND aa.revoked_at IS NULL AND ac.state='active' AND ((ac.role='child' AND p.kind='minor') OR (ac.role='adult_client' AND p.kind='adult'))))`,
      [scope.workspaceId, scope.caseId, versionId, scope.accountId]);
      if (!row?.publishedAt || !row.immutableSnapshotDigest) return null;
      const audience = await loadAudience(tx, scope.workspaceId, scope.caseId, row.audienceId);
      if (!audience?.published) return null;
      return { workspaceId: row.workspaceId, caseId: row.caseId, assignmentId: row.assignmentId, versionId: row.versionId, audienceId: row.audienceId, visibility: audience.visibility, publishedAt: row.publishedAt.toISOString(), immutableSnapshotDigest: row.immutableSnapshotDigest };
    });
  }
}
