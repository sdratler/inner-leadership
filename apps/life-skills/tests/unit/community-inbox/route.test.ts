import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../../src/lib/security/session.ts";

const hooks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../src/features/identity/runtime.ts", () => ({ identityRuntime: async () => ({ services: { sessions: { actor: hooks.actor } } }) }));
vi.mock("../../../src/features/community-inbox/bridge.ts", () => ({ readCommunityInbox: hooks.read }));
import { GET } from "../../../src/app/api/community-posts/route.ts";

describe("practitioner-only captured post route", () => {
  it("rejects an unauthenticated request before reading the Scout inbox", async () => {
    hooks.read.mockClear();
    const response = await GET(new Request("https://life-skills.bneineviimacademy.org/api/community-posts"));
    expect(response.status).toBe(401);
    expect(hooks.read).not.toHaveBeenCalled();
  });
  it("rejects a parent even with a valid session", async () => {
    hooks.actor.mockResolvedValueOnce({ role: "parent" }); hooks.read.mockClear();
    const response = await GET(new Request("https://life-skills.bneineviimacademy.org/api/community-posts", { headers: { cookie: `${SESSION_COOKIE}=synthetic-token` } }));
    expect(response.status).toBe(403);
    expect(hooks.read).not.toHaveBeenCalled();
  });
  it("reads a filtered page for the practitioner without caching", async () => {
    hooks.actor.mockResolvedValueOnce({ role: "practitioner" });
    hooks.read.mockResolvedValueOnce({ items: [], nextCursor: null, commentsCaptureAvailable: false });
    const response = await GET(new Request("https://life-skills.bneineviimacademy.org/api/community-posts?status=ready", { headers: { cookie: `${SESSION_COOKIE}=synthetic-token` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(hooks.read).toHaveBeenCalledWith("ready", "");
  });
});
