import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { sessionAppointmentListPath, visibleSessionAppointments } from "../../src/features/session-workflow/workspace.tsx";
import type { SessionListItem } from "../../src/features/session-workflow/database.ts";
import Page from "../../src/app/[locale]/app/cases/[caseId]/sessions/page.tsx";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), notFound: () => { throw Error("404"); } }));
// The existing Vitest runtime has no Next @ alias resolver. Resolve these two
// aliases to the same real modules; no page, list, authorization or mutation mock.
vi.mock("@/lib/locale.ts", async () => import("../../src/lib/locale.ts"));
vi.mock("@/features/session-workflow/workspace.tsx", async () => import("../../src/features/session-workflow/workspace.tsx"));
const caseId = "11111111-1111-4111-8111-111111111111", selected = "22222222-2222-4222-8222-222222222222";
const items: SessionListItem[] = [selected, "33333333-3333-4333-8333-333333333333"].map(appointmentId => ({ appointmentId, sessionId: null, startsAt: "2026-09-22T08:00:00Z", endsAt: "2026-09-22T09:00:00Z", state: null, processingState: null, audioState: null }));
it("shows only the exact appointment from the already-authorized case list, never a fallback record", () => {
  expect(visibleSessionAppointments(items, selected)).toEqual([items[0]]);
  expect(visibleSessionAppointments(items, "44444444-4444-4444-8444-444444444444")).toEqual([]);
  expect(visibleSessionAppointments(items)).toEqual(items);
  expect(items.every(item => item.sessionId === null)).toBe(true);
});
it("passes a single valid selected appointment to the actual case page", async () => {
  const element = await Page({ params: Promise.resolve({ locale: "he", caseId }), searchParams: Promise.resolve({ appointmentId: selected }) });
  expect(element.props.selectedAppointmentId).toBe(selected);
});
it('sends the exact canonical appointment context to the server before its list cap',async()=>{
 const mixed='abcdefab-abcd-4abc-8abc-abcdefabcdef';
 expect(sessionAppointmentListPath(caseId,mixed.toUpperCase())).toBe(`?caseId=${caseId}&appointmentId=${mixed}`);
 expect(sessionAppointmentListPath(caseId)).toBe(`?caseId=${caseId}`);
 const element=await Page({params:Promise.resolve({locale:'en',caseId}),searchParams:Promise.resolve({appointmentId:mixed.toUpperCase()})});
 expect(element.props.selectedAppointmentId).toBe(mixed);
});
it.each([[selected, selected], "../../private", "not-an-id"])("rejects an invalid or repeated appointment context", async appointmentId => {
  await expect(Page({ params: Promise.resolve({ locale: "en", caseId }), searchParams: Promise.resolve({ appointmentId }) })).rejects.toThrow("404");
});
it("keeps the session ensure mutation on the practitioner's explicit button, not page loading", () => {
  const source = readFileSync(new URL("../../src/features/session-workflow/workspace.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("useEffect("), source.indexOf("async function open("));
  expect(effect).not.toContain("sessionEnsure");
  expect(effect).toContain('sessionAppointmentListPath(caseId,selectedAppointmentId)');
  expect(effect).toContain('controller.signal.aborted');
  expect(source).toContain("onClick={()=>void open(item)}");
  expect(source).toContain("Return to all sessions");
  expect(source).toContain("timeZone:\"Asia/Jerusalem\"");
});
it("links an individual Calendar appointment to its exact private case/session context within the practitioner branch", () => {
  const source = readFileSync(new URL("../../src/features/calendar/workspace.tsx", import.meta.url), "utf8");
  const label = source.indexOf("Open private session record");
  expect(label).toBeGreaterThan(source.indexOf("{practitioner?<>"));
  expect(source).toContain("selected.kind==='individual'&&!mutation.locked");
  expect(source).toContain("app/cases/${selected.caseId}/sessions?appointmentId=${selected.id}");
});
