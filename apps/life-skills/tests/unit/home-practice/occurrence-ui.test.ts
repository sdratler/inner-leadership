import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { asId } from "../../../src/lib/ids.ts";
import { PracticeOccurrenceCard } from "../../../src/features/home-practice/occurrence-workspace.tsx";
import type { PracticeOccurrenceItem } from "../../../src/features/home-practice/types.ts";
import { parentReturnPath } from "../../../src/features/identity/login-return.ts";
import * as practiceClient from "../../../src/features/home-practice/occurrence-client.ts";
import type { CompletionView, PracticeOccurrencePage } from "../../../src/features/home-practice/types.ts";

const id = "00000000-0000-4000-8000-000000000001";
function item(): PracticeOccurrenceItem {
  return { occurrence: { id: asId(id, "occurrence"), assignmentId: asId(id, "practice_assignment"), practiceVersionId: asId(id, "practice_version"), coordinationVersionId: asId(id, "coordination_version"), occursOn: "2026-09-29", period: "morning", state: "open" },
    practice: { workspaceId: asId(id, "workspace"), caseId: asId(id, "case"), assignmentId: asId(id, "practice_assignment"), versionId: asId(id, "practice_version"), audienceId: asId(id, "audience"), version: 1, goalId: null, commitmentId: null, templateKey: "DEMO practice", templateVersion: "synthetic-v1", instructions: "<script>DEMO — synthetic instruction</script>", startsOn: "2026-09-29", endsOn: null, publishedAt: "2026-09-29T06:00:00.000Z", immutableSnapshotDigest: "a".repeat(64) }, canReport: true, ownReport: null };
}
const noop = () => {};
test.each(["en", "he"] as const)("%s practice labels follow the authorized case kind, never the viewer role", locale => {
  const labels = locale === "he" ? { minor: "תרגול לילד", adult: "תרגול לבוגר", unknown: "תרגול למטופל", parent: "תמיכת הורים" } : { minor: "Child practice", adult: "Adult practice", unknown: "Client practice", parent: "Parent support" };
  for (const caseKind of ["minor", "adult", undefined] as const) {
    for (const role of ["parent", "adult_client", "child", "practitioner"] as const) {
      const row: PracticeOccurrenceItem = { ...item(), schedule: { participant: "client", localTime: "18:45", timezone: "UTC", timeOrigin: "practitioner", ...(caseKind ? { caseKind } : {}) } };
      const html = renderToStaticMarkup(createElement(PracticeOccurrenceCard, { locale, role, item: row, onReadback: noop, onAccessLost: noop, onDirty: noop }));
      expect(html).toContain(`${caseKind ? labels[caseKind] : labels.unknown} · 18:45 · UTC`);
      expect(html).not.toContain(locale === "he" ? "תרגול לילד או לבוגר" : "Child / adult practice");
      const parent = renderToStaticMarkup(createElement(PracticeOccurrenceCard, { locale, role, item: { ...row, schedule: { ...row.schedule!, participant: "parent" } }, onReadback: noop, onAccessLost: noop, onDirty: noop }));
      expect(parent).toContain(`${labels.parent} · 18:45 · UTC`);
    }
  }
});
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
test.each(["en","he"]as const)("%s authorized parent-assisted form keeps optional feedback collapsed and exact clock visible",locale=>{
 const row:PracticeOccurrenceItem={...item(),assistanceModes:["together","parent_report"],schedule:{participant:"client",localTime:"18:45",timezone:"UTC",timeOrigin:"practitioner"}};
 const html=renderToStaticMarkup(createElement(PracticeOccurrenceCard,{locale,item:row,onReadback:noop,onAccessLost:noop,onDirty:noop}));
 expect(html).toContain('value="together"');expect(html).toContain('value="parent_report"');expect(html).toContain('maxLength="2000"');expect(html).not.toContain('<details open');expect(html).toContain("18:45 · UTC");
 expect(html).toContain(locale==="he"?"משוב נוסף (רשות)":"Optional feedback");
 const cancelled=renderToStaticMarkup(createElement(PracticeOccurrenceCard,{locale,item:{...row,occurrence:{...row.occurrence,state:"cancelled"}},onReadback:noop,onAccessLost:noop,onDirty:noop}));expect(cancelled).not.toContain("<form");expect(cancelled).toContain(locale==="he"?"אין לדווח עליו":"cannot be reported");
 const owner=renderToStaticMarkup(createElement(PracticeOccurrenceCard,{locale,role:"practitioner",item:{...row,canReport:false},onReadback:noop,onAccessLost:noop,onDirty:noop}));expect(owner).toContain(locale==="he"?"הדיווחים שנשמרו":"Saved reports");expect(owner).not.toContain("<form");
});
test("one denied audience removes only its private cards, preserving other audience drafts", () => {
  const first=item(),other={...item(),occurrence:{...item().occurrence,id:asId("00000000-0000-4000-8000-000000000002","occurrence")},practice:{...item().practice,audienceId:asId("00000000-0000-4000-8000-000000000002","audience")}};
  const page:PracticeOccurrencePage={items:[first,other],hasMore:false};
  const next=practiceClient.practiceAccessLossPage(page,first.occurrence.id,"NOT_FOUND");
  expect(next.items).toEqual([other]);expect(page.items).toEqual([first,other]);
  expect(practiceClient.practiceDraftIds([first.occurrence.id,other.occurrence.id],next)).toEqual([other.occurrence.id]);
  expect(practiceClient.practiceAccessLossPage(page,first.occurrence.id,"UNAUTHENTICATED")).toEqual({items:[],hasMore:false});
});
test.each(["en", "he"] as const)("%s practitioner heading shows the actual occurrence state, not a nonexistent own report", locale => {
  const labels = locale === "he" ? { open: "פתוח", closed: "סגור", cancelled: "בוטל" } : { open: "Open", closed: "Closed", cancelled: "Cancelled" };
  for (const state of ["open", "closed", "cancelled"] as const) {
    const row: PracticeOccurrenceItem = { ...item(), canReport: false, occurrence: { ...item().occurrence, state } };
    const html = renderToStaticMarkup(createElement(PracticeOccurrenceCard, { locale, role: "practitioner", item: row, onReadback: noop, onAccessLost: noop, onDirty: noop }));
    expect(html).toContain(`<strong>${labels[state]}</strong>`);
    expect(html).not.toContain(`<strong>${locale === "he" ? "טרם דווח" : "Unreported"}</strong>`);
    expect(html).not.toContain("<form");
  }
  const own = { ...item(), occurrence: { ...item().occurrence, state: "closed" as const }, ownReport: { reportId: asId(id, "completion_report"), occurrenceId: asId(id, "occurrence"), authorAccountId: asId(id, "account"), status: "partly_done" as const, revision: 1, reportedAt: "2026-09-29T06:00:00.000Z", correctedReportId: null } };
  const customer = renderToStaticMarkup(createElement(PracticeOccurrenceCard, { locale, role: "parent", item: own, onReadback: noop, onAccessLost: noop, onDirty: noop }));
  expect(customer).toContain(`<strong>${locale === "he" ? "בוצע חלקית" : "Partly done"}</strong>`);
});
test("a discovery/read race removes the exact denied audience even without a denied card ID",()=>{
 const first=item(),other={...item(),occurrence:{...item().occurrence,id:asId("00000000-0000-4000-8000-000000000002","occurrence")},practice:{...item().practice,audienceId:asId("00000000-0000-4000-8000-000000000002","audience")}};
 const page:PracticeOccurrencePage={items:[first,other],hasMore:true};
 expect(practiceClient.practiceAudienceLossPage(page,first.practice.audienceId)).toEqual({items:[other],hasMore:true});
 expect(practiceClient.practiceAudienceLossPage(page,"already-absent")).toEqual(page);
 expect(page.items).toEqual([first,other]);
});
test("fresh discovery prunes removed or newly read-only dirty cards rather than warning about invisible input", () => {
  const first=item(),second={...item(),occurrence:{...item().occurrence,id:asId("00000000-0000-4000-8000-000000000002","occurrence")},canReport:false};
  expect(practiceClient.practiceDraftIds([first.occurrence.id,second.occurrence.id,"removed"],{items:[first,second],hasMore:false})).toEqual([first.occurrence.id]);
  expect(practiceClient.practiceDraftIds([first.occurrence.id],{items:[{...first,occurrence:{...first.occurrence,state:"closed"}}],hasMore:false})).toEqual([]);
});
const report:CompletionView={reportId:asId(id,"completion_report"),occurrenceId:asId(id,"occurrence"),authorAccountId:asId(id,"account"),status:"done",revision:1,reportedAt:"2026-09-29T06:00:00.000Z",correctedReportId:null};
const newer:CompletionView={...report,reportId:asId("00000000-0000-4000-8000-000000000002","completion_report"),status:"partly_done",revision:2,correctedReportId:report.reportId};
test("clean mounted cards accept a newer own report without regressing a locally confirmed write",()=>{
  expect(practiceClient.incomingPracticeReport(null,report,false,false)).toEqual(report);
  expect(practiceClient.incomingPracticeReport(report,newer,false,false)).toEqual(newer);
  expect(practiceClient.incomingPracticeReport(newer,report,false,false)).toEqual(newer);
  expect(practiceClient.incomingPracticeReport(newer,null,false,false)).toEqual(newer);
});
test.each([[true,false],[false,true],[true,true]])("incoming report preserves draft=%s or uncertain/conflict lock=%s",(dirty,locked)=>{
  expect(practiceClient.incomingPracticeReport(report,newer,dirty,locked)).toEqual(report);
});
