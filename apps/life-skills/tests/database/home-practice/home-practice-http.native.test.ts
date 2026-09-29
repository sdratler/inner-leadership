/** Native HTTP/service/SQL proof on the existing disposable loopback-only fixture.
 * Persisted fixture sessions test authorization, not ordinary password login.
 */
import { afterEach, expect, test } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fixture, poolStore, type Fixture } from "../calendar/fixture.ts";
import { asId } from "../../../src/lib/ids.ts";
import { SESSION_COOKIE } from "../../../src/lib/security/session.ts";
import { systemClock, type Actor } from "../../../src/features/identity/types.ts";
import type { IdentityConfig } from "../../../src/features/identity/config.ts";
import { seal, tokenDigest } from "../../../src/features/identity/crypto.ts";
import { IdentitySessions } from "../../../src/features/identity/session-adapter.ts";
import { PostgresIdentityRateStore } from "../../../src/features/identity/rate-store.ts";
import { durableAuditSink } from "../../../src/features/identity/history.ts";
import { GoalService } from "../../../src/features/goals/service.ts";
import { CommitmentService } from "../../../src/features/commitments/service.ts";
import { CheckInService } from "../../../src/features/checkins/service.ts";
import { HomePracticeService } from "../../../src/features/home-practice/service.ts";
import { Ls040Http } from "../../../src/features/home-practice/http.ts";

const opened: Fixture[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.pool.end())); });
async function setup() {
  const f = await fixture(); opened.push(f);
  const config: IdentityConfig = { enabled: true, origin: "https://synthetic.example.invalid", workspaceId: f.workspaceId,
    csrfKey: randomBytes(32), lookupKey: randomBytes(32), rateLimitKey: randomUUID(), keyring: f.keyring, sessionSeconds: 3600 };
  const store = poolStore(f.pool), sessions = new IdentitySessions(store, config, systemClock);
  const practice = new HomePracticeService(store, config, systemClock);
  const http = new Ls040Http(config, systemClock, { sessions, limits: new PostgresIdentityRateStore(store), audit: durableAuditSink(store),
    goals: new GoalService(store, config, systemClock), commitments: new CommitmentService(store, config, systemClock),
    practice, checkins: new CheckInService(store, systemClock) });
  function request(method: "GET" | "POST", path: string, body?: unknown, token: string | null = f.practitioner.token,
    extraHeaders: Record<string, string> = {}, forwarded = true) {
    const headers = new Headers(forwarded ? { "x-forwarded-host": "synthetic.example.invalid", "x-forwarded-proto": "https" } : {});
    if (token) headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
    if (method === "POST") {
      headers.set("Origin", config.origin); headers.set("Content-Type", "application/json");
      if (token) headers.set("X-CSRF-Token", sessions.csrf(token));
    }
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
    return http.handle(new Request((forwarded ? "http://127.0.0.1:8080" : config.origin) + path,
      { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  }
  const listPath = (c = f.first, kind = "home-practice") => `/api/${kind}?caseId=${c.id}&audienceId=${c.audienceId}`;
  const draftInput = (c = f.first) => ({ action: "create_draft", caseId: c.id, audienceId: c.audienceId,
    templateKey: "W01", templateVersion: "synthetic-v1", instructions: "Synthetic pause, breathe and ask", startsOn: f.at(-24).slice(0, 10), endsOn: null });
  async function draft(c = f.first) {
    const response = await request("POST", "/api/home-practice", draftInput(c)); expect(response.status).toBe(201);
    return (await response.json()).data as { assignmentId: string; versionId: string };
  }
  async function publish(c = f.first) {
    const saved = await draft(c), response = await request("POST", "/api/home-practice", { action: "publish", ...saved });
    expect(response.status).toBe(201); return saved;
  }
  // Isolated fixture identities use the existing case's real subject, audience and
  // persisted session. No role injection, account policy change or provider action.
  async function clientIdentity(role: "child" | "adult_client", c = f.first) {
    const result = await f.pool.query("SELECT cl.person_id FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id WHERE c.workspace_id=$1 AND c.id=$2", [f.workspaceId, c.id]);
    const personId = asId(result.rows[0].person_id as string, "person"), id = asId(randomUUID(), "account"), token = randomBytes(32).toString("base64url");
    const ago = new Date(Date.now() - 86400000), expiresAt = Date.now() + 3600000;
    const actor: Actor = { id, workspaceId: f.workspaceId, personId, role, state: "active", locale: "en", sessionDigest: tokenDigest(token), expiresAt };
    const client = await f.pool.connect();
    try {
      await client.query("BEGIN");
      if (role === "adult_client") await client.query("UPDATE ls_identity.people SET kind='adult' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, personId]);
      await client.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
        VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-non-login-hash',$6,$6)`,
        [id, f.workspaceId, role, createHash("sha256").update(id).digest("hex"), seal(`synthetic-${id}@example.invalid`, `email:${f.workspaceId}:${id}`, f.keyring), ago]);
      await client.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)", [f.workspaceId, id, personId]);
      await client.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)", [actor.sessionDigest, f.workspaceId, id, ago, new Date(expiresAt)]);
      await client.query("INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,$5)", [f.workspaceId, c.id, c.audienceId, id, ago]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { actor, token };
  }
  return { f, config, sessions, practice, request, listPath, draftInput, draft, publish, clientIdentity };
}

test("native HTTPS-forwarded practice preserves encrypted draft, explicit publication and authorized parent readback", async () => {
  const h = await setup(), { f } = h;
  const empty = await h.request("GET", h.listPath(), undefined, f.parent.token); expect(empty.status).toBe(200); expect((await empty.json()).data).toEqual([]);
  const saved = await h.draft();
  expect((await (await h.request("GET", h.listPath(), undefined, f.parent.token)).json()).data).toEqual([]);
  const row = await f.pool.query("SELECT state,instructions_ciphertext FROM ls_practice.practice_assignment_versions WHERE workspace_id=$1 AND id=$2", [f.workspaceId, saved.versionId]);
  expect(row.rows[0].state).toBe("draft"); expect(row.rows[0].instructions_ciphertext).not.toContain("Synthetic");
  const published = await h.request("POST", "/api/home-practice", { action: "publish", ...saved }); expect(published.status).toBe(201);
  const parent = await h.request("GET", h.listPath(), undefined, f.parent.token); expect(parent.status).toBe(200);
  expect(parent.headers.get("cache-control")).toBe("private, no-store");
  expect((await parent.json()).data).toMatchObject([{ ...saved, caseId: f.first.id, audienceId: f.first.audienceId, instructions: h.draftInput().instructions }]);
  expect((await h.request("GET", h.listPath(), undefined, f.parent.token, {}, false)).status).toBe(200);
});

test.each(["child", "adult_client"] as const)("native %s reads only its exact published case/audience and cannot publish or create", async role => {
  const h = await setup(), c = role === "child" ? h.f.first : h.f.second, other = role === "child" ? h.f.second : h.f.first;
  const account = await h.clientIdentity(role, c), saved = await h.publish(c);
  const own = await h.request("GET", h.listPath(c), undefined, account.token); expect(own.status).toBe(200);
  expect((await own.json()).data).toMatchObject([{ ...saved, caseId: c.id, audienceId: c.audienceId }]);
  expect((await h.request("GET", h.listPath(other), undefined, account.token)).status).toBe(404);
  expect((await h.request("GET", `/api/home-practice?caseId=${c.id}&audienceId=${other.audienceId}`, undefined, account.token)).status).toBe(404);
  expect((await h.request("POST", "/api/home-practice", h.draftInput(c), account.token)).status).toBe(404);
  const hidden = await h.draft(c);
  expect((await h.request("POST", "/api/home-practice", { action: "publish", ...hidden }, account.token)).status).toBe(404);
  await h.f.pool.query("UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND audience_id=$2 AND account_id=$3", [h.f.workspaceId, c.audienceId, account.actor.id]);
  expect((await h.request("GET", h.listPath(c), undefined, account.token)).status).toBe(404);
  await h.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND token_digest=$2", [h.f.workspaceId, account.actor.sessionDigest]);
  expect((await h.request("GET", h.listPath(c), undefined, account.token)).status).toBe(401);
});

test("native proxy boundary retains session, mutation, strict query, fresh guardian, private audience and audit denials", async () => {
  const h = await setup(), { f } = h; await h.publish();
  expect((await h.request("GET", h.listPath(), undefined, null)).status).toBe(401);
  expect((await h.request("POST", "/api/home-practice", h.draftInput(), f.practitioner.token, { "x-csrf-token": "wrong" })).status).toBe(403);
  expect((await h.request("POST", "/api/home-practice", h.draftInput(), f.practitioner.token, { origin: "https://evil.invalid" })).status).toBe(403);
  expect((await h.request("GET", h.listPath() + `&caseId=${f.first.id}`)).status).toBe(400);
  expect((await h.request("POST", h.listPath(), h.draftInput())).status).toBe(400);
  expect((await h.request("GET", h.listPath(), undefined, f.outsider.token)).status).toBe(404);
  for (const headers of [{ "x-forwarded-host": "evil.invalid" }, { "x-forwarded-host": "synthetic.example.invalid,evil.invalid" }, { "x-forwarded-proto": "http" }])
    expect((await h.request("GET", h.listPath(), undefined, f.parent.token, headers)).status).toBe(503);
  await f.pool.query("UPDATE ls_cases.audiences SET visibility='private' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.first.audienceId]);
  expect((await h.request("GET", h.listPath(), undefined, f.parent.token)).status).toBe(404);
  await f.pool.query("UPDATE ls_cases.audiences SET visibility='family_full' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.first.audienceId]);
  await f.pool.query("UPDATE ls_cases.case_guardians SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3", [f.workspaceId, f.first.id, f.parent.actor.id]);
  expect((await h.request("GET", h.listPath(), undefined, f.parent.token)).status).toBe(404);
  const audit = await f.pool.query("SELECT count(*)::integer AS count FROM ls_identity.foundation_audit WHERE workspace_id=$1 AND kind='access_denied'", [f.workspaceId]);
  expect(audit.rows[0].count).toBeGreaterThanOrEqual(5);
});

test("native forwarded goal and linked commitment mutations keep strict bodies, encryption and authorized scope", async () => {
  const h = await setup(), { f } = h, input = { caseId: f.first.id, audienceId: f.first.audienceId, title: "Synthetic shared goal" };
  const created = await h.request("POST", "/api/goals", input); expect(created.status).toBe(201); const goal = (await created.json()).data;
  const commitmentInput = { ...input, goalId: goal.id, title: "Synthetic shared commitment" };
  const committed = await h.request("POST", "/api/commitments", commitmentInput); expect(committed.status).toBe(201); const commitment = (await committed.json()).data;
  expect((await (await h.request("GET", h.listPath(f.first, "goals"), undefined, f.parent.token)).json()).data).toMatchObject([{ id: goal.id, title: input.title }]);
  expect((await (await h.request("GET", h.listPath(f.first, "commitments"), undefined, f.parent.token)).json()).data).toMatchObject([{ id: commitment.id, goalId: goal.id, title: commitmentInput.title }]);
  const encrypted = await f.pool.query("SELECT title_ciphertext FROM ls_practice.goals WHERE workspace_id=$1 UNION ALL SELECT title_ciphertext FROM ls_practice.commitments WHERE workspace_id=$1", [f.workspaceId]);
  expect(encrypted.rows).toHaveLength(2); for (const row of encrypted.rows) expect(row.title_ciphertext).not.toContain("Synthetic");
  expect((await h.request("POST", "/api/goals", input, f.parent.token)).status).toBe(404);
  expect((await h.request("POST", "/api/commitments", { ...commitmentInput, audienceId: f.second.audienceId })).status).toBe(404);
  expect((await h.request("POST", "/api/goals", { ...input, unexpected: true })).status).toBe(400);
});

test("native morning/evening occurrences and current guardian assignee check-ins retain replay and correction history through HTTPS forwarding", async () => {
  const h = await setup(), { f } = h, saved = await h.publish();
  // Current database coordination admits guardians. Child reads are proven above;
  // the service/SQL child-assignee mismatch is a separately recorded migration gate.
  const assignee = f.parentTwo;
  const coordination = await h.request("POST", "/api/home-practice", { action: "coordinate", assignmentId: saved.assignmentId,
    assigneeAccountIds: [f.parent.actor.id, assignee.actor.id], completionMode: "each_assignee", reminderCandidateAccountIds: [], effectiveFrom: new Date(Date.now() + 1000).toISOString() }, f.parent.token);
  expect(coordination.status).toBe(201);
  const occursOn = f.at(48).slice(0, 10), occurrences: string[] = [];
  for (const period of ["morning", "evening"]) {
    const response = await h.request("POST", "/api/home-practice", { action: "schedule", assignmentId: saved.assignmentId, occursOn, period });
    expect(response.status).toBe(201); occurrences.push((await response.json()).data.id as string);
  }
  const occurrenceId = occurrences[0]!, body = { occurrenceId, status: "done", idempotencyKey: randomUUID() };
  expect((await h.request("POST", "/api/checkins", body, assignee.token)).status).toBe(201);
  expect((await h.request("POST", "/api/checkins", body, assignee.token)).status).toBe(201);
  expect((await h.request("POST", "/api/checkins", { ...body, status: "not_done" }, assignee.token)).status).toBe(409);
  const parentResponse = await h.request("POST", "/api/checkins", { ...body, idempotencyKey: randomUUID() }, f.parent.token); expect(parentResponse.status).toBe(201);
  const read = await h.request("GET", `/api/checkins?occurrenceId=${occurrenceId}`, undefined, assignee.token); expect(read.status).toBe(200); const reports = (await read.json()).data;
  expect(reports).toHaveLength(2); const previous = reports.find((r: { authorAccountId: string }) => r.authorAccountId === assignee.actor.id);
  expect((await h.request("POST", "/api/checkins", { ...body, status: "partly_done", idempotencyKey: randomUUID(), correctsReportId: previous.reportId }, assignee.token)).status).toBe(201);
  const history = (await (await h.request("GET", `/api/checkins?occurrenceId=${occurrenceId}`, undefined, f.parent.token)).json()).data;
  expect(history).toHaveLength(3); expect(history).toMatchObject(expect.arrayContaining([{ ...previous }, expect.objectContaining({ authorAccountId: assignee.actor.id, revision: 2, correctedReportId: previous.reportId, status: "partly_done" })]));
  expect((await h.request("GET", `/api/checkins?occurrenceId=${occurrenceId}`, undefined, f.outsider.token)).status).toBe(404);
  expect((await h.request("POST", "/api/checkins", { ...body, idempotencyKey: randomUUID() }, f.outsider.token)).status).toBe(404);
  const states = await f.pool.query("SELECT period,state FROM ls_practice.practice_occurrences WHERE workspace_id=$1 ORDER BY period", [f.workspaceId]);
  expect(states.rows).toEqual([{ period: "evening", state: "open" }, { period: "morning", state: "closed" }]);
});
