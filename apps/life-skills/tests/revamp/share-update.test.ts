import { test } from "node:test";
import assert from "node:assert/strict";
import { shareUpdate, shareDigest, readSharedRecap, type ShareRepository, type ShareReceipt } from "../../src/features/session-workflow/recap.ts";
import type { SharedRecapRecord } from "../../src/features/session-workflow/types.ts";
import { owner, child, parent, context, recap, NOW, clone } from "./fixtures.ts";
function fixture() { const s = { actor: clone(owner), context: clone(context), recap: clone(recap), publications: [] as SharedRecapRecord[], receipts: new Map<string, ShareReceipt>() }; const repo: ShareRepository = { async transaction(_id, fn) { return fn({ async freshContext() { return { actor: s.actor, context: s.context }; }, async currentRecap() { return clone(s.recap); }, async receipt(k) { return s.receipts.get(k) ?? null; }, async savePublication(r, receipt) { s.publications.push(clone(r)); s.receipts.set(receipt.idempotencyKey, clone(receipt)); } }); } }; const request = { sessionId: "session-a", idempotencyKey: "key1", expectedVersion: 1, expectedDigest: shareDigest(recap, ["child-a", "parent-a"]), recipientAccountIds: ["child-a", "parent-a"], publicationId: "pub1", now: NOW }; return { s, repo, request }; }
test("share stores one explicit version for child and parent", async () => { const { s, repo, request } = fixture(); const r = await shareUpdate(repo, request); assert.equal(s.publications.length, 1); assert.deepEqual(readSharedRecap(child, context, r), readSharedRecap(parent, context, r)); assert.equal("analysis" in r.recap, false); });
test("retry same share returns existing publication", async () => { const { s, repo, request } = fixture(); await shareUpdate(repo, request); await shareUpdate(repo, request); assert.equal(s.publications.length, 1); });
test("parent cannot publish a routine recap", async () => { const { s, repo, request } = fixture(); s.actor = clone(parent); await assert.rejects(() => shareUpdate(repo, request), /NOT_FOUND/); });
test("changed content cannot reuse old reviewed digest", async () => { const { s, repo, request } = fixture(); s.recap.nextStep = "Different content"; await assert.rejects(() => shareUpdate(repo, request), /STALE_RECAP/); });
test("changed version cannot reuse idempotency receipt", async () => { const { repo, request } = fixture(); await shareUpdate(repo, request); await assert.rejects(() => shareUpdate(repo, { ...request, expectedVersion: 2 }), /IDEMPOTENCY_CONFLICT/); });
test("recipient not authorized for this case denied", async () => { const { repo, request } = fixture(); await assert.rejects(() => shareUpdate(repo, { ...request, recipientAccountIds: ["stranger"] }), /SHARE_AUDIENCE/); });
test("revocation rechecked even for repeated share", async () => { const { s, repo, request } = fixture(); await shareUpdate(repo, request); s.context.members = s.context.members.map(m => ({ ...m, active: false })); await assert.rejects(() => shareUpdate(repo, request), /SHARE_AUDIENCE/); });
test("private assignment cannot ride in shared recap", async () => { const { s, repo, request } = fixture(); s.recap.practices = s.recap.practices.map(p => ({ ...p, audienceAccountIds: ["child-a"] })); await assert.rejects(() => shareUpdate(repo, { ...request, expectedDigest: shareDigest(s.recap, request.recipientAccountIds) }), /NOT_SHARED_WITH_ALL/); });
test("later guardian is not granted old publication by default", async () => { const { repo, request } = fixture(); const r = await shareUpdate(repo, request); const newParent = { ...parent, accountId: "parent-new", personId: "person-new" }; const c = { ...context, members: [...context.members, { ...newParent, role: "parent" as const, routineRecap: true }] }; assert.throws(() => readSharedRecap(newParent, c, r), /NOT_FOUND/); });
test("cross-case read is denied", async () => { const { repo, request } = fixture(); const r = await shareUpdate(repo, request); assert.throws(() => readSharedRecap(owner, { ...context, caseId: "other" }, r), /NOT_FOUND/); });
test("nested private data is rejected rather than reaching recipients", async () => {
    const { validateRecap } = await import("../../src/features/session-workflow/recap.ts");
    const f = await import("./fixtures.ts");
    const r = structuredClone(f.recap);
    Object.assign(r.attendance, { privateNote: "PRIVATE_CANARY_NOT_FOR_RECIPIENT" });
    assert.throws(() => validateRecap(r), /RECAP_ATTENDANCE_FIELDS/);
});
