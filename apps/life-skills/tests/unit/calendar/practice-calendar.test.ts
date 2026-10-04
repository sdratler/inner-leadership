import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { asId } from "../../../src/lib/ids.ts";
import { CalendarAgenda, CalendarBoard } from "../../../src/features/calendar/views.tsx";
import { PracticeCalendarEntry } from "../../../src/features/home-practice/calendar-entry.tsx";
import { calendarCopy } from "../../../src/features/calendar/copy.ts";
import type { PracticeOccurrenceItem } from "../../../src/features/home-practice/types.ts";
const id = "00000000-0000-4000-8000-000000000001", noop = () => {};
const row: PracticeOccurrenceItem = {
  occurrence: { id: asId(id,"occurrence"), assignmentId: asId(id,"practice_assignment"), practiceVersionId: asId(id,"practice_version"), coordinationVersionId: asId(id,"coordination_version"), occursOn: "2026-10-05", period: "morning", state: "open", occursAt: "2026-10-05T04:35:00Z" },
  practice: { workspaceId: asId(id,"workspace"), caseId: asId(id,"case"), assignmentId: asId(id,"practice_assignment"), versionId: asId(id,"practice_version"), version: 1, audienceId: asId(id,"audience"), goalId: null, commitmentId: null, templateKey: "DEMO practice", templateVersion: "v1", instructions: "PRIVATE_INSTRUCTION_NOT_IN_CALENDAR_SUMMARY", startsOn: "2026-10-05", endsOn: null, publishedAt: "2026-10-01T12:00:00Z", immutableSnapshotDigest: "a".repeat(64) },
  canReport: true, ownReport: null, schedule: { participant: "client", caseKind: "minor", localTime: "07:35", timezone: "Asia/Jerusalem", timeOrigin: "practitioner" }
};
test.each(["en","he"] as const)("%s Calendar uses the actual dated protected occurrence, not an empty placeholder or inline form", locale => {
  const board = renderToStaticMarkup(createElement(CalendarBoard, {dates:["2026-10-05","2026-10-06"], items:[], locale, view:"week", names:{}, onOpen:noop, practice:[row], onOpenPractice:noop}));
  expect(board).toContain(`data-practice-occurrence-id="${id}"`);
  const first = board.slice(board.indexOf('aria-labelledby="day-2026-10-05"'),board.indexOf('aria-labelledby="day-2026-10-06"'));
  expect(first).not.toContain('ls-cal-day-empty'); expect(board).toContain('ls-cal-day-empty');
  expect(first).toContain("07:35"); expect(first).toContain("Asia/<wbr/>Jerusalem");
  expect(first).toContain(locale==="he"?"תרגול לילד":"Child practice");
  expect(board).not.toContain("<form"); expect(board).not.toContain(row.practice.instructions);
  expect(board).toContain('aria-controls="ls-calendar-practice-detail"');expect(board).not.toContain('href="#');
  const agenda = renderToStaticMarkup(createElement(CalendarAgenda, {items:[], locale, names:{}, onOpen:noop, practice:[row], onOpenPractice:noop}));
  expect(agenda).toContain('dateTime="2026-10-05"');expect(agenda).toContain(`data-practice-occurrence-id="${id}"`);
  expect(agenda).not.toContain("<form");expect(agenda).not.toContain(row.practice.instructions);
});
test.each(["en","he"] as const)("%s Calendar retains canceled/completed state and does not infer absent schedule metadata", locale => {
  const closed = renderToStaticMarkup(createElement(PracticeCalendarEntry, {item:{...row,occurrence:{...row.occurrence,state:"cancelled"}},locale,onOpen:noop}));
  expect(closed).toContain(locale==="he"?"בוטל":"Cancelled");
  const historical={...row};delete historical.schedule;
  const old = renderToStaticMarkup(createElement(PracticeCalendarEntry, {item:historical,locale,onOpen:noop}));
  expect(old).toContain(locale==="he"?"לא נרשמה שעה":"Time not recorded");expect(old).not.toContain("07:35");
  const adult = renderToStaticMarkup(createElement(PracticeCalendarEntry, {item:{...row,schedule:{...row.schedule!,caseKind:"adult"}},locale,onOpen:noop}));
  expect(adult).toContain(locale==="he"?"תרגול לבוגר":"Adult practice");expect(adult).not.toContain(locale==="he"?"תרגול לילד":"Child practice");
});

test.each(["en","he"] as const)("%s individual appointments do not assume a child and compact entries retain timezone and action semantics", locale => {
  expect(calendarCopy[locale].individual).toBe(locale === "he" ? "פגישה אישית · 60 דקות" : "Individual appointment · 60 minutes");
  const html = renderToStaticMarkup(createElement(PracticeCalendarEntry, {item:row,locale,onOpen:noop}));
  expect(html).toContain('<bdi>07:35</bdi>');
  expect(html).toContain('<bdi class="ls-cal-practice-zone">Asia/<wbr/>Jerusalem</bdi>');
  expect(html).toContain('class="ls-cal-practice-open"');
  expect(html).toContain(locale === "he" ? "פתיחת התרגול" : "Open practice");
  const otherZone = renderToStaticMarkup(createElement(PracticeCalendarEntry, {item:{...row,schedule:{...row.schedule!,timezone:"Europe/London"}},locale,onOpen:noop}));
  expect(otherZone).toContain('<bdi>Europe/<wbr/>London</bdi>');
  expect(otherZone).not.toContain('class="ls-cal-practice-zone"');
});
test("Calendar keeps one selected retained report form, same-scope reloads, dirty-close confirmation and uncertain-save lock", () => {
  const source=readFileSync(new URL('../../../src/features/home-practice/occurrence-workspace.tsx',import.meta.url),'utf8');
  expect(source).toContain('useDialogGuard("ls-calendar-practice-detail", hasDirty, calendarLocked');
  expect(source).toContain('onLockChange={setCalendarLocked}');
  expect(source).toContain('onLockChange?.(phase === "saving" || phase === "uncertain")');
  expect(source).toContain('!renderCalendar && <div');
  expect(source).toContain('if (calendarLocked || (hasDirty && !window.confirm(t.dirty))) return;');
  expect(source).toContain('previous.key === key && previous.readBinding === readBinding ? previous');
  expect(source).toContain('readEnabled && caseId && state.key === key && state.readBinding === readBinding ? state.page.items : []');
  expect(source).toContain('PracticeOccurrenceCard key={key + ":" + selected.occurrence.id}');
});

test("re-enabling practice requires a new read binding before any cached private cards or dialog can render", () => {
  const source=readFileSync(new URL('../../../src/features/home-practice/occurrence-workspace.tsx',import.meta.url),'utf8');
  expect(source).toContain('useMemo(() => ({ key, readEnabled }), [key, readEnabled])');
  expect(source).toContain('setState({ key, readBinding, status: "ready", page })');
  expect(source).toContain('state.key !== key || state.readBinding !== readBinding ? <p role="status">{t.loading}</p>');
  expect(source).toContain('const selected = calendarItems.find');
  expect(source).toContain('!denied && previous.key === key && previous.readBinding === readBinding ? previous.page');
});
test("appointment unavailability stays visible without suppressing independent layers or exposing stale appointments",()=>{
  const source=readFileSync(new URL('../../../src/features/calendar/workspace.tsx',import.meta.url),'utf8');
  expect(source).toContain("readEnabled={showPractice&&error!=='auth'&&error!=='forbidden'}");
  expect(source).not.toContain(':error?<ErrorState');expect(source).toContain('Appointments could not load. Other available calendar layers are still shown.');expect(source).toContain('Retry appointments');
  expect(source.match(/items=\{error\?\[\]:items\}/g)).toHaveLength(2);expect(source).toContain('!error&&!caseError&&!cases.length');
});
