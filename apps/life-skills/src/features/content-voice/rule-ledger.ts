import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import type { WorkspaceId } from "../../lib/ids.ts";
import type { Actor } from "../identity/types.ts";
import type { IdentityStore, SqlSession } from "../identity/store.ts";
import { one } from "../identity/store.ts";
import { seal, unseal, type Keyring } from "../identity/crypto.ts";
import type { ContentVoiceSnapshot } from "./source.ts";
import { CONTENT_VOICE_FILE_ID } from "./source.ts";
import { composeWritingRule, type RuleEdit, type WritingRuleScope } from "./rule-editor.ts";
import type { CommunityReplyResult } from "../community-reply/bridge.ts";

export type RuleRequest = {
  /** Omitted on existing operations; those remain Community-scoped. */
  scope?: WritingRuleScope;
  operationId: string;
  correction: string;
  rule: string;
  language: "he" | "en" | "both";
  targetRuleId?: string | null;
  sourceSha256: string;
  sourceRevision: string;
  question: string;
  originalUrl?: string;
  previousReply: string;
};
export type RuleStatus = "pending" | "permission_denied" | "conflict" | "unknown" | "saved" | "draft_pending" | "draft_conflict" | "complete";
export type RuleChange = {
  operationId: string;
  actorId: string;
  request: RuleRequest;
  desiredText: string | null;
  desiredSha256: string;
  affectedRuleId: string;
  before: string | null;
  after: string;
  status: RuleStatus;
  draftOperationId: string;
  sourceAfterSha256: string | null;
  sourceAfterRevision: string | null;
  draftResult: CommunityReplyResult | null;
  createdAt: string;
  savedAt: string | null;
  revisedAt: string | null;
};
type Row = {
  operationId: string; actorId: string; requestDigest: string; requestCiphertext: string;
  desiredCiphertext: string | null; desiredSha256: string; affectedRuleId: string;
  beforeCiphertext: string | null; afterCiphertext: string; status: RuleStatus;
  draftOperationId: string; sourceAfterSha256: string | null; sourceAfterRevision: string | null;
  draftResultCiphertext: string | null; createdAt: Date; savedAt: Date | null; revisedAt: Date | null;
};
const columns = `operation_id AS "operationId",actor_account_id AS "actorId",request_digest AS "requestDigest",
 request_ciphertext AS "requestCiphertext",desired_ciphertext AS "desiredCiphertext",desired_sha256 AS "desiredSha256",
 affected_rule_id AS "affectedRuleId",before_excerpt_ciphertext AS "beforeCiphertext",
 after_excerpt_ciphertext AS "afterCiphertext",status,draft_operation_id AS "draftOperationId",
 source_after_sha256 AS "sourceAfterSha256",source_after_revision AS "sourceAfterRevision",
 draft_result_ciphertext AS "draftResultCiphertext",created_at AS "createdAt",saved_at AS "savedAt",revised_at AS "revisedAt"`;
const sha = /^[0-9a-f]{64}$/;
const revision = /^\d+$/;

/** Encrypted retry intent and append-only change history; not a second guide. */
export class VoiceRuleLedger {
  constructor(readonly store: IdentityStore, readonly workspace: WorkspaceId,
    readonly ring: Keyring, readonly lookupKey: Buffer) {
    if (lookupKey.length !== 32) throw new AppError("UNAVAILABLE");
  }
  private owner(actor: Actor) {
    // The identity schema also enforces one practitioner per workspace.
    if (actor.workspaceId !== this.workspace || actor.role !== "practitioner" || actor.state !== "active")
      throw new AppError("FORBIDDEN");
  }
  private aad(operationId: string, kind: string) { return `${this.workspace}:content-voice:${operationId}:${kind}`; }
  private digest(request: RuleRequest) {
    const intent = [
      "content-voice-rule-v1", request.operationId, request.correction, request.rule, request.language,
      request.targetRuleId ?? null, request.sourceSha256, request.sourceRevision, request.question,
      request.originalUrl ?? null, request.previousReply,
    ];
    // Preserve existing Community retry digests. General intent is explicitly
    // bound so reusing an operation cannot widen the owner's selected scope.
    if (request.scope === "general") intent.push("scope:general");
    return createHmac("sha256", this.lookupKey).update(JSON.stringify(intent)).digest("hex");
  }
  private view(row: Row): RuleChange {
    const request = JSON.parse(unseal(row.requestCiphertext, this.aad(row.operationId, "request"), this.ring)) as RuleRequest;
    return {
      operationId: row.operationId, actorId: row.actorId, request,
      desiredText: row.desiredCiphertext ? unseal(row.desiredCiphertext, this.aad(row.operationId, "desired"), this.ring) : null,
      desiredSha256: row.desiredSha256, affectedRuleId: row.affectedRuleId,
      before: row.beforeCiphertext ? unseal(row.beforeCiphertext, this.aad(row.operationId, "before"), this.ring) : null,
      after: unseal(row.afterCiphertext, this.aad(row.operationId, "after"), this.ring),
      status: row.status, draftOperationId: row.draftOperationId,
      sourceAfterSha256: row.sourceAfterSha256, sourceAfterRevision: row.sourceAfterRevision,
      draftResult: row.draftResultCiphertext ? JSON.parse(unseal(row.draftResultCiphertext, this.aad(row.operationId, "reply"), this.ring)) as CommunityReplyResult : null,
      createdAt: row.createdAt.toISOString(), savedAt: row.savedAt?.toISOString() ?? null,
      revisedAt: row.revisedAt?.toISOString() ?? null,
    };
  }
  private async history(tx: SqlSession, actor: Actor, operationId: string, state: string,
    sourceSha256: string | null, sourceRevision: string | null, at: Date) {
    await tx.query(`INSERT INTO ls_content_voice.rule_change_history
     (workspace_id,event_id,operation_id,actor_account_id,state,source_sha256,source_revision,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [this.workspace, randomUUID(), operationId, actor.id, state, sourceSha256, sourceRevision, at]);
  }
  async get(actor: Actor, operationId: string): Promise<RuleChange | null> {
    this.owner(actor);
    return this.store.transaction(async tx => {
      const row = await one<Row>(tx, `SELECT ${columns} FROM ls_content_voice.rule_changes
       WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3`,
      [this.workspace, operationId, actor.id]);
      return row ? this.view(row) : null;
    });
  }
  async getForRequest(actor: Actor, request: RuleRequest): Promise<RuleChange | null> {
    const existing = await this.get(actor, request.operationId);
    if (existing && this.digest(request) !== this.digest(existing.request)) throw new AppError("CONFLICT");
    return existing;
  }
  async prepare(actor: Actor, request: RuleRequest, snapshot: ContentVoiceSnapshot): Promise<RuleChange | RuleEdit> {
    this.owner(actor);
    const existing = await this.getForRequest(actor, request);
    if (existing) return existing;
    if (!sha.test(request.sourceSha256) || !revision.test(request.sourceRevision) ||
        request.sourceSha256 !== snapshot.sha256 || request.sourceRevision !== snapshot.driveRevision)
      return { state: "needs_review", text: snapshot.text, ruleId: null, before: null, after: null, sha256: snapshot.sha256 };
    const plan = composeWritingRule(snapshot.text, {
      operationId: request.operationId, rule: request.rule, language: request.language,
      scope: request.scope ?? "community",
      targetRuleId: request.targetRuleId ?? null, at: new Date().toISOString(),
    });
    if (plan.state !== "ready" || !plan.ruleId || !plan.after) return plan;
    const digest = this.digest(request), at = new Date();
    return this.store.transaction(async tx => {
      const inserted = await tx.query<{ operationId: string }>(`INSERT INTO ls_content_voice.rule_changes
       (workspace_id,operation_id,actor_account_id,request_digest,source_file_id,source_before_sha256,
        source_before_revision,desired_sha256,desired_ciphertext,request_ciphertext,before_excerpt_ciphertext,
        after_excerpt_ciphertext,affected_rule_id,language,draft_operation_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
       ON CONFLICT(workspace_id,operation_id) DO NOTHING RETURNING operation_id AS "operationId"`,
      [this.workspace, request.operationId, actor.id, digest, CONTENT_VOICE_FILE_ID,
        snapshot.sha256, snapshot.driveRevision, plan.sha256,
        seal(plan.text, this.aad(request.operationId, "desired"), this.ring),
        seal(JSON.stringify(request), this.aad(request.operationId, "request"), this.ring),
        plan.before ? seal(plan.before, this.aad(request.operationId, "before"), this.ring) : null,
        seal(plan.after!, this.aad(request.operationId, "after"), this.ring),
        plan.ruleId, request.language, randomUUID(), at]);
      const row = await one<Row>(tx, `SELECT ${columns} FROM ls_content_voice.rule_changes
       WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3`,
      [this.workspace, request.operationId, actor.id]);
      if (!row || row.requestDigest !== digest) throw new AppError("CONFLICT");
      if (inserted.length) await this.history(tx, actor, request.operationId, "prepared", snapshot.sha256, snapshot.driveRevision, at);
      return this.view(row);
    });
  }
  async markSourceResult(actor: Actor, operationId: string,
    outcome: "saved" | "permission_denied" | "conflict" | "unknown",
    snapshot: ContentVoiceSnapshot | null): Promise<RuleChange> {
    this.owner(actor);
    return this.store.transaction(async tx => {
      const row = await one<Row>(tx, `SELECT ${columns} FROM ls_content_voice.rule_changes
       WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 FOR UPDATE`,
      [this.workspace, operationId, actor.id]);
      if (!row) throw new AppError("NOT_FOUND");
      if (["saved", "draft_pending", "draft_conflict", "complete"].includes(row.status)) return this.view(row);
      if (row.status === outcome && outcome !== "saved") return this.view(row);
      if (outcome === "saved" && (!snapshot || snapshot.sha256 !== row.desiredSha256)) throw new AppError("CONFLICT");
      const at = new Date();
      const changed = await one<Row>(tx, `UPDATE ls_content_voice.rule_changes SET
       status=$4,source_after_sha256=$5,source_after_revision=$6,saved_at=$7,
       desired_ciphertext=CASE WHEN $4='saved' THEN NULL ELSE desired_ciphertext END,updated_at=$8
       WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 RETURNING ${columns}`,
      [this.workspace, operationId, actor.id, outcome, outcome === "saved" ? snapshot!.sha256 : null,
        outcome === "saved" ? snapshot!.driveRevision : null, outcome === "saved" ? at : null, at]);
      if (!changed) throw new AppError("UNAVAILABLE");
      await this.history(tx, actor, operationId, outcome, snapshot?.sha256 ?? null, snapshot?.driveRevision ?? null, at);
      return this.view(changed);
    });
  }
  async markDraft(actor: Actor, operationId: string, reply: CommunityReplyResult | null): Promise<RuleChange> {
    this.owner(actor);
    return this.store.transaction(async tx => {
      const row = await one<Row>(tx, `SELECT ${columns} FROM ls_content_voice.rule_changes
       WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 FOR UPDATE`,
      [this.workspace, operationId, actor.id]);
      if (!row) throw new AppError("NOT_FOUND");
      if (row.status === "complete") return this.view(row);
      if (!["saved", "draft_pending"].includes(row.status)) throw new AppError("CONFLICT");
      if (reply && (reply.operationId !== row.draftOperationId ||
          reply.provenance.guide.sha256 !== row.sourceAfterSha256 ||
          reply.provenance.guide.driveRevision !== row.sourceAfterRevision)) throw new AppError("CONFLICT");
      if (!reply && row.status === "draft_pending") return this.view(row);
      const at = new Date(), status = reply ? "complete" : "draft_pending";
      const changed = await one<Row>(tx, `UPDATE ls_content_voice.rule_changes SET
       status=$4,draft_result_ciphertext=$5,revised_at=$6,updated_at=$7
       WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 RETURNING ${columns}`,
      [this.workspace, operationId, actor.id, status,
        reply ? seal(JSON.stringify(reply), this.aad(operationId, "reply"), this.ring) : null, reply ? at : null, at]);
      if (!changed) throw new AppError("UNAVAILABLE");
      await this.history(tx, actor, operationId, status, row.sourceAfterSha256, row.sourceAfterRevision, at);
      return this.view(changed);
    });
  }
  /** The rule stays saved, but an older source-bound draft cannot be resumed after source drift. */
  async markDraftSourceConflict(actor: Actor, operationId: string, snapshot: ContentVoiceSnapshot): Promise<RuleChange> {
    this.owner(actor);
    return this.store.transaction(async tx => {
      const row = await one<Row>(tx, `SELECT ${columns} FROM ls_content_voice.rule_changes
       WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 FOR UPDATE`,
      [this.workspace, operationId, actor.id]);
      if (!row) throw new AppError("NOT_FOUND");
      if (row.status === "complete" || row.status === "draft_conflict") return this.view(row);
      if (!["saved", "draft_pending"].includes(row.status) || !row.savedAt ||
        (snapshot.sha256 === row.sourceAfterSha256 && snapshot.driveRevision === row.sourceAfterRevision))
        throw new AppError("CONFLICT");
      const at = new Date();
      const changed = await one<Row>(tx, `UPDATE ls_content_voice.rule_changes SET status='draft_conflict',updated_at=$4
       WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3 RETURNING ${columns}`,
      [this.workspace, operationId, actor.id, at]);
      if (!changed) throw new AppError("UNAVAILABLE");
      await this.history(tx, actor, operationId, "draft_conflict", snapshot.sha256, snapshot.driveRevision, at);
      return this.view(changed);
    });
  }
}
