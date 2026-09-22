import { beforeEach, describe, expect, test, vi } from "vitest";

type State = {
  request: { id: string; requestId: string; emailBlind: string; createdAt: Date; processed: boolean };
  outbox: { id: string; accountId: string; state: string; attempts: number; ciphertext: string; expiresAt: Date; kind: "reset"; tokenDigest: string | null; providerId?: string };
  account: { id: string; state: "active" | "revoked"; emailVerifiedAt: Date | null };
  tokenPresent: boolean;
  failQuery?: string;
};

const h = vi.hoisted(() => ({ state: undefined as State | undefined, active: undefined as State | undefined, beforeSecond: undefined as (() => void) | undefined, issue: vi.fn(), record: vi.fn(), lock: vi.fn() }));
vi.mock("../../src/features/identity/data.ts", () => ({
  accountByEmail: vi.fn(async () => h.active?.account ?? null),
  accountById: vi.fn(async () => h.active?.account ?? null),
  lockWorkspace: h.lock,
}));
vi.mock("../../src/features/identity/store.ts", () => ({
  one: vi.fn(async (_tx: unknown, sql: string, values: readonly unknown[] = []) => {
    const s = h.active!;
    if (sql.includes("SELECT state,attempts")) return { state: s.outbox.state, attempts: s.outbox.attempts, providerId: s.outbox.providerId ?? null };
    if (sql.includes("FROM ls_identity.workspaces")) return { id: "workspace" };
    if (sql.includes("FROM ls_identity.reset_requests")) return s.request.processed || values[1] !== s.request.requestId ? null : s.request;
    if (sql.includes("auth_mail_outbox") && sql.includes("account_id=$2") && sql.includes("kind='reset'")) return s.outbox.state === "queued" ? { id: s.outbox.id } : null;
    if (sql.includes("auth_mail_outbox")) return s.outbox.state === "queued" && (values[2] === null || values[2] === undefined || values[2] === s.outbox.id) ? { ...s.outbox } : null;
    if (sql.includes("FROM ls_identity.auth_tokens")) return s.tokenPresent ? { tokenDigest: "digest" } : null;
    return null;
  }),
}));
vi.mock("../../src/features/identity/auth-mail.ts", () => ({ issueAuthToken: h.issue }));
vi.mock("../../src/features/identity/history.ts", () => ({ recordAction: h.record }));
vi.mock("../../src/features/identity/crypto.ts", () => ({ TOKEN_PATTERN: /^[A-Za-z0-9_-]{43}$/, unseal: () => JSON.stringify({ locale: "en", recipient: "owner@example.org", token: "a".repeat(43) }) }));
vi.mock("../../src/providers/email/template.ts", () => ({ authEmailContent: () => ({ subject: "reset", text: "reset" }) }));

import { processResetRequest, dispatchOneAuthMail } from "../../src/providers/email/dispatch.ts";
import type { IdentityStore } from "../../src/features/identity/store.ts";
import { AuthEmailDeliveryError } from "../../src/providers/email/transport.ts";

const config = { workspaceId: "workspace", origin: "https://life-skills.example.org", keyring: { activeKeyId: "k", keys: { k: Buffer.alloc(32) } } } as never;
const clock = { now: () => new Date("2026-09-17T12:00:00Z") } as never;
const base = (): State => ({
  request: { id: "request-row", requestId: "request-1", emailBlind: "blind", createdAt: new Date("2026-09-17T11:55:00Z"), processed: false },
  outbox: { id: "123e4567-e89b-12d3-a456-426614174000", accountId: "account", state: "queued", attempts: 0, ciphertext: "sealed", expiresAt: new Date("2026-09-18T12:00:00Z"), kind: "reset", tokenDigest: "digest" },
  account: { id: "account", state: "active", emailVerifiedAt: new Date("2026-09-01T00:00:00Z") }, tokenPresent: true,
});

function store(): IdentityStore {
  let gate = Promise.resolve();
  let transactions = 0;
  return { transaction: async work => {
    const turn = gate.then(async () => {
    transactions++; if (transactions === 2) h.beforeSecond?.();
    const s = h.state!; const before = structuredClone(s); h.active = s;
    try {
      async function query<T extends object>(sql: string): Promise<T[]> {
        if (s.failQuery && sql.includes(s.failQuery)) throw new Error("synthetic commit failure");
        if (sql.includes("SET processed_at")) s.request.processed = true;
        if (sql.includes("SET state='failed'") && sql.includes("auth_mail_outbox")) { s.outbox.state = "failed"; delete s.outbox.providerId; s.outbox.ciphertext = ""; s.outbox.attempts++; }
        if (sql.includes("SET state='sent'")) { s.outbox.state = "sent"; s.outbox.providerId = "gmail-id"; }
        if (sql.includes("SET attempts=attempts+1")) s.outbox.attempts++;
        return [] as T[];
      }
      const tx = { query };
      return await work(tx);
    } catch (e) { Object.assign(s, before); throw e; }
    finally { h.active = undefined; }
    });
    gate = turn.then(() => undefined, () => undefined);
    return turn;
  } } as IdentityStore;
}

beforeEach(() => { h.state = base(); h.beforeSecond = undefined; h.issue.mockReset(); h.record.mockReset(); h.lock.mockReset(); });

describe("durable auth-mail dispatch", () => {
  test("processes only the requested reset and leaves unrelated request/outbox untouched", async () => {
    const s = store(); const result = await processResetRequest(s, config, clock, "request-1");
    expect(result).toBe(h.state!.outbox.id); expect(h.state!.request.processed).toBe(true); expect(h.issue).toHaveBeenCalledTimes(1); expect(h.record).toHaveBeenCalledTimes(1);
  });

  test("serializes concurrent non-idempotent dispatches to one provider call", async () => {
    let sends = 0; const transport = { nonIdempotent: true, send: async () => { sends++; await new Promise(r => setTimeout(r, 10)); return { providerId: "gmail-id" }; } };
    const s = store(); const result = await Promise.all([dispatchOneAuthMail(s, config, clock, transport, "office@bneineviimacademy.org"), dispatchOneAuthMail(s, config, clock, transport, "office@bneineviimacademy.org")]);
    expect(sends).toBe(1); expect(result.sort()).toEqual(["idle", "sent"]); expect(h.state!.outbox.state).toBe("sent");
  });

  test("does not send if the pre-send reservation transaction rolls back", async () => {
    h.state!.failQuery = "SET state='failed'"; let sends = 0;
    const transport = { nonIdempotent: true, send: async () => { sends++; return { providerId: "gmail-id" }; } };
    await expect(dispatchOneAuthMail(store(), config, clock, transport, "office@bneineviimacademy.org")).rejects.toThrow("synthetic commit failure");
    expect(sends).toBe(0); expect(h.state!.outbox.state).toBe("queued");
  });

  test("does not replay after provider accepts but terminal DB write fails", async () => {
    let sends = 0; h.state!.failQuery = "SET state='sent'";
    const transport = { nonIdempotent: true, send: async () => { sends++; return { providerId: "gmail-id" }; } }; const s = store();
    expect(await dispatchOneAuthMail(s, config, clock, transport, "office@bneineviimacademy.org")).toBe("failed");
    expect(sends).toBe(1); expect(await dispatchOneAuthMail(s, config, clock, transport, "office@bneineviimacademy.org")).toBe("idle"); expect(sends).toBe(1);
  });

  test("keeps the idempotent Resend path retryable and outside Gmail reservation", async () => {
    let sends = 0; const transport = { send: async () => { expect(h.active).toBeTruthy(); sends++; if (sends === 1) throw new AuthEmailDeliveryError(true); return { providerId: "resend-id" }; } }; const s = store();
    expect(await dispatchOneAuthMail(s, config, clock, transport, "legacy@example.org")).toBe("retry");
    expect(await dispatchOneAuthMail(s, config, clock, transport, "legacy@example.org")).toBe("sent");
    expect(sends).toBe(2); expect(h.state!.outbox.state).toBe("sent");
  });

  test("rechecks revocation after the reservation commit and before provider send", async () => {
    h.beforeSecond = () => { h.state!.account.state = "revoked"; }; let sends = 0;
    const transport = { nonIdempotent: true, send: async () => { sends++; return { providerId: "gmail-id" }; } };
    expect(await dispatchOneAuthMail(store(), config, clock, transport, "office@bneineviimacademy.org")).toBe("canceled"); expect(sends).toBe(0);
  });

  test("an explicit outbox id cannot dispatch a different queued item", async () => {
    let sends = 0; const transport = { nonIdempotent: true, send: async () => { sends++; return { providerId: "gmail-id" }; } };
    expect(await dispatchOneAuthMail(store(), config, clock, transport, "office@bneineviimacademy.org", "123e4567-e89b-12d3-a456-426614174001")).toBe("idle"); expect(sends).toBe(0);
  });

  test.each([{ label: "revoked account", account: { state: "revoked" as const, emailVerifiedAt: new Date() } }, { label: "missing token", tokenPresent: false }, { label: "expired outbox", expired: true }])("cancels before send when eligibility changes: $label", ({ account, tokenPresent, expired }) => {
    if (account) h.state!.account = { ...h.state!.account, ...account }; if (tokenPresent === false) h.state!.tokenPresent = false;
    if (expired) h.state!.outbox.expiresAt = new Date("2026-09-17T11:59:00Z");
    let sends = 0; const transport = { nonIdempotent: true, send: async () => { sends++; return { providerId: "gmail-id" }; } };
    return expect(dispatchOneAuthMail(store(), config, clock, transport, "office@bneineviimacademy.org")).resolves.toBe("canceled").then(() => expect(sends).toBe(0));
  });
});
