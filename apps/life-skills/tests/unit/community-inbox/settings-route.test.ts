import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../../src/lib/security/session.ts";

const hooks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../src/features/identity/runtime.ts", () => ({ identityRuntime: async () => ({ services: { sessions: { actor: hooks.actor } } }) }));
vi.mock("../../../src/features/community-reply/settings-bridge.ts", () => ({ readCommunitySettings: hooks.read }));
import { GET } from "../../../src/app/api/community-settings/route.ts";

const url = "https://life-skills.bneineviimacademy.org/api/community-settings";
const session = { headers: { cookie: `${SESSION_COOKIE}=synthetic-token` } };
describe("practitioner-only Scout settings route", () => {
  it("does not read Scout settings without a session", async () => {
    hooks.read.mockClear();
    const response = await GET(new Request(url));
    expect(response.status).toBe(401);
    expect(hooks.read).not.toHaveBeenCalled();
  });
  it("denies a parent and does not expose settings", async () => {
    hooks.actor.mockResolvedValueOnce({ role: "parent" }); hooks.read.mockClear();
    const response = await GET(new Request(url, session));
    expect(response.status).toBe(403);
    expect(hooks.read).not.toHaveBeenCalled();
  });
  it("returns fresh settings only to the practitioner", async () => {
    hooks.actor.mockResolvedValueOnce({ role: "practitioner" });
    hooks.read.mockResolvedValueOnce({ asOf: "2026-09-25T00:00:00Z" });
    const response = await GET(new Request(url, session));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data.asOf).toBe("2026-09-25T00:00:00Z");
  });
});
