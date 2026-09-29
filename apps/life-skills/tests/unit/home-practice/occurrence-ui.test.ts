import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { asId } from "../../../src/lib/ids.ts";
import { PracticeOccurrenceCard } from "../../../src/features/home-practice/occurrence-workspace.tsx";
import type { PracticeOccurrenceItem } from "../../../src/features/home-practice/types.ts";
import { parentReturnPath } from "../../../src/features/identity/login-return.ts";

const id = "00000000-0000-4000-8000-000000000001";
function item(): PracticeOccurrenceItem {
  return { occurrence: { id: asId(id, "occurrence"), assignmentId: asId(id, "practice_assignment"), practiceVersionId: asId(id, "practice_version"), coordinationVersionId: asId(id, "coordination_version"), occursOn: "2026-09-29", period: "morning", state: "open" },
    practice: { workspaceId: asId(id, "workspace"), caseId: asId(id, "case"), assignmentId: asId(id, "practice_assignment"), versionId: asId(id, "practice_version"), audienceId: asId(id, "audience"), version: 1, goalId: null, commitmentId: null, templateKey: "DEMO practice", templateVersion: "synthetic-v1", instructions: "<script>DEMO — synthetic instruction</script>", startsOn: "2026-09-29", endsOn: null, publishedAt: "2026-09-29T06:00:00.000Z", immutableSnapshotDigest: "a".repeat(64) }, canReport: true, ownReport: null };
}
const noop = () => {};
test("parent check-in deep link remains a bounded real practice route across sign-in", () => {
  expect(parentReturnPath("he", "/he/family/practice", {caseId:id,audienceId:id,section:"checkins",unknown:"bad"})).toBe(`/he/family/practice?caseId=${id}&audienceId=${id}&section=checkins`);
  expect(parentReturnPath("en", "/en/family/practice", {section:"untrusted"})).toBe("/en/family/practice");
});
test.each(["en", "he"] as const)("%s occurrence has readable collapsed details and real labeled reporting controls", locale => {
  const html = renderToStaticMarkup(createElement(PracticeOccurrenceCard, { locale, item: item(), onReadback: noop, onAccessLost: noop, onDirty: noop }));
  expect(html).not.toContain("<details open"); expect(html).not.toContain(' open=""');
  expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain('id="practice-result-' + id); expect(html).toContain('for="practice-result-' + id);
  expect(html).toContain('<option value="done">'); expect(html).toContain('<option value="not_done">');
  expect(html).toContain(locale === "he" ? "טרם דווח" : "Unreported");
  expect(html).not.toContain('href="#'); expect(html).not.toContain("role-switch");
});
test("unassigned or closed/unreported occurrences never expose a reporting form", () => {
  for (const row of [{ ...item(), canReport: false }, { ...item(), occurrence: { ...item().occurrence, state: "closed" as const } }]) {
    const html = renderToStaticMarkup(createElement(PracticeOccurrenceCard, { locale: "en", item: row, onReadback: noop, onAccessLost: noop, onDirty: noop }));
    expect(html).not.toContain("<form"); expect(html).toContain("Unreported");
  }
});
