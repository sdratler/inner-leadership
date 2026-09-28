import { afterAll, expect, test, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
import { fixture, poolStore } from "../calendar/fixture.ts";
import { VoiceRuleLedger, type RuleRequest } from "../../../src/features/content-voice/rule-ledger.ts";
import type { ContentVoiceSnapshot } from "../../../src/features/content-voice/source.ts";
import type { CommunityReplyResult } from "../../../src/features/community-reply/bridge.ts";
import { voiceRuleSchemaCatalogMatches } from "../../../src/db/contact-ops-production-guard.ts";

const f = await fixture();
afterAll(async () => { await f.pool.end(); });
const ledger = new VoiceRuleLedger(poolStore(f.pool), f.workspaceId, f.keyring, randomBytes(32));
const text = `# Synthetic Content Voice\n**Profile ID:** LS-CONTENT-VOICE\n**Version:** 2.0\n\n## 1. Voice\n\nBe direct.\n\n## 2. Article structure\n\nKeep the order.\n`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const snapshot: ContentVoiceSnapshot = { title: "Synthetic guide", sourceUrl: "https://example.invalid/guide",
  declaredVersion: "2.0", driveRevision: "13", modifiedAt: "2026-09-27T00:00:00.000Z",
  checkedAt: "2026-09-28T00:00:00.000Z", sha256: hash(text), text };
const request = (operationId = randomUUID()): RuleRequest => ({ operationId, correction: "Please make this shorter.",
  rule: "Keep community replies short and conversational.", language: "en", sourceSha256: snapshot.sha256,
  sourceRevision: snapshot.driveRevision, question: "Synthetic public question about daily routines?",
  previousReply: "A deliberately verbose synthetic community reply." });

test("native PostgreSQL encrypts a retryable correction and records exact source/draft provenance", async () => {
  const command = request();
  const prepared = await ledger.prepare(f.practitioner.actor, command, snapshot);
  expect(prepared).toMatchObject({ status: "pending", request: command });
  if (!("status" in prepared)) throw Error("not prepared");
  expect(prepared.desiredText).toContain("Community-reply writing preferences");
  const replay = await ledger.prepare(f.practitioner.actor, command, { ...snapshot, driveRevision: "99" });
  expect(replay).toMatchObject({ operationId: command.operationId, desiredSha256: prepared.desiredSha256 });
  await expect(ledger.getForRequest(f.practitioner.actor, { ...command, rule: "Different rule" })).rejects.toThrow("CONFLICT");
  const encrypted = await f.pool.query("SELECT request_ciphertext,desired_ciphertext FROM ls_content_voice.rule_changes WHERE workspace_id=$1 AND operation_id=$2",
    [f.workspaceId, command.operationId]);
  expect(encrypted.rows[0]?.request_ciphertext).not.toContain(command.correction);
  expect(encrypted.rows[0]?.desired_ciphertext).not.toContain(command.rule);

  const savedSource = { ...snapshot, text: prepared.desiredText!, sha256: prepared.desiredSha256,
    driveRevision: "14", declaredVersion: "2.1", checkedAt: "2026-09-28T00:01:00.000Z" };
  const saved = await ledger.markSourceResult(f.practitioner.actor, command.operationId, "saved", savedSource);
  expect(saved).toMatchObject({ status: "saved", desiredText: null, sourceAfterSha256: savedSource.sha256,
    sourceAfterRevision: "14" });
  expect(await ledger.markSourceResult(f.practitioner.actor, command.operationId, "saved", savedSource))
    .toMatchObject({ status: "saved" });
  expect(await ledger.markDraft(f.practitioner.actor, command.operationId, null)).toMatchObject({ status: "draft_pending" });
  const provenance = { id: "synthetic", sha256: savedSource.sha256, driveRevision: "14", declaredVersion: "2.1",
    modifiedAt: savedSource.modifiedAt, checkedAt: savedSource.checkedAt };
  const draft: CommunityReplyResult = { operationId: prepared.draftOperationId,
    reply: "A concise synthetic revised reply.", copyAllowed: true, reviewFlags: [], suggestedRule: "", ruleScope: "",
    originalUrl: null, provenance: { guide: { ...provenance, includedCommunityRuleIds: [prepared.affectedRuleId] }, playbook: provenance, policyVersion: "synthetic",
      generatedAt: "2026-09-28T00:02:00.000Z", model: "synthetic", usage: { inputTokens: 1, outputTokens: 1 } } };
  const complete = await ledger.markDraft(f.practitioner.actor, command.operationId, draft);
  expect(complete).toMatchObject({ status: "complete", draftResult: draft });
  expect(await ledger.markDraft(f.practitioner.actor, command.operationId, draft)).toMatchObject({ status: "complete" });
  const history = await f.pool.query("SELECT state FROM ls_content_voice.rule_change_history WHERE workspace_id=$1 AND operation_id=$2 ORDER BY occurred_at",
    [f.workspaceId, command.operationId]);
  expect(history.rows.map(row => row.state)).toEqual(["prepared", "saved", "draft_pending", "complete"]);
  await expect(f.pool.query("DELETE FROM ls_content_voice.rule_change_history WHERE workspace_id=$1 AND operation_id=$2",
    [f.workspaceId, command.operationId])).rejects.toThrow("append_only");
});

test("native PostgreSQL denies a parent and records permission-denied without claiming a save", async () => {
  const command = request();
  await expect(ledger.prepare(f.parent.actor, command, snapshot)).rejects.toThrow("FORBIDDEN");
  await expect(ledger.get(f.parent.actor, command.operationId)).rejects.toThrow("FORBIDDEN");
  const prepared = await ledger.prepare(f.practitioner.actor, command, snapshot);
  expect(prepared).toHaveProperty("status", "pending");
  const denied = await ledger.markSourceResult(f.practitioner.actor, command.operationId, "permission_denied", snapshot);
  expect(denied).toMatchObject({ status: "permission_denied", savedAt: null, sourceAfterSha256: null });
  await expect(ledger.markDraft(f.practitioner.actor, command.operationId, null)).rejects.toThrow("CONFLICT");
});

test("native PostgreSQL verifies the production runner's exact catalog, index, FK, history and ACL readbacks", async () => {
  const runner = readFileSync(new URL("../../../scripts/apply-contact-ops-production.ts", import.meta.url), "utf8");
  const sql = (name: string) => {
    const marker = runner.indexOf(`const ${name}=`), start = runner.indexOf("`", marker), end = runner.indexOf("`);", start);
    if (marker < 0 || start < 0 || end < 0) throw Error("READBACK_SQL_MISSING");
    return runner.slice(start + 1, end);
  };
  const objectsSql = sql("voiceObjects"), columnsSql = sql("voiceColumns"), constraintsSql = sql("voiceConstraints");
  const objects = (await f.pool.query(objectsSql)).rows[0];
  expect(objects).toEqual({ namespaceAbsent: false, tables: true, foreignKeys: true, ownerIndex: true,
    historyImmutable: true, publicRevoked: true });
  const columns = (await f.pool.query(columnsSql)).rows[0].catalog;
  const constraints = (await f.pool.query(constraintsSql)).rows[0].catalog;
  expect(voiceRuleSchemaCatalogMatches(columns, constraints)).toBe(true);
  expect(voiceRuleSchemaCatalogMatches(columns.slice(1), constraints)).toBe(false);
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP INDEX ls_content_voice.rule_changes_by_owner_time");
    await client.query("GRANT SELECT ON ls_content_voice.rule_changes TO PUBLIC");
    await client.query("ALTER TABLE ls_content_voice.rule_change_history DISABLE TRIGGER rule_change_history_immutable");
    const drift = (await client.query(objectsSql)).rows[0];
    expect(drift).toMatchObject({ ownerIndex: false, publicRevoked: false, historyImmutable: false });
  } finally { await client.query("ROLLBACK"); client.release(); }
  expect((await f.pool.query(objectsSql)).rows[0]).toEqual(objects);
});
