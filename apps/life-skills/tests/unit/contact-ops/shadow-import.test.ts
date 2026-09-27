import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { NativeShadowImporter } from "../../../src/features/contact-ops/server/shadow-import.ts";
import type { IdentityStore } from "../../../src/features/identity/store.ts";
import type { Actor } from "../../../src/features/identity/types.ts";
import type { SheetSnapshot } from "../../../src/features/contact-ops/server/import-plan.ts";
import { planImport } from "../../../src/features/contact-ops/server/import-plan.ts";

const actor: Actor = { workspaceId: "00000000-0000-4000-8000-000000000001", id: "00000000-0000-4000-8000-000000000002", personId: "00000000-0000-4000-8000-000000000003", role: "practitioner", state: "active", locale: "en", sessionDigest: "a".repeat(64), expiresAt: Date.now() + 3600000 } as Actor;
const db: IdentityStore = { transaction: async () => { throw new Error("UNEXPECTED_DATABASE_ACCESS"); } };
const ring = { activeKeyId: "synthetic", keys: { synthetic: Buffer.alloc(32, 7) } };
const importer = new NativeShadowImporter(db, ring, Buffer.alloc(32, 6), "synthetic-shadow-integrity-key-20260927", "synthetic-file", 101);
const headers = ["Lead ID", "Parent/adult name", "Phone", "Email", "Pipeline stage"];
const row = ["LS-LEAD-synthetic", "Synthetic", "+15555550111", "", "New inquiry"];
function source(rows: string[][] = [row]): SheetSnapshot { return { fileId: "synthetic-file", sheetId: 101, tab: "Leads", revision: "synthetic-1", complete: true, headers, rows }; }
function decide(snapshot: SheetSnapshot) { return planImport(snapshot, actor.workspaceId, "synthetic-shadow-integrity-key-20260927").rows.map(item => ({ sourceRow: item.sourceRow, sourceRevision: snapshot.revision, legacyId: item.legacyId, rowDigest: item.rowDigest, kind: "new_person" as const })); }

describe("native shadow import preflight", () => {
 it("requires a disposition for every exact source row without entering a database transaction", async () => {
  await expect(importer.importNewPeople(actor, source(), [])).rejects.toThrow("IMPORT_DISPOSITION_INCOMPLETE");
  const approved = decide(source())[0]!;
  await expect(importer.importNewPeople(actor, source(), [approved, { ...approved, sourceRow: 3 }])).rejects.toThrow("IMPORT_DISPOSITION_INCOMPLETE");
  await expect(importer.importNewPeople(actor, source(), [approved, approved])).rejects.toThrow("IMPORT_DISPOSITION_INVALID");
 });
 it("stops shared endpoints and invalid source rows without auto-merging two people", async () => {
  const shared = source([row, ["LS-LEAD-other", "Other", "+15555550111", "", "Prospect"]]);
  await expect(importer.importNewPeople(actor, shared, decide(shared))).rejects.toThrow("IMPORT_SHARED_ENDPOINT_REQUIRES_REVIEW");
  await expect(importer.importNewPeople(actor, source([["bad-id", "Synthetic", "+15555550111", "", "Prospect"]]), [])).rejects.toThrow("IMPORT_PLAN_NEEDS_REVIEW");
  await expect(importer.importNewPeople(actor, { ...source(), complete: false }, decide(source()))).rejects.toThrow("INCOMPLETE_SNAPSHOT");
 });
 it("rejects a malformed nonempty follow-up date before any database work", async () => {
  const bad = { ...source(), headers: [...headers, " Next-action date "], rows: [[...row, "2026-02-31"]] };
  await expect(importer.importNewPeople(actor, bad, decide(bad))).rejects.toThrow("IMPORT_INVALID_FOLLOWUP_DATE");
 });
 it("accepts a tagged midnight spreadsheet date for explicit normalization before database work", async () => {
  const dated = { ...source(), headers: [...headers, "Next-action date"], rows: [[...row, "2026-09-27 00:00:00"]], cellTypes: [[...row.map(() => "s"), "d"]] };
  await expect(importer.importNewPeople(actor, dated, decide(dated))).rejects.toThrow("UNEXPECTED_DATABASE_ACCESS");
 });
 it("does not apply reviewed dispositions to reordered or edited source rows", async () => {
  const other = ["LS-LEAD-other", "Other", "+15555550222", "", "Prospect"];
  const reviewed = source([row, other]);
  const approved = decide(reviewed);
  await expect(importer.importNewPeople(actor, source([other, row]), approved)).rejects.toThrow("IMPORT_DISPOSITION_STALE");
  await expect(importer.importNewPeople(actor, source([[...row.slice(0, 4), "Contacted"], other]), approved)).rejects.toThrow("IMPORT_DISPOSITION_STALE");
  await expect(importer.importNewPeople(actor, { ...reviewed, revision: "synthetic-2" }, approved)).rejects.toThrow("IMPORT_DISPOSITION_STALE");
 });
 it("keeps administrative payment and booking text as unverified source fields", () => {
  const enriched = { ...source(), headers: [...headers, "Payment status", "Booking status"], rows: [[...row, "Paid", "Confirmed"]] };
  const planned = planImport(enriched, actor.workspaceId, "synthetic-shadow-integrity-key-20260927");
  expect(planned.rows[0]?.paymentVerified).toBe(false);
  expect(planned.rows[0]?.protectedPayload.sourceFields).toMatchObject({ "Payment status": "Paid", "Booking status": "Confirmed" });
 });
});
