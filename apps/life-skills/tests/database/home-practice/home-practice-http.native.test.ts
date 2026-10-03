/** Native HTTP/service/SQL proof on the existing disposable loopback-only fixture.
 * Persisted fixture sessions test authorization, not ordinary password login.
 */
import { afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
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
import { authoringReadback } from "../../../src/features/home-practice/management-client.ts";
import { proxy } from "../../../src/proxy.ts";

const opened: Fixture[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(opened.splice(0).map(f => f.pool.end())); });
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
  async function proxyRequest(method: "GET" | "POST", path: string, body?: unknown,
    token: string | null = f.practitioner.token, extraHeaders: Record<string, string> = {}) {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("LS_APP_MODE", "foundation_locked");
    vi.stubEnv("LS_APP_ORIGIN", config.origin); vi.stubEnv("LS_PRIVATE_APP_ENABLED", "true");
    const headers = new Headers({ host: new URL(config.origin).host, "x-forwarded-host": new URL(config.origin).host, "x-forwarded-proto": "https" });
    if (token) headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
    if (method === "POST") {
      headers.set("Origin", config.origin); headers.set("Content-Type", "application/json");
      if (token) headers.set("X-CSRF-Token", sessions.csrf(token));
    }
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
    const inbound = new NextRequest("http://127.0.0.1:8080" + path,
      { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const perimeter = proxy(inbound);
    if (perimeter.headers.get("x-middleware-next") !== "1") return perimeter;
    const forwardedHeaders = new Headers(inbound.headers);
    for (const key of (perimeter.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean)) {
      const value = perimeter.headers.get("x-middleware-request-" + key);
      if (value === null) forwardedHeaders.delete(key); else forwardedHeaders.set(key, value);
    }
    return http.handle(new Request(inbound, { headers: forwardedHeaders }));
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
  return { f, config, sessions, practice, request, proxyRequest, listPath, draftInput, draft, publish, clientIdentity };
}

test.each(["goals", "commitments"] as const)("native authoring reads back the exact 101st %s without increasing the page bound", async kind => {
  const h = await setup(), { f } = h, store = poolStore(f.pool);
  const goals = new GoalService(store, h.config, systemClock), commitments = new CommitmentService(store, h.config, systemClock);
  const scope = { caseId: f.first.id, audienceId: f.first.audienceId };
  const linkedGoal = kind === "commitments" ? await goals.create(f.practitioner.actor, { ...scope, title: "Synthetic linked goal" }, randomUUID()) : null;
  // Normal retained services create encrypted, authorized records; fixture setup
  // does not reset the HTTP rate counter or introduce a permissive adapter.
  for (let index = 0; index < 100; index++) {
    const input = { ...scope, title: `Synthetic previous ${index}` };
    if (linkedGoal) await commitments.create(f.practitioner.actor, { ...input, goalId: linkedGoal.id }, randomUUID());
    else await goals.create(f.practitioner.actor, input, randomUUID());
  }
  const input = { ...scope, title: "Synthetic exact 101st receipt", ...(linkedGoal ? { goalId: linkedGoal.id } : {}) };
  const posted = await h.proxyRequest("POST", `/api/${kind}`, input); expect(posted.status).toBe(201);
  const receipt = (await posted.json()).data;
  const path = h.listPath(f.first, kind) + "&view=management";
  const read = await h.proxyRequest("GET", path); expect(read.status).toBe(200);
  expect(read.headers.get("cache-control")).toBe("private, no-store");
  const rows = (await read.json()).data; expect(rows).toHaveLength(100);
  expect(authoringReadback({ action: kind === "goals" ? "goal" : "commitment", ...input } as Parameters<typeof authoringReadback>[0], receipt,
    { practice: { items: [], hasMore: false }, goals: kind === "goals" ? rows : [], commitments: kind === "commitments" ? rows : [] })).toBe(true);
  const expected = await f.pool.query(`SELECT id FROM ls_practice.${kind} WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3 ORDER BY created_at DESC,id DESC LIMIT 100`, [f.workspaceId, scope.caseId, scope.audienceId]);
  expect(rows.map((row: { id: string }) => row.id)).toEqual(expected.rows.map(row => row.id));
  // The original shared/customer read keeps its ordering and excludes the new
  // 101st item rather than silently changing existing consumers' filter keys.
  for (const subject of [f.practitioner, f.parent]) {
    const shared = await h.proxyRequest("GET", h.listPath(f.first, kind), undefined, subject.token); expect(shared.status).toBe(200);
    const sharedRows = (await shared.json()).data; expect(sharedRows).toHaveLength(100);
    const prior = await f.pool.query(`SELECT id FROM ls_practice.${kind} WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3 ORDER BY created_at,id LIMIT 100`, [f.workspaceId, scope.caseId, scope.audienceId]);
    expect(sharedRows.map((row: { id: string }) => row.id)).toEqual(prior.rows.map(row => row.id));
    expect(sharedRows.some((row: { id: string }) => row.id === receipt.id)).toBe(false);
  }
  expect((await f.pool.query(`SELECT count(*)::int AS n FROM ls_practice.${kind} WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3`, [f.workspaceId, scope.caseId, scope.audienceId])).rows[0].n).toBe(101);
});

test.each(["goals", "commitments"] as const)("native %s management reads enforce owner scope, revocation and exact query validation", async kind => {
  const h = await setup(), { f } = h;
  const path = h.listPath(f.first, kind) + "&view=management";
  for (const subject of [f.parent, f.outsider, await h.clientIdentity("child"), await h.clientIdentity("adult_client", f.second)])
    expect((await h.proxyRequest("GET", path, undefined, subject.token)).status).toBe(404);
  expect((await h.proxyRequest("GET", path, undefined, null)).status).toBe(401);
  expect((await h.proxyRequest("GET", path.replace(f.first.id, f.second.id))).status).toBe(404);
  expect((await h.proxyRequest("GET", path.replace(f.first.audienceId, f.second.audienceId))).status).toBe(404);
  for (const invalid of [path + "&unknown=1", path + "&view=management", path.replace("view=management", "view=shared"), path.replace("view=management", "view="), path + "&caseId=" + f.first.id])
    expect((await h.proxyRequest("GET", invalid)).status).toBe(400);
  // Unpublished/private audiences remain authorable only by the actual owner.
  await f.pool.query("UPDATE ls_cases.audiences SET published=false,visibility='private' WHERE workspace_id=$1 AND case_id=$2 AND id=$3", [f.workspaceId, f.first.id, f.first.audienceId]);
  expect((await h.proxyRequest("GET", path)).status).toBe(200);
  expect((await h.proxyRequest("GET", path, undefined, f.parent.token)).status).toBe(404);
  await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.practitioner.actor.id]);
  expect((await h.proxyRequest("GET", path)).status).toBe(401);
});

test("native practitioner authoring reads saved drafts and exact active versions without exposing drafts to clients", async () => {
  const h = await setup(), { f } = h, saved = await h.draft();
  const path = `/api/home-practice?view=management&caseId=${f.first.id}&audienceId=${f.first.audienceId}`;
  const read = await h.proxyRequest("GET", path);
  expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("private, no-store");
  expect((await read.json()).data).toMatchObject({ hasMore: false, items: [{ ...saved, state: "draft", active: false, instructions: h.draftInput().instructions, publishedAt: null }] });
  expect((await (await h.request("GET", h.listPath(), undefined, f.parent.token)).json()).data).toEqual([]);
  for (const subject of [f.parent, f.outsider, await h.clientIdentity("child")])
    expect((await h.request("GET", path, undefined, subject.token)).status).toBe(404);
  expect((await h.request("GET", path, undefined, null)).status).toBe(401);
  expect((await h.request("GET", path.replace(f.first.id, f.second.id))).status).toBe(404);
  expect((await h.request("GET", path + "&unknown=1")).status).toBe(400);
  expect((await h.request("POST", "/api/home-practice", { action: "publish", ...saved })).status).toBe(201);
  const revision = await h.request("POST", "/api/home-practice", { action: "revise", assignmentId: saved.assignmentId, instructions: "Synthetic reviewed revision", startsOn: h.draftInput().startsOn });
  expect(revision.status).toBe(201); const revised = (await revision.json()).data;
  const versions = (await (await h.request("GET", path)).json()).data.items;
  expect(versions).toEqual(expect.arrayContaining([
    expect.objectContaining({ versionId: saved.versionId, state: "published", active: true, instructions: h.draftInput().instructions }),
    expect.objectContaining({ versionId: revised.versionId, state: "draft", active: false, instructions: "Synthetic reviewed revision" }),
  ]));
  const childRead = (await (await h.request("GET", h.listPath(), undefined, f.parent.token)).json()).data;
  expect(childRead).toHaveLength(1); expect(childRead[0].versionId).toBe(saved.versionId);
  expect((await h.request("POST", "/api/home-practice", { action: "publish", assignmentId: saved.assignmentId, versionId: revised.versionId })).status).toBe(201);
  const published = (await (await h.request("GET", path)).json()).data.items;
  expect(published.find((v: { versionId: string }) => v.versionId === saved.versionId).active).toBe(false);
  expect(published.find((v: { versionId: string }) => v.versionId === revised.versionId).active).toBe(true);
  await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.practitioner.actor.id]);
  expect((await h.request("GET", path)).status).toBe(401);
});

test.each(["parent", "child", "adult_client"] as const)("native %s occurrence read returns frozen instructions and only its own latest check-in", async role => {
  const h = await setup(), { f } = h;
  const subject = role === "parent" ? f.parent : await h.clientIdentity(role);
  const saved = await h.publish();
  const coordinate = { action: "coordinate", assignmentId: saved.assignmentId, assigneeAccountIds: [subject.actor.id],
    completionMode: "any_assignee", reminderCandidateAccountIds: [], effectiveFrom: new Date(Date.now() + 1000).toISOString() };
  if (role === "adult_client") {
    // Reuse the existing native adult-participant recipe. This does NOT claim
    // that the parent-only coordination HTTP action can initialize an adult case.
    await f.pool.query(`INSERT INTO ls_practice.task_coordination_versions
      (id,workspace_id,assignment_id,version,case_id,audience_id,assignee_account_ids,completion_mode,reminder_candidate_account_ids,effective_from,changed_by_account_id,created_at)
      VALUES($1,$2,$3,1,$4,$5,ARRAY[$6]::uuid[],'any_assignee','{}',$7,$8,clock_timestamp())`,
    [randomUUID(), f.workspaceId, saved.assignmentId, f.first.id, f.first.audienceId, subject.actor.id, coordinate.effectiveFrom, f.parent.actor.id]);
    expect((await h.request("POST", "/api/home-practice", coordinate, subject.token)).status).toBe(404);
  } else expect((await h.request("POST", "/api/home-practice", coordinate, f.parent.token)).status).toBe(201);
  const from = f.at(48).slice(0, 10), to = f.at(72).slice(0, 10);
  for (const period of ["morning", "evening"]) expect((await h.request("POST", "/api/home-practice", { action: "schedule", assignmentId: saved.assignmentId, occursOn: from, period })).status).toBe(201);
  const path = `/api/home-practice?view=occurrences&caseId=${f.first.id}&audienceId=${f.first.audienceId}&from=${from}&to=${to}`;
  const first = await h.proxyRequest("GET", path, undefined, subject.token);
  expect(first.status).toBe(200); expect(first.headers.get("cache-control")).toBe("private, no-store");
  const page = (await first.json()).data;
  expect(page.hasMore).toBe(false); expect(page.items).toHaveLength(2);
  expect(page.items.map((row: { occurrence: { period: string } }) => row.occurrence.period)).toEqual(["morning", "evening"]);
  expect(page.items).toMatchObject([{
    occurrence: { practiceVersionId: saved.versionId, occursOn: from, state: "open" },
    practice: { instructions: h.draftInput().instructions, versionId: saved.versionId }, canReport: true, ownReport: null,
  }, { canReport: true, ownReport: null }]);
  const occurrenceId = page.items[0].occurrence.id, body = { occurrenceId, status: "done", idempotencyKey: randomUUID() };
  const submitted = await h.request("POST", "/api/checkins", body, subject.token); expect(submitted.status).toBe(201);
  const prior = (await (await h.request("GET", `/api/checkins?occurrenceId=${occurrenceId}`, undefined, subject.token)).json()).data[0];
  expect((await h.request("POST", "/api/checkins", { ...body, status: "partly_done", idempotencyKey: randomUUID(), correctsReportId: prior.reportId }, subject.token)).status).toBe(201);
  const revised = (await (await h.request("GET", path, undefined, subject.token)).json()).data.items[0];
  expect(revised.ownReport).toMatchObject({ status: "partly_done", revision: 2, correctedReportId: prior.reportId, authorAccountId: subject.actor.id });
  const clinician = (await (await h.request("GET", path)).json()).data.items[0];
  expect(clinician).toMatchObject({ canReport: false, ownReport: null });
  expect(JSON.stringify(clinician)).not.toContain(subject.actor.id);
  const revision = await h.request("POST", "/api/home-practice", { action: "revise", assignmentId: saved.assignmentId, instructions: "Synthetic newer instruction", startsOn: from });
  expect(revision.status).toBe(201);
  expect((await h.request("POST", "/api/home-practice", { action: "publish", assignmentId: saved.assignmentId, versionId: (await revision.json()).data.versionId })).status).toBe(201);
  const frozen = (await (await h.request("GET", path, undefined, subject.token)).json()).data.items[0];
  expect(frozen.practice).toMatchObject({ versionId: saved.versionId, instructions: h.draftInput().instructions });
  await f.pool.query("UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3", [f.workspaceId, f.first.id, subject.actor.id]);
  expect((await h.request("GET", path, undefined, subject.token)).status).toBe(404);
});

test("native occurrence query rejects malformed/unbounded ranges and exact-scope or transport forgeries", async () => {
  const h = await setup(), { f } = h;
  const path = `/api/home-practice?view=occurrences&caseId=${f.first.id}&audienceId=${f.first.audienceId}&from=2026-09-29&to=2026-09-30`;
  expect((await h.request("GET", path, undefined, f.parent.token)).status).toBe(200);
  for (const bad of [path + "&view=occurrences", path + "&unknown=1", path.replace("2026-09-29", "2026-02-30"), path.replace("2026-09-30", "2026-09-29"), path.replace("2026-09-30", "2027-09-30"), path.replace("view=occurrences", "view=all")])
    expect((await h.request("GET", bad, undefined, f.parent.token)).status).toBe(400);
  expect((await h.request("GET", path.replace(f.first.id, f.second.id), undefined, f.parent.token)).status).toBe(404);
  expect((await h.request("GET", path.replace(f.first.audienceId, f.second.audienceId), undefined, f.parent.token)).status).toBe(404);
  expect((await h.request("GET", path, undefined, f.outsider.token)).status).toBe(404);
  expect((await h.request("GET", path, undefined, null)).status).toBe(401);
  expect((await h.proxyRequest("GET", path, undefined, f.parent.token, { "x-forwarded-host": "evil.invalid" })).status).toBe(503);
  await f.pool.query("UPDATE ls_cases.audiences SET published=false WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.first.audienceId]);
  expect((await h.request("GET", path, undefined, f.parent.token)).status).toBe(404);
});

test("native occurrence projection does not expose another assignee or title-only instruction text", async () => {
  const h = await setup(), { f } = h, saved = await h.publish();
  expect((await h.request("POST", "/api/home-practice", { action: "coordinate", assignmentId: saved.assignmentId,
    assigneeAccountIds: [f.parent.actor.id], completionMode: "any_assignee", reminderCandidateAccountIds: [], effectiveFrom: new Date(Date.now() + 1000).toISOString() }, f.parent.token)).status).toBe(201);
  const from = f.at(48).slice(0, 10), to = f.at(72).slice(0, 10);
  const scheduled = await h.request("POST", "/api/home-practice", { action: "schedule", assignmentId: saved.assignmentId, occursOn: from, period: "morning" });
  expect(scheduled.status).toBe(201); const occurrenceId = (await scheduled.json()).data.id;
  expect((await h.request("POST", "/api/checkins", { occurrenceId, status: "done", idempotencyKey: randomUUID() }, f.parent.token)).status).toBe(201);
  const path = `/api/home-practice?view=occurrences&caseId=${f.first.id}&audienceId=${f.first.audienceId}&from=${from}&to=${to}`;
  const other = (await (await h.request("GET", path, undefined, f.parentTwo.token)).json()).data.items[0];
  expect(other).toMatchObject({ canReport: false, ownReport: null, occurrence: {state:"closed"} });
  expect(JSON.stringify(other)).not.toContain(f.parent.actor.id); expect(JSON.stringify(other)).not.toContain("instructionsCiphertext");
  const ownPath = `/api/checkins?occurrenceId=${occurrenceId}&scope=own`;
  const emptyHistory=await h.request("GET",ownPath,undefined,f.parentTwo.token);expect(emptyHistory.status).toBe(200);expect((await emptyHistory.json()).data).toEqual([]);
  const ownHistory=await h.request("GET",ownPath,undefined,f.parent.token);expect(ownHistory.status).toBe(200);
  expect((await ownHistory.json()).data).toMatchObject([{authorAccountId:f.parent.actor.id,status:"done",idempotencyKey:expect.any(String)}]);
  for(const query of ["&scope=own","&authorAccountId="+f.parent.actor.id])expect((await h.request("GET",ownPath+query,undefined,f.parentTwo.token)).status).toBe(400);
  await f.pool.query("UPDATE ls_cases.audiences SET visibility='family_title_completion' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.first.audienceId]);
  const limited = (await (await h.request("GET", path, undefined, f.parent.token)).json()).data.items[0];
  expect(limited.practice.instructions).toBe(""); expect(JSON.stringify(limited)).not.toContain(h.draftInput().instructions);
  const clinician = (await (await h.request("GET", path)).json()).data.items[0];
  expect(clinician.practice.instructions).toBe(h.draftInput().instructions);
});

test("native full Next proxy chain rejects invalid forwarding before persistence and preserves valid body, authentication and case checks", async () => {
  const h = await setup(), { f } = h;
  const before = await f.pool.query("SELECT count(*)::integer AS count FROM ls_identity.foundation_audit WHERE workspace_id=$1", [f.workspaceId]);
  for (const path of ["/api/goals", "/api/commitments", "/api/home-practice", "/api/checkins"]) {
    for (const headers of [{ "x-forwarded-proto": "http" }, { "x-forwarded-proto": "https,http" },
      { "x-forwarded-host": "evil.invalid" }, { "x-forwarded-host": "synthetic.example.invalid,evil.invalid" }, { host: "evil.invalid" }]) {
      const response = await h.proxyRequest("POST", path, h.draftInput(), f.practitioner.token, headers);
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
      expect(response.headers.get("x-middleware-next")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  }
  const untouched = await f.pool.query("SELECT count(*)::integer AS count FROM ls_practice.practice_assignment_versions WHERE workspace_id=$1", [f.workspaceId]);
  expect(untouched.rows[0].count).toBe(0);
  const after = await f.pool.query("SELECT count(*)::integer AS count FROM ls_identity.foundation_audit WHERE workspace_id=$1", [f.workspaceId]);
  expect(after.rows).toEqual(before.rows);
  expect((await h.proxyRequest("GET", h.listPath(), undefined, null)).status).toBe(401);
  expect((await h.proxyRequest("POST", "/api/home-practice", h.draftInput(), f.practitioner.token, { "x-csrf-token": "wrong" })).status).toBe(403);
  const created = await h.proxyRequest("POST", "/api/home-practice", h.draftInput()); expect(created.status).toBe(201);
  const saved = (await created.json()).data;
  const hidden = await h.proxyRequest("GET", h.listPath(), undefined, f.parent.token); expect(hidden.status).toBe(200); expect((await hidden.json()).data).toEqual([]);
  expect((await h.proxyRequest("POST", "/api/home-practice", { action: "publish", ...saved })).status).toBe(201);
  const visible = await h.proxyRequest("GET", h.listPath(), undefined, f.parent.token); expect(visible.status).toBe(200);
  expect((await visible.json()).data).toMatchObject([{ ...saved, instructions: h.draftInput().instructions }]);
  expect((await h.proxyRequest("GET", h.listPath(f.second), undefined, f.parent.token)).status).toBe(404);
});

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
  // Preserve the original two-guardian recipe as well as the exact-subject
  // child/adult participant regressions below. Coordination remains parent-authored.
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

test("native authorized child assignment and persistent check-in preserve replay, correction, frozen responsibility and current-access denials", async () => {
  const h = await setup(), { f } = h;
  const child = await h.clientIdentity("child"), otherChild = await h.clientIdentity("child", f.second);
  const saved = await h.publish();
  const coordinate = { action: "coordinate", assignmentId: saved.assignmentId,
    assigneeAccountIds: [f.parent.actor.id, child.actor.id], completionMode: "each_assignee",
    reminderCandidateAccountIds: [], effectiveFrom: new Date(Date.now() + 1000).toISOString() };
  expect((await h.request("POST", "/api/home-practice", coordinate, f.parent.token)).status).toBe(201);
  expect((await h.request("POST", "/api/home-practice", coordinate, child.token)).status).toBe(404);
  expect((await h.request("POST", "/api/home-practice", { ...coordinate, assigneeAccountIds: [otherChild.actor.id] }, f.parent.token)).status).toBe(404);
  const occurrences: string[] = [];
  for (const period of ["morning", "evening"]) {
    const r = await h.request("POST", "/api/home-practice", { action: "schedule", assignmentId: saved.assignmentId, occursOn: f.at(48).slice(0, 10), period });
    expect(r.status).toBe(201); occurrences.push((await r.json()).data.id as string);
  }
  const occurrenceId = occurrences[0]!, body = { occurrenceId, status: "done", idempotencyKey: randomUUID() };
  expect((await h.request("POST", "/api/checkins", body, child.token, { "x-csrf-token": "wrong" })).status).toBe(403);
  expect((await h.request("POST", "/api/checkins", body, child.token)).status).toBe(201);
  expect((await h.request("POST", "/api/checkins", body, child.token)).status).toBe(201);
  expect((await h.request("POST", "/api/checkins", { ...body, status: "not_done" }, child.token)).status).toBe(409);
  expect((await h.request("POST", "/api/checkins", { ...body, idempotencyKey: randomUUID() }, otherChild.token)).status).toBe(404);
  expect((await h.request("POST", "/api/checkins", { ...body, idempotencyKey: randomUUID() }, f.parentTwo.token)).status).toBe(404);
  expect((await f.pool.query("SELECT state FROM ls_practice.practice_occurrences WHERE workspace_id=$1 AND id=$2", [f.workspaceId, occurrenceId])).rows[0].state).toBe("open");
  const firstRead = await h.request("GET", `/api/checkins?occurrenceId=${occurrenceId}`, undefined, child.token);
  expect(firstRead.status).toBe(200); expect(firstRead.headers.get("cache-control")).toBe("private, no-store");
  const previous = (await firstRead.json()).data[0];
  expect(previous).toMatchObject({ authorAccountId: child.actor.id, revision: 1, status: "done" });
  expect((await h.request("POST", "/api/checkins", { ...body, status: "partly_done", idempotencyKey: randomUUID(), correctsReportId: previous.reportId }, child.token)).status).toBe(201);
  expect((await h.request("POST", "/api/checkins", { ...body, idempotencyKey: randomUUID() }, f.parent.token)).status).toBe(201);
  const history = (await (await h.request("GET", `/api/checkins?occurrenceId=${occurrenceId}`, undefined, child.token)).json()).data;
  expect(history).toHaveLength(3);
  expect(history).toMatchObject(expect.arrayContaining([previous, expect.objectContaining({ authorAccountId: child.actor.id, revision: 2, status: "partly_done", correctedReportId: previous.reportId })]));
  const frozen = await f.pool.query("SELECT assignee_account_ids FROM ls_practice.task_coordination_versions WHERE workspace_id=$1 AND assignment_id=$2", [f.workspaceId, saved.assignmentId]);
  expect(frozen.rows[0].assignee_account_ids).toEqual(coordinate.assigneeAccountIds);
  expect((await f.pool.query("SELECT period,state FROM ls_practice.practice_occurrences WHERE workspace_id=$1 ORDER BY period", [f.workspaceId])).rows).toEqual([{ period: "evening", state: "open" }, { period: "morning", state: "closed" }]);
  await expect(f.pool.query("UPDATE ls_practice.completion_reports SET status='not_done' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, previous.reportId])).rejects.toMatchObject({ code: "55000" });
  await expect(f.pool.query("DELETE FROM ls_practice.task_coordination_versions WHERE workspace_id=$1 AND assignment_id=$2", [f.workspaceId, saved.assignmentId])).rejects.toMatchObject({ code: "55000" });
  await f.pool.query("UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3", [f.workspaceId, f.first.id, child.actor.id]);
  expect((await h.request("POST", "/api/checkins", body, child.token)).status).toBe(404);
  expect((await h.request("GET", `/api/checkins?occurrenceId=${occurrenceId}`, undefined, child.token)).status).toBe(404);
  await expect(f.pool.query(`INSERT INTO ls_practice.completion_reports(id,workspace_id,occurrence_id,author_account_id,status,revision,reported_at,idempotency_key)
    VALUES($1,$2,$3,$4,'done',1,clock_timestamp(),$5)`, [randomUUID(), f.workspaceId, occurrences[1], child.actor.id, randomUUID()])).rejects.toMatchObject({ code: "23514" });
  expect((await f.pool.query("SELECT count(*)::integer AS count FROM ls_practice.completion_reports WHERE workspace_id=$1", [f.workspaceId])).rows[0].count).toBe(3);
});

test.each(["child", "adult_client"] as const)("native %s SQL participant guard requires exact case subject and current published audience without granting coordination authorship", async role => {
  const h = await setup(), { f } = h, subject = await h.clientIdentity(role), unrelated = await h.clientIdentity(role, f.second);
  const saved = await h.publish();
  const insert = (candidate: string, changedBy: string = f.parent.actor.id) => f.pool.query(`INSERT INTO ls_practice.task_coordination_versions
    (id,workspace_id,assignment_id,version,case_id,audience_id,assignee_account_ids,completion_mode,reminder_candidate_account_ids,effective_from,changed_by_account_id,created_at)
    VALUES($1,$2,$3,1,$4,$5,ARRAY[$6]::uuid[],'any_assignee','{}',clock_timestamp(),$7,clock_timestamp())`,
  [randomUUID(), f.workspaceId, saved.assignmentId, f.first.id, f.first.audienceId, candidate, changedBy]);
  // Even an explicit audience grant cannot make another case's subject eligible.
  await f.pool.query("INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,clock_timestamp())", [f.workspaceId, f.first.id, f.first.audienceId, unrelated.actor.id]);
  await expect(insert(unrelated.actor.id)).rejects.toMatchObject({ code: "23514" });
  await expect(insert(subject.actor.id, subject.actor.id)).rejects.toMatchObject({ code: "23514" });
  await expect(insert(subject.actor.id, f.outsider.actor.id)).rejects.toMatchObject({ code: "23514" });
  await f.pool.query("UPDATE ls_cases.audiences SET published=false WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.first.audienceId]);
  await expect(insert(subject.actor.id)).rejects.toMatchObject({ code: "23514" });
  await f.pool.query("UPDATE ls_cases.audiences SET published=true,visibility='private' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.first.audienceId]);
  await expect(insert(subject.actor.id)).rejects.toMatchObject({ code: "23514" });
  await f.pool.query("UPDATE ls_cases.audiences SET visibility='family_full' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.first.audienceId]);
  await insert(subject.actor.id);
  const scheduled = await h.request("POST", "/api/home-practice", { action: "schedule", assignmentId: saved.assignmentId, occursOn: f.at(48).slice(0, 10), period: "morning" });
  expect(scheduled.status).toBe(201);
  const occurrenceId = (await scheduled.json()).data.id;
  expect((await h.request("POST", "/api/checkins", { occurrenceId, status: "done", idempotencyKey: randomUUID() }, subject.token)).status).toBe(201);
  await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2", [f.workspaceId, subject.actor.id]);
  await expect(f.pool.query(`INSERT INTO ls_practice.completion_reports(id,workspace_id,occurrence_id,author_account_id,status,revision,reported_at,idempotency_key)
    VALUES($1,$2,$3,$4,'done',1,clock_timestamp(),$5)`, [randomUUID(), f.workspaceId, occurrenceId, subject.actor.id, randomUUID()])).rejects.toMatchObject({ code: "23514" });
});
