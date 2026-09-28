import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blankMetrics, metricSeries, validateObservationEvidence, type MetricRecord, type PrivateObservationEvidence } from "../../src/features/session-workflow/metrics.ts";
import { PrivateMetricTrend } from "../../src/ui/revamp/session-metrics.tsx";
const record = (sessionId: string, revision: number, score: number | null): MetricRecord => ({ schemaVersion: 1, workspaceId: "workspace", caseId: "case", sessionId, revision, recordedAt: "2026-09-28T11:00:00Z", recordedByAccountId: "practitioner", source: "practitioner_observation", values: { ...blankMetrics(), engagement: { score, notObservedReason: score === null ? "Not observed in this setting" : null, note: "Synthetic private context" } } });
const evidence = (): PrivateObservationEvidence => ({ workspaceId: "workspace", caseId: "case", sessions: [{ sessionId: "first", startsAt: "2026-09-21T08:00:00Z" }, { sessionId: "missing", startsAt: "2026-09-22T08:00:00Z" }, { sessionId: "last", startsAt: "2026-09-23T08:00:00Z" }], records: [record("first", 1, 4), record("first", 2, 7), record("last", 1, 6)] });
test("graph uses actual session dates/latest revisions, retaining unrecorded sessions as null gaps", () => {
  const e = evidence(); validateObservationEvidence(e, "case");
  const series = metricSeries(e.records, e.workspaceId, e.caseId, "engagement", e.sessions);
  expect(series.map(item => [item.sessionId, item.at, item.score])).toEqual([["first", e.sessions[0]!.startsAt, 7], ["missing", e.sessions[1]!.startsAt, null], ["last", e.sessions[2]!.startsAt, 6]]);
  expect(e.records.map(item => item.revision)).toEqual([1, 2, 1]);
});
test.each(["en", "he"] as const)("accessible %s individual graph never bridges a missing observation", locale => {
  const e = evidence(), markup = renderToStaticMarkup(createElement(PrivateMetricTrend, { locale, records: e.records, sessions: e.sessions, workspaceId: e.workspaceId, caseId: e.caseId, metric: "engagement" }));
  expect((markup.match(/<circle /g) ?? [])).toHaveLength(2);
  expect(markup).not.toContain('stroke-width="3"'); expect(markup).toContain("<table>"); expect(markup).toContain("<summary>");
  expect(markup).toContain(locale === "he" ? "לא נצפה" : "Not observed"); expect(markup).toContain("Synthetic private context");
});
test("history rejects mixed scopes, duplicated revisions, orphan sessions and invalid dates", () => {
  const e = evidence();
  expect(() => validateObservationEvidence(e, "other")).toThrow();
  for (const change of [{ workspaceId: "other" }, { records: [...e.records, e.records[0]!] }, { sessions: e.sessions.slice(1) }, { sessions: [{ sessionId: "first", startsAt: "2026-02-30T08:00:00Z" }] }]) expect(() => validateObservationEvidence({ ...e, ...change }, "case")).toThrow();
});
test("all nine unobserved scores remain null and explicit observed/unknown records remain separate", () => {
  const e = evidence(); e.records = [record("first", 1, null)]; validateObservationEvidence(e, "case");
  expect(Object.values(e.records[0]!.values).every(item => item.score === null)).toBe(true);
  expect(metricSeries(e.records, e.workspaceId, e.caseId, "engagement", e.sessions)[0]!.notObservedReason).toBe("Not observed in this setting");
});
