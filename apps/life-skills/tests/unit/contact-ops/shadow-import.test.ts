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

describe("native shadow import preflight", () => {
 it("requires a disposition for every exact source row without entering a database transaction", async () => {
  await expect(importer.importNewPeople(actor, source(), [])).rejects.toThrow("IMPORT_DISPOSITION_INCOMPLETE");
  await expect(importer.importNewPeople(actor, source(), [{ sourceRow: 2, kind: "new_person" }, { sourceRow: 3, kind: "new_person" }])).rejects.toThrow("IMPORT_DISPOSITION_INCOMPLETE");
  await expect(importer.importNewPeople(actor, source(), [{ sourceRow: 2, kind: "new_person" }, { sourceRow: 2, kind: "new_person" }])).rejects.toThrow("IMPORT_DISPOSITION_INVALID");
 });
 it("stops shared endpoints and invalid source rows without auto-merging two people", async () => {
  await expect(importer.importNewPeople(actor, source([row, ["LS-LEAD-other", "Other", "+15555550111", "", "Prospect"]]), [{ sourceRow: 2, kind: "new_person" }, { sourceRow: 3, kind: "new_person" }])).rejects.toThrow("IMPORT_SHARED_ENDPOINT_REQUIRES_REVIEW");
  await expect(importer.importNewPeople(actor, source([["bad-id", "Synthetic", "+15555550111", "", "Prospect"]]), [{ sourceRow: 2, kind: "new_person" }])).rejects.toThrow("IMPORT_PLAN_NEEDS_REVIEW");
  await expect(importer.importNewPeople(actor, { ...source(), complete: false }, [{ sourceRow: 2, kind: "new_person" }])).rejects.toThrow("INCOMPLETE_SNAPSHOT");
 });
 it("keeps administrative payment and booking text as unverified source fields", () => {
  const enriched = { ...source(), headers: [...headers, "Payment status", "Booking status"], rows: [[...row, "Paid", "Confirmed"]] };
  const planned = planImport(enriched, actor.workspaceId, "synthetic-shadow-integrity-key-20260927");
  expect(planned.rows[0]?.paymentVerified).toBe(false);
  expect(planned.rows[0]?.protectedPayload.sourceFields).toMatchObject({ "Payment status": "Paid", "Booking status": "Confirmed" });
 });
});
