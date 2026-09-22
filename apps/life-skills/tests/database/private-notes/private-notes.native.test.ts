import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateNotesHttp } from "../../../src/features/private-notes/http.ts";
import { PrivateNotesService } from "../../../src/features/private-notes/service.ts";
import { systemClock } from "../../../src/features/identity/types.ts";
import { fixture, type Fixture } from "../calendar/fixture.ts";

const opened: Fixture[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((value) => value.pool.end())); });
async function open() { const value = await fixture(); opened.push(value); return value; }
function service(f: Fixture) {
  return new PrivateNotesService(f.db.store, {
    enabled: true, origin: "https://synthetic.life-skills.invalid", workspaceId: f.workspaceId,
    csrfKey: Buffer.alloc(32, 4), lookupKey: Buffer.alloc(32, 5), rateLimitKey: "synthetic-rate-key-material-0123456789",
    keyring: f.keyring, sessionSeconds: 3600,
  }, systemClock);
}
function input(caseId: string, body: string, expectedRevision: number, idempotencyKey = randomUUID()) {
  return { caseId: caseId as never, body, expectedRevision, idempotencyKey };
}

describe("practitioner private notes — synthetic native PostgreSQL", () => {
  it("saves, reads, encrypts at rest, advances revisions, and leaves neutral history", async () => {
    const f = await open(), notes = service(f), firstKey = randomUUID(), text = "Synthetic confidential practitioner note";
    await expect(notes.save(f.practitioner.actor, input(f.first.id, text, 0, firstKey), randomUUID())).resolves.toMatchObject({ revision: 1, idempotent: false });
    await expect(notes.read(f.practitioner.actor, f.first.id)).resolves.toMatchObject({ caseId: f.first.id, body: text, revision: 1 });
    const stored = await f.pool.query("SELECT body_ciphertext,revision FROM ls_private_notes.case_notes WHERE workspace_id=$1 AND case_id=$2", [f.workspaceId, f.first.id]);
    expect(stored.rows).toHaveLength(1); expect(stored.rows[0].body_ciphertext).not.toContain(text); expect(stored.rows[0].revision).toBe(1);
    await expect(notes.save(f.practitioner.actor, input(f.first.id, "Synthetic changed note", 1), randomUUID())).resolves.toMatchObject({ revision: 2 });
    const history = await f.pool.query("SELECT row_to_json(action_history)::text AS row FROM ls_identity.action_history AS action_history WHERE workspace_id=$1 ORDER BY occurred_at", [f.workspaceId]);
    expect(history.rows).toHaveLength(2); for (const row of history.rows) { expect(row.row).toContain("practitioner_private_note_saved"); expect(row.row).not.toContain(text); expect(row.row).not.toContain("Synthetic changed note"); }
  });

  it("denies a parent plus wrong-workspace and wrong-case accesses", async () => {
    const f = await open(), notes = service(f);
    await expect(notes.read(f.parent.actor, f.first.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(notes.save(f.parent.actor, input(f.first.id, "Synthetic", 0), randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await open(), otherNotes = service(other);
    await expect(otherNotes.read(other.practitioner.actor, f.first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("replays only the exact actor/case/body/revision request and rejects stale or altered keys", async () => {
    const f = await open(), notes = service(f), key = randomUUID(), actor = f.practitioner.actor;
    await expect(notes.save(actor, input(f.first.id, "Synthetic original", 0, key), randomUUID())).resolves.toMatchObject({ revision: 1, idempotent: false });
    await expect(notes.save(actor, input(f.first.id, "Synthetic original", 0, key), randomUUID())).resolves.toMatchObject({ revision: 1, idempotent: true });
    await expect(notes.save(actor, input(f.first.id, "Synthetic changed", 0, key), randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(notes.save(actor, input(f.second.id, "Synthetic original", 0, key), randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(notes.save(f.parentTwo.actor, input(f.first.id, "Synthetic original", 0, key), randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(notes.save(actor, input(f.first.id, "Synthetic stale", 0), randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows exactly one concurrent initial write", async () => {
    const f = await open(), notes = service(f), actor = f.practitioner.actor;
    const results = await Promise.allSettled([
      notes.save(actor, input(f.first.id, "Synthetic race A", 0), randomUUID()),
      notes.save(actor, input(f.first.id, "Synthetic race B", 0), randomUUID()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const read = await notes.read(actor, f.first.id); expect(read.revision).toBe(1); expect(["Synthetic race A", "Synthetic race B"]).toContain(read.body);
  });

  it("HTTP requires CSRF, then permits a valid session-bound save", async () => {
    const f = await open(), notes = service(f), token = "a".repeat(43), csrf = "b".repeat(43), origin = "https://synthetic.life-skills.invalid";
    const http = new PrivateNotesHttp({
      config: { enabled: true, origin, workspaceId: f.workspaceId, csrfKey: Buffer.alloc(32, 4), lookupKey: Buffer.alloc(32, 5), rateLimitKey: "synthetic-rate-key-material-0123456789", keyring: f.keyring, sessionSeconds: 3600 },
      sessions: { async actor(value: string) { if (value !== token) throw new Error("unexpected synthetic token"); return f.practitioner.actor; }, csrf(value: string) { if (value !== token) throw new Error("unexpected synthetic token"); return csrf; } },
      limits: { async consume() { return { count: 1, retryAfterMs: 0 }; } }, audit: { async write() {} }, clock: systemClock,
    }, notes);
    const body = JSON.stringify(input(f.first.id, "Synthetic HTTP note", 0));
    const headers = { cookie: `__Host-ls-session=${token}`, origin, "content-type": "application/json" };
    const missing = await http.handle(new Request(`${origin}/api/private-notes`, { method: "POST", headers, body }));
    expect(missing.status).toBe(403);
    const valid = await http.handle(new Request(`${origin}/api/private-notes`, { method: "POST", headers: { ...headers, "x-csrf-token": csrf }, body }));
    expect(valid.status).toBe(201); expect(await valid.json()).toMatchObject({ ok: true, data: { revision: 1 } });
  });
});
