import { afterAll, expect, test, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
import { fixture, poolStore } from "../calendar/fixture.ts";
import { seal, unseal } from "../../../src/features/identity/crypto.ts";
import { NativeShadowImporter } from "../../../src/features/contact-ops/server/shadow-import.ts";
import { crmProfileAad, NativeCrmStore } from "../../../src/features/contact-ops/server/native-store.ts";
import type { SheetSnapshot } from "../../../src/features/contact-ops/server/import-plan.ts";
import { planImport } from "../../../src/features/contact-ops/server/import-plan.ts";

const f = await fixture();
afterAll(async () => { await f.pool.end(); });
const key = "synthetic-shadow-import-integrity-key-20260927";
const lookupKey = Buffer.alloc(32, 6);
const sourceFileId = `synthetic-${randomUUID()}`;
const sheetId = 101;
const importer = new NativeShadowImporter(poolStore(f.pool), f.keyring, lookupKey, key, sourceFileId, sheetId);
const headers = ["Lead ID", "Parent/adult name", "Phone", "Email", "Pipeline stage", " Next action ", " Next-action date ", " General sales notes "];
const one = ["LS-LEAD-synthetic-one", "Synthetic Adult One", "+15555550101", "one@example.invalid", "New inquiry", "Call", "2026-09-27", "Synthetic administrative note one"];
const two = ["LS-LEAD-synthetic-two", "", "+15555550102", "", "Contacted", "Follow up", "", "Synthetic administrative note two"];
function snapshot(rows: string[][] = [one, two], fileId = sourceFileId): SheetSnapshot {
 return { fileId, sheetId, tab: "Leads", revision: "synthetic-revision-1", complete: true, headers, rows };
}
function decide(source: SheetSnapshot) { return planImport(source, f.workspaceId, key).rows.map(row => ({ sourceRow: row.sourceRow, sourceRevision: source.revision, legacyId: row.legacyId, rowDigest: row.rowDigest, kind: "new_person" as const })); }

test("native PostgreSQL imports all synthetic rows encrypted in one shadow transaction and exact replay is a no-op", async () => {
 const before = await f.pool.query("SELECT count(*)::integer AS n FROM ls_identity.people WHERE workspace_id=$1", [f.workspaceId]);
 const decisions = decide(snapshot());
 expect(await importer.importNewPeople(f.practitioner.actor, snapshot(), decisions)).toEqual({ sourceRevision: "synthetic-revision-1", planned: 2, created: 2, replayed: 0 });
 expect(await importer.importNewPeople(f.practitioner.actor, snapshot(), decisions)).toEqual({ sourceRevision: "synthetic-revision-1", planned: 2, created: 0, replayed: 2 });
 const after = await f.pool.query("SELECT count(*)::integer AS n FROM ls_identity.people WHERE workspace_id=$1", [f.workspaceId]);
 expect(after.rows[0].n - before.rows[0].n).toBe(2);
 const links = await f.pool.query("SELECT legacy_lead_id,person_id,row_digest,snapshot_ciphertext FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 ORDER BY legacy_lead_id", [f.workspaceId, sourceFileId]);
 expect(links.rowCount).toBe(2);
 expect(new Set(links.rows.map(row => row.person_id)).size).toBe(2);
 const linkedAccountId = randomUUID(), linkedPersonId = links.rows.find(row => row.legacy_lead_id === one[0])!.person_id;
 await f.pool.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,phone_ciphertext,created_at,updated_at)
  VALUES($1,$2,'parent','invited','en',$3,$4,$5,clock_timestamp(),clock_timestamp())`,
  [linkedAccountId, f.workspaceId, createHash("sha256").update(linkedAccountId).digest("hex"), seal("synthetic-linked@example.invalid", `email:${f.workspaceId}:${linkedAccountId}`, f.keyring), seal(one[2]!, `phone:${f.workspaceId}:${linkedAccountId}`, f.keyring)]);
 await f.pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)", [f.workspaceId, linkedAccountId, linkedPersonId]);
 expect(await importer.importNewPeople(f.practitioner.actor, snapshot(), decisions)).toEqual({ sourceRevision: "synthetic-revision-1", planned: 2, created: 0, replayed: 2 });
 await f.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.parent.actor.id, seal(one[2]!, `phone:${f.workspaceId}:${f.parent.actor.id}`, f.keyring)]);
 await expect(importer.importNewPeople(f.practitioner.actor, snapshot(), decisions)).rejects.toThrow("IMPORT_ACCOUNT_ENDPOINT_COLLISION");
 await f.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=NULL WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.parent.actor.id]);
 for (const link of links.rows) {
  expect(link.snapshot_ciphertext).not.toContain("Synthetic administrative note");
  expect(link.row_digest).toMatch(/^[0-9a-f]{64}$/);
  const opened = JSON.parse(unseal(link.snapshot_ciphertext, `ls_contact_ops/legacy/v1/${f.workspaceId}/${sourceFileId}/${sheetId}/${link.legacy_lead_id}`, f.keyring));
  expect(opened.sourceRow).toBe(link.legacy_lead_id === one[0] ? 2 : 3);
  expect(opened.payload.sourceFields[" General sales notes "]).toContain("Synthetic administrative note");
 }
 const profiles = await f.pool.query("SELECT person_id,payload_ciphertext,record_mode FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=ANY($2::uuid[])", [f.workspaceId, links.rows.map(row => row.person_id)]);
 expect(profiles.rowCount).toBe(2);
 for (const profile of profiles.rows) {
  expect(profile.record_mode).toBe("live");
  expect(profile.payload_ciphertext).not.toContain("Synthetic administrative note");
  const opened = JSON.parse(unseal(profile.payload_ciphertext, crmProfileAad(f.workspaceId, profile.person_id), f.keyring));
  expect(opened.legacyIds).toHaveLength(1);
  expect(opened.nextAction).toBe(profile.person_id === linkedPersonId ? "Call" : "Follow up");
  expect(opened.notes).toContain("Synthetic administrative note");
  if (profile.person_id === linkedPersonId) expect(opened.followUpDate).toBe("2026-09-27");
 }
 const demo = await f.pool.query("SELECT count(*)::integer AS n FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='person' AND entity_key=ANY($2::text[])", [f.workspaceId, links.rows.map(row => row.person_id)]);
 expect(demo.rows[0].n).toBe(0);
 const changed = snapshot([[...one.slice(0, 7), "Changed note"], two]);
 await expect(importer.importNewPeople(f.practitioner.actor, changed, decide(changed))).rejects.toThrow("IMPORT_EXISTING_LINK_CONFLICT");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2", [f.workspaceId, sourceFileId])).rows[0].n).toBe(2);
});

test("shadow importer rejects incomplete decisions, non-practitioner and mismatched source before any contact insert", async () => {
 const otherFile = `synthetic-${randomUUID()}`;
 await expect(importer.importNewPeople(f.practitioner.actor, snapshot([one], otherFile), decide(snapshot([one], otherFile)))).rejects.toThrow("IMPORT_SOURCE_MISMATCH");
 await expect(importer.importNewPeople(f.practitioner.actor, snapshot([one], otherFile), [])).rejects.toThrow("IMPORT_SOURCE_MISMATCH");
 const fresh = new NativeShadowImporter(poolStore(f.pool), f.keyring, lookupKey, key, otherFile, sheetId);
 await expect(fresh.importNewPeople(f.practitioner.actor, snapshot([one], otherFile), [])).rejects.toThrow("IMPORT_DISPOSITION_INCOMPLETE");
 await expect(fresh.importNewPeople(f.parent.actor, snapshot([one], otherFile), decide(snapshot([one], otherFile)))).rejects.toThrow("FORBIDDEN");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2", [f.workspaceId, otherFile])).rows[0].n).toBe(0);
});

test("shadow importer refuses a live account phone collision and preserves the whole transaction", async () => {
 const special = ["LS-LEAD-synthetic-collision", "Synthetic collision", "+15555550103", "", "New inquiry", "Call", "", "Private synthetic text"];
 const ciphertext = seal(special[2]!, `phone:${f.workspaceId}:${f.parent.actor.id}`, f.keyring);
 await f.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.parent.actor.id, ciphertext]);
 const collision = snapshot([one, two, special]);
 await expect(importer.importNewPeople(f.practitioner.actor, collision, decide(collision))).rejects.toThrow("IMPORT_ACCOUNT_ENDPOINT_COLLISION");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2", [f.workspaceId, sourceFileId])).rows[0].n).toBe(2);
});

test("shadow importer waits for the identity workspace lock and sees a newly committed account phone", async () => {
 const raceRow = ["LS-LEAD-synthetic-race", "Synthetic race", "+15555550104", "", "New inquiry", "Call", "", "Synthetic note"];
 const holder = await f.pool.connect();
 let open = false;
 try {
  await holder.query("BEGIN");
  open = true;
  await holder.query("SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE", [f.workspaceId]);
  await holder.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.parent.actor.id, seal(raceRow[2]!, `phone:${f.workspaceId}:${f.parent.actor.id}`, f.keyring)]);
  let settled = false;
  const race = snapshot([one, two, raceRow]);
  const attempt = importer.importNewPeople(f.practitioner.actor, race, decide(race))
   .then(() => ({ ok: true, error: null }), error => ({ ok: false, error: error as Error }))
   .finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 75));
  expect(settled).toBe(false);
  await holder.query("COMMIT");
  open = false;
  const result = await attempt;
  expect(result.ok).toBe(false);
  expect(result.error?.message).toContain("IMPORT_ACCOUNT_ENDPOINT_COLLISION");
  expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2", [f.workspaceId, sourceFileId])).rows[0].n).toBe(2);
 } finally {
  if (open) await holder.query("ROLLBACK");
  holder.release();
 }
});

test("live profile creation shares the import workspace lock and an unlinked profile blocks shadow import", async () => {
 const holder = await f.pool.connect();
 let open = false;
 try {
  await holder.query("BEGIN");
  open = true;
  await holder.query("SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE", [f.workspaceId]);
  const native = new NativeCrmStore(poolStore(f.pool), f.keyring, key);
  let settled = false;
  const create = native.create(f.practitioner.actor, { personId: f.outsider.actor.personId, stage: "New inquiry", nextAction: null, followUpDate: null, notes: "Synthetic administrative note", legacyIds: [] }, `synthetic-create-${randomUUID()}`)
   .then(value => ({ ok: true, value, error: null }), error => ({ ok: false, value: null, error: error as Error }))
   .finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 75));
  expect(settled).toBe(false);
  await holder.query("COMMIT");
  open = false;
  const result = await create;
  expect(result.ok).toBe(true);
  expect(result.value).toEqual({ version: 1, replayed: false });
  await expect(importer.importNewPeople(f.practitioner.actor, snapshot(), decide(snapshot()))).rejects.toThrow("IMPORT_UNLINKED_NATIVE_PROFILE_REQUIRES_REVIEW");
 } finally {
  if (open) await holder.query("ROLLBACK");
  holder.release();
 }
});
