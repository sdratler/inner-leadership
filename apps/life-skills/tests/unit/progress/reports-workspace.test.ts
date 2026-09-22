import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";

type Slot = { kind: "state"; value: unknown } | { kind: "ref"; value: { current: unknown } } | { kind: "effect"; deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined };
const hook = vi.hoisted(() => {
  const slots: Slot[] = [], pending: Array<{ index: number; effect: () => void | (() => void) }> = [];
  let cursor = 0, mounted = true, afterUnmountUpdates = 0;
  const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  return {
    reset() { slots.length = 0; pending.length = 0; cursor = 0; mounted = true; afterUnmountUpdates = 0; },
    render<T>(view: () => T): T { cursor = 0; return view(); },
    flushEffects() { for (const next of pending.splice(0)) { const slot = slots[next.index]; if (slot?.kind === "effect") { slot.cleanup?.(); slot.cleanup = next.effect() || undefined; } } },
    unmount() { mounted = false; for (const slot of slots) if (slot.kind === "effect") slot.cleanup?.(); }, afterUnmountUpdates: () => afterUnmountUpdates,
    useState<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: "state", value: initial }; slots[index] = slot; } if (slot.kind !== "state") throw new Error("HOOK_ORDER"); return [slot.value as T, (value: T | ((previous: T) => T)) => { if (!mounted) { afterUnmountUpdates++; return; } slot.value = typeof value === "function" ? (value as (previous: T) => T)(slot.value as T) : value; }] as const; },
    useRef<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: "ref", value: { current: initial } }; slots[index] = slot; } if (slot.kind !== "ref") throw new Error("HOOK_ORDER"); return slot.value as { current: T }; },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) { const index = cursor++; const slot = slots[index]; if (!slot) { slots[index] = { kind: "effect", deps, cleanup: undefined }; pending.push({ index, effect }); return; } if (slot.kind !== "effect") throw new Error("HOOK_ORDER"); if (changed(slot.deps, deps)) { slot.deps = deps; pending.push({ index, effect }); } },
  };
});
const accountRead = vi.hoisted(() => vi.fn());
const sessionInfo = vi.hoisted(() => vi.fn(async () => ({ csrfToken: "c".repeat(43) })));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("react", async importOriginal => { const actual = await importOriginal<typeof import("react")>(); return { ...actual, useEffect: hook.useEffect, useRef: hook.useRef, useState: hook.useState }; });
vi.mock("../../../src/features/identity/client.ts", () => ({ accountRead, sessionInfo }));
import { ReportCaseWorkspace, ReportEditor, ReportReadout, type Review } from "../../../src/features/progress/reports-page.tsx";

const ids = { caseId: "123e4567-e89b-12d3-a456-426614174000", audienceId: "223e4567-e89b-12d3-a456-426614174000", otherAudienceId: "323e4567-e89b-12d3-a456-426614174000" };
const narrative = { taughtAndPractised: ["Synthetic teaching"], parentReportedExamples: [], practitionerObservations: ["Synthetic observation"], usefulChanges: ["Synthetic useful change"], continuingDifficulty: ["Synthetic difficulty"], uncertainty: "Synthetic uncertainty", nextAdjustment: "Synthetic next", informationLimits: "Synthetic limits" };
const review = (id: string, state: "draft" | "published", audienceId = ids.audienceId): Review => ({ id, caseId: ids.caseId, audienceId, periodStart: "2026-09-01", periodEnd: "2026-09-29", attendedSessionCount: 2, state, narrative });
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
type Change = (event: { target: { value: string } }) => void;
type Click = () => void;
function find(node: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined { if (!node || typeof node !== "object") return undefined; if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean); const item = node as ReactElement<Record<string, unknown>>; return predicate(item) ? item : find(item.props?.children, predicate); }
function text(node: unknown): string { if (node === null || node === undefined || typeof node === "boolean") return ""; if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(""); return text((node as ReactElement<{ children?: unknown }>).props?.children); }
function all(node: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean, output: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] { if (!node || typeof node !== "object") return output; if (Array.isArray(node)) { node.forEach((item) => all(item, predicate, output)); return output; } const item = node as ReactElement<Record<string, unknown>>; if (predicate(item)) output.push(item); all(item.props?.children, predicate, output); return output; }
function click(output: unknown, label: string) { const button = find(output, (element) => element.type === "button" && element.props.children === label); if (!button) throw new Error(`Missing button ${label}`); return button.props.onClick as Click; }
function fillEditor(output: unknown) { const input = find(output, (element) => element.type === "input"); if (!input) throw new Error("missing period input"); (input.props.onChange as Change)({ target: { value: "2026-09-01" } }); const fields = all(output, (element) => element.type === "textarea"); const values = ["Synthetic taught", "Synthetic observation", "Synthetic useful", "Synthetic difficulty", "Synthetic uncertainty", "Synthetic next", "Synthetic limits"]; fields.forEach((field, index) => (field.props.onChange as Change)({ target: { value: values[index]! } })); }

beforeEach(() => { hook.reset(); accountRead.mockReset(); sessionInfo.mockClear(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });

it("renders only authorized published parent reports after case/audience/review Promise.all", async () => {
  fetchMock.mockImplementation(async (url: string) => url.startsWith("/api/identity/audiences") ? Response.json({ ok: true, data: [{ id: ids.audienceId, visibility: "family_full", published: true }, { id: ids.otherAudienceId, visibility: "private", published: true }] }) : Response.json({ ok: true, data: [review("423e4567-e89b-12d3-a456-426614174000", "published"), review("523e4567-e89b-12d3-a456-426614174000", "draft"), review("623e4567-e89b-12d3-a456-426614174000", "published", ids.otherAudienceId)] }));
  hook.render(() => ReportCaseWorkspace({ locale: "en", role: "parent", caseId: ids.caseId })); hook.flushEffects(); await tick();
  const output = hook.render(() => ReportCaseWorkspace({ locale: "en", role: "parent", caseId: ids.caseId })); const rendered = text(output);
  const readouts = all(output, (element) => element.type === ReportReadout);
  expect(readouts).toHaveLength(1); expect(readouts[0]?.props.review).toMatchObject({ id: "423e4567-e89b-12d3-a456-426614174000", state: "published" }); expect(rendered).toContain("Only published reports shared with your family appear here."); expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("renders the actual parent-published report readout without implied parent attribution", () => {
  const output = hook.render(() => ReportReadout({ locale: "en", review: review("423e4567-e89b-12d3-a456-426614174000", "published") }));
  expect(text(output)).toContain("Synthetic observation"); expect(text(output)).toContain("2026-09-29"); expect(text(output)).not.toContain("Attributed parent reports");
});

it("blocks publish when selected draft has unsaved edits", async () => {
  const onSaved = vi.fn(); let output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [review("423e4567-e89b-12d3-a456-426614174000", "draft")], onSaved }));
  const select = find(output, (element) => element.type === "select"); if (!select) throw new Error("missing draft select"); (select.props.onChange as Change)({ target: { value: "423e4567-e89b-12d3-a456-426614174000" } });
  output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [review("423e4567-e89b-12d3-a456-426614174000", "draft")], onSaved })); const field = find(output, (element) => element.type === "textarea"); if (!field) throw new Error("missing field"); (field.props.onChange as Change)({ target: { value: "Dirty synthetic edit" } });
  output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [review("423e4567-e89b-12d3-a456-426614174000", "draft")], onSaved })); click(output, "Publish saved draft")(); await tick();
  expect(vi.mocked(fetch)).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
});

it("writes once for a double-click and sends CSRF-bound new-draft data", async () => {
  let resolve!: (response: Response) => void; fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done; })); const onSaved = vi.fn(); let output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); hook.flushEffects(); fillEditor(output);
  output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); const saveButton = find(output, (element) => element.type === "button" && element.props.children === "Save new draft version"); expect(saveButton?.props.disabled).toBe(false); const save = click(output, "Save new draft version"); save(); save(); await tick(); expect(sessionInfo).toHaveBeenCalledTimes(1); output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); expect(text(output)).not.toContain("Complete the required fields"); expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = fetchMock.mock.calls[0]![1] as RequestInit; expect(request.headers).toMatchObject({ "X-CSRF-Token": "c".repeat(43) }); expect(JSON.parse(String(request.body))).toMatchObject({ caseId: ids.caseId, audienceId: ids.audienceId, parentReportIds: [], assignmentVersionIds: [] });
  resolve(Response.json({ ok: true, data: { reviewId: "723e4567-e89b-12d3-a456-426614174000", attendedSessionCount: 3 } })); await tick(); expect(onSaved).toHaveBeenCalledTimes(1);
});

it("suppresses onSaved after unmount", async () => {
  let resolve!: (response: Response) => void; fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })); const onSaved = vi.fn(); let output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); hook.flushEffects(); fillEditor(output); output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); click(output, "Save new draft version")(); await tick(); hook.unmount(); resolve(Response.json({ ok: true, data: { reviewId: "723e4567-e89b-12d3-a456-426614174000", attendedSessionCount: 3 } })); await tick(); expect(onSaved).not.toHaveBeenCalled(); expect(hook.afterUnmountUpdates()).toBe(0);
});

it("locks an ambiguous mutation failure behind explicit reload", async () => {
  fetchMock.mockRejectedValueOnce(new Error("ambiguous synthetic failure")); const onSaved = vi.fn(); let output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); hook.flushEffects(); fillEditor(output);
  output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); click(output, "Save new draft version")(); await tick(); output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); expect(text(output)).toContain("Reload reports"); click(output, "Save new draft version")(); await tick();
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(onSaved).not.toHaveBeenCalled();
});
