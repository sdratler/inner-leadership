import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId, type Id } from "../../lib/ids.ts";
import { seal, unseal } from "../identity/crypto.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type { IdentityConfig } from "../identity/config.ts";
import type { IdentityStore, SqlSession } from "../identity/store.ts";
import { one } from "../identity/store.ts";
import type { AccountId, Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { audienceAccess, caseAccess, requirePractitioner } from "../cases/policy.ts";
import { recordLs050Action } from "../progress/history.ts";
import { validateAnswers, type FormAnswers, type FormDefinition } from "./schema.ts";

export type FormTemplateId = Id<"form_template">;
export type FormAssignmentId = Id<"form_assignment">;
export type FormSubmissionId = Id<"form_submission">;

interface TemplateRow {
  id: FormTemplateId;
  key: string;
  version: number;
  locale: "he" | "en";
  targetRole: "parent" | "adult_client";
  definition: FormDefinition;
  active: boolean;
  state: "draft" | "published";
}

interface AssignmentRow {
  id: FormAssignmentId;
  workspaceId: Actor["workspaceId"];
  caseId: CaseId;
  templateId: FormTemplateId;
  assignedAccountId: AccountId;
  dueDate: string | null;
  state: "assigned" | "submitted" | "reviewed" | "withdrawn";
  postSubmissionAudienceId: AudienceId | null;
  definition: FormDefinition;
  targetRole: "parent" | "adult_client";
  templateKey: string;
  templateVersion: number;
  locale: "he" | "en";
}

function invalid(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw new AppError("INVALID_REQUEST");
}

async function assignmentById(tx: SqlSession, workspaceId: Actor["workspaceId"], id: FormAssignmentId): Promise<AssignmentRow | null> {
  return one<AssignmentRow>(tx, `SELECT a.id,a.workspace_id AS "workspaceId",a.case_id AS "caseId",a.template_id AS "templateId",
    a.assigned_account_id AS "assignedAccountId",a.due_date::text AS "dueDate",a.state,
    a.post_submission_audience_id AS "postSubmissionAudienceId",t.definition,t.target_role AS "targetRole",
    t.template_key AS "templateKey",t.version AS "templateVersion",t.locale
    FROM ls_forms.form_assignments a JOIN ls_forms.form_templates t
    ON t.workspace_id=a.workspace_id AND t.id=a.template_id WHERE a.workspace_id=$1 AND a.id=$2`, [workspaceId, id]);
}

export class FormsService {
  constructor(private readonly store: IdentityStore, private readonly config: IdentityConfig, private readonly clock: IdentityClock) {}

  async createTemplate(actor: Actor, input: { key: string; version: number; locale: "he" | "en"; targetRole: "parent" | "adult_client"; definition: FormDefinition; provenance: string; published: boolean }, requestId: string) {
    const now = this.clock.now();
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      requirePractitioner(await freshActor(tx, actor, now));
      const id = asId(randomUUID(), "form_template");
      await tx.query(`INSERT INTO ls_forms.form_templates
        (id,workspace_id,template_key,version,locale,target_role,definition,active,state,provenance,created_by_account_id,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,true,$8,$9,$10,$11)`,
      [id, actor.workspaceId, input.key, input.version, input.locale, input.targetRole, JSON.stringify(input.definition), input.published ? "published" : "draft", input.provenance, actor.id, now]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "form_template_created");
      return { templateId: id };
    });
  }

  async listTemplates(actor: Actor, locale: "he" | "en"): Promise<Array<Omit<TemplateRow, "definition"> & { definition: FormDefinition }>> {
    return this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      requirePractitioner(current);
      return tx.query<TemplateRow>(`SELECT id,template_key AS key,version,locale,target_role AS "targetRole",definition,active,state
        FROM ls_forms.form_templates WHERE workspace_id=$1 AND locale=$2 ORDER BY template_key,version DESC LIMIT 100`, [actor.workspaceId, locale]);
    });
  }

  async assign(actor: Actor, input: { caseId: CaseId; templateId: FormTemplateId; assignedAccountId: AccountId; dueDate: string | null; postSubmissionAudienceId: AudienceId | null }, requestId: string) {
    const now = this.clock.now();
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, input.caseId);
      caseAccess(current, item, guardians, "write");
      if (!item) throw new AppError("NOT_FOUND");
      const template = await one<Pick<TemplateRow, "targetRole" | "state" | "active">>(tx,
        `SELECT target_role AS "targetRole",state,active FROM ls_forms.form_templates WHERE workspace_id=$1 AND id=$2`, [actor.workspaceId, input.templateId]);
      if (!template || !template.active || template.state !== "published") throw new AppError("NOT_FOUND");
      if (template.targetRole === "parent") {
        if (!guardians.some((guardian) => guardian.accountId === input.assignedAccountId && !guardian.revoked)) throw new AppError("NOT_FOUND");
      } else {
        const adult = await one(tx, `SELECT a.id FROM ls_identity.accounts a JOIN ls_identity.account_subjects s
          ON s.workspace_id=a.workspace_id AND s.account_id=a.id WHERE a.workspace_id=$1 AND a.id=$2 AND a.role='adult_client'
          AND a.state='active' AND s.person_id=$3`, [actor.workspaceId, input.assignedAccountId, item.clientPersonId]);
        if (!adult) throw new AppError("NOT_FOUND");
      }
      if (input.postSubmissionAudienceId) {
        const audience = await loadAudience(tx, actor.workspaceId, input.caseId, input.postSubmissionAudienceId);
        if (!audience || !audience.published || audience.visibility !== "family_full" || !audience.accountIds.includes(input.assignedAccountId)) throw new AppError("NOT_FOUND");
        audienceAccess(current, item, guardians, audience);
      }
      const id = asId(randomUUID(), "form_assignment");
      await tx.query(`INSERT INTO ls_forms.form_assignments
        (id,workspace_id,case_id,template_id,assigned_account_id,due_date,state,post_submission_audience_id,assigned_by_account_id,assigned_at)
        VALUES ($1,$2,$3,$4,$5,$6,'assigned',$7,$8,$9)`,
      [id, actor.workspaceId, input.caseId, input.templateId, input.assignedAccountId, input.dueDate, input.postSubmissionAudienceId, actor.id, now]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "form_assigned");
      return { assignmentId: id };
    });
  }

  async listAssignments(actor: Actor, caseId: CaseId) {
    return this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      caseAccess(current, await loadCase(tx, actor.workspaceId, caseId), await loadGuardians(tx, actor.workspaceId, caseId), "read");
      const accountClause = current.role === "practitioner" ? "" : " AND a.assigned_account_id=$3";
      return tx.query<Omit<AssignmentRow, "workspaceId">>(`SELECT a.id,a.case_id AS "caseId",a.template_id AS "templateId",
        a.assigned_account_id AS "assignedAccountId",a.due_date::text AS "dueDate",a.state,
        a.post_submission_audience_id AS "postSubmissionAudienceId",t.definition,t.target_role AS "targetRole",
        t.template_key AS "templateKey",t.version AS "templateVersion",t.locale
        FROM ls_forms.form_assignments a JOIN ls_forms.form_templates t ON t.workspace_id=a.workspace_id AND t.id=a.template_id
        WHERE a.workspace_id=$1 AND a.case_id=$2${accountClause} ORDER BY a.assigned_at DESC,a.id LIMIT 100`,
      current.role === "practitioner" ? [actor.workspaceId, caseId] : [actor.workspaceId, caseId, actor.id]);
    });
  }

  async submit(actor: Actor, input: { assignmentId: FormAssignmentId; answers: FormAnswers; idempotencyKey: string }, requestId: string) {
    const now = this.clock.now();
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      const assignment = await assignmentById(tx, actor.workspaceId, input.assignmentId);
      if (!assignment) throw new AppError("NOT_FOUND");
      caseAccess(current, await loadCase(tx, actor.workspaceId, assignment.caseId), await loadGuardians(tx, actor.workspaceId, assignment.caseId), "read");
      if (assignment.assignedAccountId !== actor.id) throw new AppError("NOT_FOUND");
      const existing = await one<{ id: FormSubmissionId; answersDigest: string }>(tx,
        `SELECT id,answers_digest AS "answersDigest" FROM ls_forms.form_submissions WHERE workspace_id=$1 AND assignment_id=$2 AND idempotency_key=$3`,
        [actor.workspaceId, assignment.id, input.idempotencyKey]);
      if (existing) {
        const suppliedDigest = createHash("sha256").update(JSON.stringify(input.answers)).digest("hex");
        if (existing.answersDigest !== suppliedDigest) throw new AppError("CONFLICT");
        return { submissionId: existing.id, duplicate: true };
      }
      if (assignment.state !== "assigned") throw new AppError("CONFLICT");
      try { validateAnswers(assignment.definition, input.answers); } catch (error) { invalid(error); }
      const id = asId(randomUUID(), "form_submission");
      const plain = JSON.stringify(input.answers);
      const digest = createHash("sha256").update(plain).digest("hex");
      const ciphertext = seal(plain, `form-submission:${actor.workspaceId}:${id}`, this.config.keyring);
      await tx.query(`INSERT INTO ls_forms.form_submissions
        (id,workspace_id,case_id,assignment_id,author_account_id,answers_ciphertext,answers_digest,idempotency_key,state,submitted_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9)`,
      [id, actor.workspaceId, assignment.caseId, assignment.id, actor.id, ciphertext, digest, input.idempotencyKey, now]);
      await tx.query(`UPDATE ls_forms.form_assignments SET state='submitted',submitted_at=$3 WHERE workspace_id=$1 AND id=$2 AND state='assigned'`,
        [actor.workspaceId, assignment.id, now]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "form_submitted");
      return { submissionId: id, duplicate: false };
    });
  }

  async listProtectedSubmissions(actor: Actor, caseId: CaseId, assignmentId: FormAssignmentId) {
    return this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      requirePractitioner(current);
      caseAccess(current, await loadCase(tx, actor.workspaceId, caseId), await loadGuardians(tx, actor.workspaceId, caseId), "read");
      const rows = await tx.query<{ id: FormSubmissionId; assignmentId: FormAssignmentId; authorAccountId: AccountId; answersCiphertext: string; answersDigest: string; state: "submitted" | "reviewed"; submittedAt: Date }>(
        `SELECT id,assignment_id AS "assignmentId",author_account_id AS "authorAccountId",answers_ciphertext AS "answersCiphertext",
        answers_digest AS "answersDigest",state,submitted_at AS "submittedAt" FROM ls_forms.form_submissions
        WHERE workspace_id=$1 AND case_id=$2 AND assignment_id=$3 ORDER BY submitted_at,id LIMIT 10`, [actor.workspaceId, caseId, assignmentId]);
      return rows.map((row) => ({
        id: row.id,
        assignmentId: row.assignmentId,
        authorAccountId: row.authorAccountId,
        answers: JSON.parse(unseal(row.answersCiphertext, `form-submission:${actor.workspaceId}:${row.id}`, this.config.keyring)) as FormAnswers,
        answersDigest: row.answersDigest,
        state: row.state,
        submittedAt: new Date(row.submittedAt).toISOString(),
      }));
    });
  }

  async markReviewed(actor: Actor, submissionId: FormSubmissionId, requestId: string): Promise<void> {
    const now = this.clock.now();
    await this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      requirePractitioner(current);
      const submission = await one<{ caseId: CaseId }>(tx, `SELECT case_id AS "caseId" FROM ls_forms.form_submissions WHERE workspace_id=$1 AND id=$2`, [actor.workspaceId, submissionId]);
      if (!submission) throw new AppError("NOT_FOUND");
      caseAccess(current, await loadCase(tx, actor.workspaceId, submission.caseId), await loadGuardians(tx, actor.workspaceId, submission.caseId), "write");
      await tx.query(`UPDATE ls_forms.form_submissions SET state='reviewed',reviewed_by_account_id=$3,reviewed_at=$4
        WHERE workspace_id=$1 AND id=$2 AND state='submitted'`, [actor.workspaceId, submissionId, actor.id, now]);
      await tx.query(`UPDATE ls_forms.form_assignments SET state='reviewed' WHERE workspace_id=$1 AND id=(SELECT assignment_id FROM ls_forms.form_submissions WHERE workspace_id=$1 AND id=$2)`, [actor.workspaceId, submissionId]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "form_reviewed");
    });
  }
}
