import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SqlPreEnrollmentRepository } from "../../src/features/forms/pre-enrollment/repository.ts";
import { PreEnrollmentService, type PreEnrollmentRepository } from "../../src/features/forms/pre-enrollment/service.ts";
import { PreEnrollmentStaffService } from "../../src/features/forms/pre-enrollment/staff.ts";
import { publicConsentHash } from "../../src/features/forms/pre-enrollment/consent.ts";
import type { IdentityStore, SqlSession } from "../../src/features/identity/store.ts";
import type { Actor } from "../../src/features/identity/types.ts";

type DbTx = { query<T extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>; exec(text: string): Promise<unknown> };
type Db = DbTx & { transaction<T>(work: (tx: DbTx) => Promise<T>): Promise<T>; close(): Promise<void> };
type PGliteCtor = new (path?: string) => Db;
const workspace = "00000000-0000-4000-8000-000000000001";
const otherWorkspace = "00000000-0000-4000-8000-000000000002";
const practitioner = "00000000-0000-4000-8000-000000000003";
const parent = "00000000-0000-4000-8000-000000000004";
const otherPractitioner = "00000000-0000-4000-8000-000000000005";
const now = new Date("2029-01-01T12:00:00.000Z");
const ring = { activeKeyId: "k", keys: { k: Buffer.alloc(32, 1) } };
const consent = { version: "test-source-20260916", sourceHashes: ["701cce537e8cc14f94b593cc6c321330ee0275207386ff8137f259630ca5e073", "3d9dc543abeee4d168130d3ab63d6a66b9367aab218868f30b05b78bfbc1f73d"], displayText: ["Synthetic source-controlled display text."], acknowledgements: ["One.", "Two.", "Three."] };
process.env.LS_INTAKE_PUBLIC_CONSENT_JSON = JSON.stringify(consent);
function bindOpening(token: string, stableLeadRef: string) { process.env.LS_INTAKE_PRIVATE_OPENINGS_JSON = JSON.stringify([{ tokenDigest: createHash("sha256").update(token).digest("hex"), stableLeadRef, message: "Synthetic private opening." }]); }

function store(db: Db): IdentityStore { return { transaction: <T>(work: (tx: SqlSession) => Promise<T>) => db.transaction(tx => work({ query: <R extends object>(text: string, values: readonly unknown[] = []): Promise<R[]> => tx.query<R>(text, values).then(result => result.rows) })) }; }
function sessionDigest(id: string) { return id.replaceAll("-", "").padEnd(64, "0"); }
function actor(id: string, role: Actor["role"], workspaceId = workspace): Actor { return { id: id as Actor["id"], personId: id as Actor["personId"], workspaceId: workspaceId as Actor["workspaceId"], role, state: "active", locale: "en", sessionDigest: sessionDigest(id), expiresAt: now.getTime() + 86_400_000 }; }
async function migrate(db: Db) {
  await db.exec("CREATE SCHEMA ls_control");
  for (const name of ["0001_ls_foundation.sql", "0010_ls_identity_cases_20260906.sql", "0091_ls_pre_enrollment.sql"]) await db.exec(await readFile(join("migrations", name), "utf8"));
  for (const id of [workspace, otherWorkspace]) await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)", [id, now]);
  for (const [id, workspaceId, role] of [[practitioner, workspace, "practitioner"], [parent, workspace, "parent"], [otherPractitioner, otherWorkspace, "practitioner"]] as const) {
    await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','sealed',$3)", [id, workspaceId, now]);
    await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'sealed',$5,'hash',$5,$5)", [id, workspaceId, role, `${id.replaceAll("-", "").slice(0, 64)}`.padEnd(64, "0"), now]);
    await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)", [workspaceId, id]);
    await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)", [sessionDigest(id), workspaceId, id, now, new Date(now.getTime() + 86_400_000)]);
  }
}
function payload(slots: readonly string[], overrides: Record<string, unknown> = {}) { return { parentName: "Synthetic Parent", contactNumber: "+972500000000", preferredLanguage: "he", email: "", children: slots.map((childSlotId, index) => ({ childSlotId, firstName: `Child ${index}`, age: 8 })), locationPreference: "synthetic-location", arrivalNeeds: "", availableDays: ["sun"], timeWindows: ["afternoon"], availabilityNote: "", privateContext: "private synthetic context", cp01: "not_now", willingToBeContacted: "yes", accessSupportNeeded: "no", consentAcknowledgements: [true, true, true], consentVersion: consent.version, consentHash: publicConsentHash(consent), signerName: "Synthetic Signer", ...overrides }; }
async function cleanupMkdtemp(directory: string) {
  const target = resolve(directory), temp = resolve(tmpdir()), pathWithinTemp = relative(temp, target);
  if (pathWithinTemp === "" || pathWithinTemp.startsWith("..") || !basename(target).startsWith("ls-intake-")) throw new Error("unsafe intake test cleanup target");
  await rm(target, { recursive: true, force: true });
}

describe("pre-enrollment PGlite", () => {
  it("uses real identity state for issue, exchange, submit, immutable history, authorization and durable ciphertext", async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE!); const directory = await mkdtemp(join(tmpdir(), "ls-intake-")); const connection = new (PGlite as unknown as PGliteCtor)(directory);
    try {
      await migrate(connection); const identity = store(connection); const staff = new PreEnrollmentStaffService(identity, ring, () => now);
      const issued = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-synthetic", 2); bindOpening(issued.token, "LS-LEAD-synthetic");
      const service = new PreEnrollmentService(new SqlPreEnrollmentRepository(identity, workspace), ring, () => now, true, workspace);
      const exchange = await service.exchange(issued.token); expect(exchange.consent).toMatchObject({ version: consent.version, hash: publicConsentHash(consent), sourceHashes: consent.sourceHashes }); expect(exchange.childSlotIds).toHaveLength(2);
      const first = await service.submit(issued.token, randomUUID(), payload(exchange.childSlotIds));
      const history = await staff.history(actor(practitioner, "practitioner"), first.receiptId); expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ kind: "original", actorAccountId: null, consent: { hash: publicConsentHash(consent), acknowledgements: consent.acknowledgements } }); expect(history[0]!.input).toEqual(payload(exchange.childSlotIds));
      await staff.amend(actor(practitioner, "practitioner"), first.receiptId, payload(exchange.childSlotIds, { locationPreference: "changed" }));
      expect((await staff.history(actor(practitioner, "practitioner"), first.receiptId)).map(row => row.kind)).toEqual(["original", "amendment"]);
      await expect(staff.amend(actor(practitioner, "practitioner"), first.receiptId, payload([...exchange.childSlotIds].reverse()))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(staff.history(actor(parent, "parent"), first.receiptId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(new PreEnrollmentStaffService(identity, ring, () => now).history(actor(otherPractitioner, "practitioner", otherWorkspace), first.receiptId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const row = await connection.query<{ payload_ciphertext: string }>("SELECT payload_ciphertext FROM ls_intake.pre_enrollment_receipts"); expect(row.rows[0]!.payload_ciphertext).not.toContain("Synthetic Parent");
      await connection.close(); const reopened = new (PGlite as unknown as PGliteCtor)(directory); expect((await reopened.query("SELECT receipt_id FROM ls_intake.pre_enrollment_receipts")).rows).toHaveLength(1); await reopened.close();
    } finally { await cleanupMkdtemp(directory); }
  }, 30_000);

  it("rejects expired, revoked, false or stale consent and preserves retry semantics", async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE!); const connection = new (PGlite as unknown as PGliteCtor)();
    try {
      await migrate(connection); const identity = store(connection), staff = new PreEnrollmentStaffService(identity, ring, () => now);
      const expired = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-expired", 1); bindOpening(expired.token, "LS-LEAD-expired"); const later = new PreEnrollmentService(new SqlPreEnrollmentRepository(identity, workspace), ring, () => new Date(now.getTime() + 8 * 86_400_000), true, workspace); await expect(later.exchange(expired.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const revoked = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-revoked", 1); bindOpening(revoked.token, "LS-LEAD-revoked"); await connection.query("UPDATE ls_intake.pre_enrollment_invitations SET revoked_at=$1 WHERE token_digest=$2", [now, (await import("node:crypto")).createHash("sha256").update(revoked.token).digest("hex")]); const service = new PreEnrollmentService(new SqlPreEnrollmentRepository(identity, workspace), ring, () => now, true, workspace); await expect(service.exchange(revoked.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const active = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-active", 1); bindOpening(active.token, "LS-LEAD-active"); const slots = (await service.exchange(active.token)).childSlotIds; await expect(service.submit(active.token, randomUUID(), payload(slots, { consentAcknowledgements: [true, false, true] }))).rejects.toBeTruthy(); await expect(service.submit(active.token, randomUUID(), payload(slots, { consentHash: "0".repeat(64) }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      const key = randomUUID(), accepted = payload(slots), first = await service.submit(active.token, key, accepted), duplicate = await service.submit(active.token, key, accepted); expect(duplicate).toMatchObject({ receiptId: first.receiptId, duplicate: true }); await expect(service.submit(active.token, key, payload(slots, { locationPreference: "different" }))).rejects.toMatchObject({ code: "CONFLICT" });
      const concurrent = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-concurrent", 1); bindOpening(concurrent.token, "LS-LEAD-concurrent"); const concurrentSlots = (await service.exchange(concurrent.token)).childSlotIds;
      const contenders = await Promise.allSettled([service.submit(concurrent.token, randomUUID(), payload(concurrentSlots)), service.submit(concurrent.token, randomUUID(), payload(concurrentSlots))]); expect(contenders.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(contenders.filter(result => result.status === "rejected")).toHaveLength(1);
      const failing = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-failure", 1); bindOpening(failing.token, "LS-LEAD-failure"); const failingSlots = (await service.exchange(failing.token)).childSlotIds, repository = new SqlPreEnrollmentRepository(identity, workspace);
      const failAfterInsert: PreEnrollmentRepository = {
        transaction: work => repository.transaction(async tx => {
          const failedTx: PreEnrollmentRepository = { transaction: nested => tx.transaction(nested), findToken: digest => tx.findToken(digest), findReceiptByIdempotency: (digest, key) => tx.findReceiptByIdempotency(digest, key), insertReceipt: async row => { await tx.insertReceipt(row); throw new Error("simulated failure after receipt insert"); }, consumeToken: (digest, at) => tx.consumeToken(digest, at) };
          return work(failedTx);
        }),
        findToken: digest => repository.findToken(digest), findReceiptByIdempotency: (digest, key) => repository.findReceiptByIdempotency(digest, key), insertReceipt: row => repository.insertReceipt(row), consumeToken: (digest, at) => repository.consumeToken(digest, at),
      };
      await expect(new PreEnrollmentService(failAfterInsert, ring, () => now, true, workspace).submit(failing.token, randomUUID(), payload(failingSlots))).rejects.toThrow("simulated failure after receipt insert");
      const persisted = await connection.query<{ receiptCount: number; consumedAt: Date | null }>("SELECT count(r.receipt_id)::int AS \"receiptCount\",i.consumed_at AS \"consumedAt\" FROM ls_intake.pre_enrollment_invitations i LEFT JOIN ls_intake.pre_enrollment_receipts r ON r.workspace_id=i.workspace_id AND r.invitation_id=i.invitation_id WHERE i.workspace_id=$1 AND i.token_digest=$2 GROUP BY i.consumed_at", [workspace, createHash("sha256").update(failing.token).digest("hex")]); expect(persisted.rows).toEqual([{ receiptCount: 0, consumedAt: null }]); expect((await service.exchange(failing.token)).childSlotIds).toEqual(failingSlots); await expect(service.submit(failing.token, randomUUID(), payload(failingSlots))).resolves.toMatchObject({ duplicate: false });
    } finally { await connection.close(); }
  }, 30_000);
});
