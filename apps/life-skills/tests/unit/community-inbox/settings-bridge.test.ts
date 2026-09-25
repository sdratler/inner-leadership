import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readCommunitySettings } from "../../../src/features/community-reply/settings-bridge.ts";

const secret = "S".repeat(43);
const settings = { asOf: "2026-09-25T00:00:00.000Z",
  collection: { authorized: false, allowedGroupCount: 0, active: false, maxItemsPerRun: 20, workerEnabled: true, autoDraft: false },
  limits: { aiRequestsPerUtcDay: 30, manualReplyTotal: 1, manualReplyUsed: 0, manualReplyRemaining: 1 },
  usageTodayUtc: { requests: 0, inputTokens: 0, outputTokens: 0, moneyCost: null },
  queue: { jobs: {}, posts: {} } };

describe("Community Scout settings bridge", () => {
  it("reads only the registered Scout endpoint with a server-only secret", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, data: settings }));
    await expect(readCommunitySettings(fetcher, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).resolves.toEqual(settings);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://community-scout-production.up.railway.app/internal/life-skills/settings");
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe(`Bearer ${secret}`);
    expect(options.cache).toBe("no-store");
  });
  it("fails closed on missing secret, an unverified money estimate, or inconsistent limits", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, data: { ...settings, usageTodayUtc: { ...settings.usageTodayUtc, moneyCost: 0 } } }));
    await expect(readCommunitySettings(fetcher, {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(readCommunitySettings(fetcher, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, data: { ...settings, limits: { ...settings.limits, manualReplyRemaining: 999 } } }));
    await expect(readCommunitySettings(fetcher, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
