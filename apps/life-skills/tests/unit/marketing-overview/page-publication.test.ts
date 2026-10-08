import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ bridge: vi.fn() }));
vi.mock("../../../src/features/prospects/bridge.ts", () => ({ crmBridge: mocks.bridge }));

const record = () => ({
  id: "private-row-id",
  state: "UNKNOWN",
  localBusinessDate: "2026-10-08",
  scheduledAt: "2026-10-08T17:00:00.000Z",
  providerReadAt: null,
  publishedAt: null,
  noBlindRetry: true,
});
const source = () => ({
  state: "UNCONFIGURED_DESTINATION",
  reason: "FACEBOOK_PAGE_BINDING_UNVERIFIED",
  lifecycleState: "BLOCKED",
  mode: "disabled_read_only",
  destinationConfigured: false,
  providerEvidenceAvailable: false,
  externalWriteEnabled: false,
  externalWritePerformed: false,
  noBlindRetry: false,
  recentRecords: [record()],
});

beforeEach(() => { vi.resetModules(); mocks.bridge.mockReset(); mocks.bridge.mockResolvedValue({ success: true, publication: source() }); });

test("loads only a bounded redacted read model and drops source identifiers", async () => {
  const { loadFacebookPagePublicationState } = await import("../../../src/features/marketing-overview/page-publication-provider.ts");
  const result = await loadFacebookPagePublicationState();
  expect(mocks.bridge).toHaveBeenCalledExactlyOnceWith("/api/bna/life-skills-app/marketing/facebook-page-publication");
  expect(result).toMatchObject({ state: "UNCONFIGURED_DESTINATION", externalWriteEnabled: false, externalWritePerformed: false });
  expect(result.recentRecords).toEqual([{ state: "UNKNOWN", localBusinessDate: "2026-10-08", scheduledAt: "2026-10-08T17:00:00.000Z", providerReadAt: null, publishedAt: null, noBlindRetry: true }]);
  expect(JSON.stringify(result)).not.toContain("private-row-id");
});

test("bridge and malformed payload failures are unavailable rather than empty success", async () => {
  const { loadFacebookPagePublicationState } = await import("../../../src/features/marketing-overview/page-publication-provider.ts");
  mocks.bridge.mockRejectedValueOnce(Error("synthetic unavailable"));
  expect(await loadFacebookPagePublicationState()).toMatchObject({ state: "BRIDGE_UNAVAILABLE", recentRecords: [], externalWriteEnabled: false });
  mocks.bridge.mockResolvedValueOnce({ success: true, publication: { ...source(), lifecycleState: "INVENTED" } });
  expect(await loadFacebookPagePublicationState()).toMatchObject({ state: "BRIDGE_UNAVAILABLE" });
});

test.each([
  { externalWriteEnabled: true },
  { externalWritePerformed: true },
  { recentRecords: Array.from({ length: 51 }, record) },
  { recentRecords: [{ ...record(), scheduledAt: "not-a-date" }] },
  { recentRecords: [{ ...record(), scheduledAt: "2026-10-08" }] },
  { recentRecords: [{ ...record(), scheduledAt: "2026-10-08T17:00:00Z" }] },
  { recentRecords: [{ ...record(), id: "x".repeat(129) }] },
  { recentRecords: [{ ...record(), id: Number.MAX_SAFE_INTEGER + 1 }] },
  { recentRecords: [{ ...record(), id: -1 }] },
  { recentRecords: [{ ...record(), extra: "not allowed" }] },
  { state: "UNKNOWN_DELIVERY_NO_RETRY", noBlindRetry: false },
  { state: "PUBLISHED_READBACK_VERIFIED", lifecycleState: "PUBLISHED", providerEvidenceAvailable: false },
  { state: "UNCONFIGURED_DESTINATION", destinationConfigured: true },
  { recentRecords: [{ ...record(), noBlindRetry: false }] },
])("rejects unsafe or unbounded source payloads: %j", async patch => {
  const { parseFacebookPagePublicationState } = await import("../../../src/features/marketing-overview/page-publication-provider.ts");
  expect(() => parseFacebookPagePublicationState({ ...source(), ...patch })).toThrow();
});

test("rejects inherited required fields", async () => {
  const { parseFacebookPagePublicationState } = await import("../../../src/features/marketing-overview/page-publication-provider.ts");
  const inherited = Object.assign(Object.create({ state: "UNCONFIGURED_DESTINATION" }), source());
  delete inherited.state;
  expect(() => parseFacebookPagePublicationState(inherited)).toThrow();
  const inheritedRecord = Object.assign(Object.create(record()), {});
  expect(() => parseFacebookPagePublicationState({ ...source(), recentRecords: [inheritedRecord] })).toThrow();
});

test.each(["en", "he"] as const)("renders honest read-only states in %s without publication controls or identifiers", async locale => {
  const { FacebookPagePublicationStatus } = await import("../../../src/ui/revamp/facebook-page-publication-status.tsx");
  const { parseFacebookPagePublicationState, unavailableFacebookPagePublicationState } = await import("../../../src/features/marketing-overview/page-publication-provider.ts");
  const states = [
    parseFacebookPagePublicationState(source()),
    unavailableFacebookPagePublicationState(),
    parseFacebookPagePublicationState({ ...source(), state: "ASSET_HELD", reason: "EXACT_APPROVED_FEED_ASSET_REQUIRED" }),
    parseFacebookPagePublicationState({ ...source(), state: "READBACK_UNAVAILABLE", lifecycleState: "ACCEPTED", destinationConfigured: true }),
    parseFacebookPagePublicationState({ ...source(), state: "UNKNOWN_DELIVERY_NO_RETRY", lifecycleState: "UNKNOWN", destinationConfigured: true, noBlindRetry: true }),
  ];
  for (const publication of states) {
    const html = renderToStaticMarkup(React.createElement(FacebookPagePublicationStatus, { locale, publication }));
    expect(html).toContain(locale === "en" ? "Separate Facebook Page" : "דף Facebook נפרד");
    expect(html).toContain(locale === "en" ? "This panel cannot schedule, publish, retry or approve content." : "לוח זה אינו יכול לתזמן, לפרסם, לנסות שוב או לאשר תוכן.");
    expect(html).not.toMatch(/<(button|form)\b/);
    expect(html).not.toContain("private-row-id");
    expect(html).not.toContain("FACEBOOK_PAGE_BINDING_UNVERIFIED");
  }
});

test("unknown delivery keeps the no-blind-retry warning visible", async () => {
  const { FacebookPagePublicationStatus } = await import("../../../src/ui/revamp/facebook-page-publication-status.tsx");
  const { parseFacebookPagePublicationState } = await import("../../../src/features/marketing-overview/page-publication-provider.ts");
  const publication = parseFacebookPagePublicationState({ ...source(), state: "UNKNOWN_DELIVERY_NO_RETRY", lifecycleState: "UNKNOWN", destinationConfigured: true, noBlindRetry: true });
  const html = renderToStaticMarkup(React.createElement(FacebookPagePublicationStatus, { locale: "en", publication }));
  expect(html).toContain('role="alert"');
  expect(html).toContain("Do not retry while delivery is unresolved");
});

test("composed workspace styling flattens the Page status and uses the gold keyboard focus token", () => {
  const css = readFileSync(new URL("../../../src/ui/revamp/styles.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.lsr-page-publication-state\{[^}]*border-inline-start:4px solid var\(--r-teal\)[^}]*border-block-end:1px solid var\(--r-line\)/);
  const stateRule = css.match(/\.lsr-page-publication-state\{([^}]*)\}/)?.[1] ?? "";
  expect(stateRule).not.toContain("border-radius");expect(stateRule).not.toContain("background:");
  expect(css).toContain(".lsw.lsu .lsr-page-publication-state h3{font-weight:700}");
  expect(css).toContain(".lsr-page-publication-state .lsr-help{font-size:16px}");
  expect(css).toContain('.lsw.lsu[lang=en] .lsr :is(h1,h2,h3){font-family:Georgia,"Times New Roman",serif}');
  expect(css).toContain(".lsw.lsu .lsr :focus-visible{outline:3px solid var(--ui-gold);outline-offset:4px}");
});
