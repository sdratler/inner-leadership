import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";

type Slot = { kind: "state"; value: unknown } | { kind: "ref"; value: { current: unknown } } | { kind: "effect"; deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined };
const hook = vi.hoisted(() => {
  const slots: Slot[] = [], pending: Array<{ index: number; effect: () => void | (() => void) }> = [];
  let cursor = 0, mounted = true, afterUnmountUpdates = 0;
  const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  return { reset() { slots.length = 0; pending.length = 0; cursor = 0; mounted = true; afterUnmountUpdates = 0; }, render<T>(view: () => T): T { cursor = 0; return view(); }, flushEffects() { for (const next of pending.splice(0)) { const slot = slots[next.index]; if (slot?.kind === "effect") { slot.cleanup?.(); slot.cleanup = next.effect() || undefined; } } }, unmount() { mounted = false; for (const slot of slots) if (slot?.kind === "effect") slot.cleanup?.(); }, afterUnmountUpdates: () => afterUnmountUpdates, useState<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: "state", value: initial }; slots[index] = slot; } if (slot.kind !== "state") throw new Error("HOOK_ORDER"); return [slot.value as T, (value: T | ((previous: T) => T)) => { if (!mounted) { afterUnmountUpdates++; return; } slot.value = typeof value === "function" ? (value as (previous: T) => T)(slot.value as T) : value; }] as const; }, useRef<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: "ref", value: { current: initial } }; slots[index] = slot; } if (slot.kind !== "ref") throw new Error("HOOK_ORDER"); return slot.value as { current: T }; }, useMemo<T>(factory: () => T) { cursor++; return factory(); }, useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) { const index = cursor++; const slot = slots[index]; if (!slot) { slots[index] = { kind: "effect", deps, cleanup: undefined }; pending.push({ index, effect }); return; } if (slot.kind !== "effect") throw new Error("HOOK_ORDER"); if (changed(slot.deps, deps)) { slot.deps = deps; pending.push({ index, effect }); } } };
});
const accountRead = vi.hoisted(() => vi.fn());
const sessionInfo = vi.hoisted(() => vi.fn(async () => ({ csrfToken: "c".repeat(43) })));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("react", async importOriginal => { const actual = await importOriginal<typeof import("react")>(); return { ...actual, useEffect: hook.useEffect, useMemo: hook.useMemo, useRef: hook.useRef, useState: hook.useState }; });
vi.mock("../../../src/features/identity/client.ts", () => ({ accountRead, sessionInfo }));
import { feedbackContextReady, UpdatesWorkspace } from "../../../src/features/updates/updates-workspace.tsx";

const caseA = "123e4567-e89b-12d3-a456-426614174000", caseB = "223e4567-e89b-12d3-a456-426614174000", audienceA = "323e4567-e89b-12d3-a456-426614174000", audienceB = "423e4567-e89b-12d3-a456-426614174000";
const tick = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
type Change = (event: { target: { value: string } }) => void;
type Click = () => void;
type Submit = (event: { preventDefault: () => void }) => void;
function find(node: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined { if (!node || typeof node !== "object") return undefined; if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean); const item = node as ReactElement<Record<string, unknown>>; return predicate(item) ? item : find(item.props?.children, predicate); }
function text(node: unknown): string { if (node === null || node === undefined || typeof node === "boolean") return ""; if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(""); return text((node as ReactElement<{ children?: unknown }>).props?.children); }
function render(props: Parameters<typeof UpdatesWorkspace>[0]) { return hook.render(() => UpdatesWorkspace(props)); }
function postBodies() { return fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST").map((call) => JSON.parse(String((call[1] as RequestInit).body))); }

beforeEach(() => { hook.reset(); accountRead.mockReset(); sessionInfo.mockClear(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.spyOn(crypto, "randomUUID").mockRestore(); });

it("requires exact case, audience, and practice-version context", () => { expect(feedbackContextReady(caseA, caseA, audienceA, "version-a")).toBe(true); expect(feedbackContextReady(caseA, caseB, audienceA, "version-a")).toBe(false); expect(feedbackContextReady(caseA, caseA, "", "version-a")).toBe(false); });

it("does not render old case/audience data after a delayed switch", async () => {
  accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }, { id: caseB, displayName: "Synthetic B", kind: "minor" }]);
  let resolveA!: (response: Response) => void, resolveB!: (response: Response) => void;
  fetchMock.mockImplementation((url: string) => { if (url.includes(encodeURIComponent(caseA))) return new Promise<Response>((resolve) => { resolveA = resolve; }); if (url.includes(encodeURIComponent(caseB))) return new Promise<Response>((resolve) => { resolveB = resolve; }); return Promise.resolve(Response.json({ ok: true, data: [] })); });
  render({ locale: "en", role: "practitioner" }); hook.flushEffects(); await tick(); let output = render({ locale: "en", role: "practitioner" }); hook.flushEffects(); await tick();
  const select = find(output, (element) => element.type === "select" && element.props.id === "update-case"); if (!select) throw new Error("missing case select"); (select.props.onChange as Change)({ target: { value: caseB } }); output = render({ locale: "en", role: "practitioner" }); hook.flushEffects(); await tick();
  resolveB(Response.json({ ok: true, data: [{ id: audienceB, visibility: "family_full" }] })); await tick(); output = render({ locale: "en", role: "practitioner" }); expect(text(output)).toContain("family_full");
  resolveA(Response.json({ ok: true, data: [{ id: audienceA, visibility: "family_full" }] })); await tick(); output = render({ locale: "en", role: "practitioner" }); expect(JSON.stringify(output)).not.toContain(audienceA); expect(JSON.stringify(output)).toContain(audienceB);
});

it("keeps an exact failed retry key and rotates it after a changed payload", async () => {
  accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }]); let next = 0; vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-00000000000${++next}`);
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === "POST" ? new Response("", { status: 500 }) : Response.json({ ok: true, data: [] }))); const props = { locale: "en" as const, role: "parent" as const, initialCaseId: caseA, initialAudienceId: audienceA, initialPracticeVersionId: "version-a" };
  render(props); hook.flushEffects(); await tick(); let output = render(props); const open = find(output, (element) => element.type === "button" && element.props.children === "Add feedback"); if (!open) throw new Error("missing composer"); (open.props.onClick as Click)(); output = render(props); const area = find(output, (element) => element.type === "textarea" && element.props.id === "update-body"); const form = find(output, (element) => element.type === "form"); if (!area || !form) throw new Error("missing composer form"); (area.props.onChange as Change)({ target: { value: "Synthetic retry" } }); output = render(props); const submit = find(output, (element) => element.type === "form"); (submit?.props.onSubmit as Submit)({ preventDefault() {} }); await tick(); output = render(props); (find(output, (element) => element.type === "form")?.props.onSubmit as Submit)({ preventDefault() {} }); await tick(); let bodies = postBodies(); expect(bodies).toHaveLength(2); expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
  const changed = find(output, (element) => element.type === "textarea" && element.props.id === "update-body"); if (!changed) throw new Error("missing changed body"); (changed.props.onChange as Change)({ target: { value: "Synthetic changed" } }); output = render(props); (find(output, (element) => element.type === "form")?.props.onSubmit as Submit)({ preventDefault() {} }); await tick(); bodies = postBodies(); expect(bodies).toHaveLength(3); expect(bodies[2].idempotencyKey).not.toBe(bodies[0].idempotencyKey);
});

it("submits only one write for two same-tick clicks", async () => {
  accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }]); let resolve!: (response: Response) => void; fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>((done) => { resolve = done; }) : Promise.resolve(Response.json({ ok: true, data: [] }))); const props = { locale: "en" as const, role: "parent" as const, initialCaseId: caseA, initialAudienceId: audienceA, initialPracticeVersionId: "version-a" };
  render(props); hook.flushEffects(); await tick(); let output = render(props); (find(output, (element) => element.type === "button" && element.props.children === "Add feedback")?.props.onClick as Click)(); output = render(props); (find(output, (element) => element.type === "textarea" && element.props.id === "update-body")?.props.onChange as Change)({ target: { value: "Synthetic same tick" } }); output = render(props); const submit = find(output, (element) => element.type === "form")?.props.onSubmit as Submit; submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick(); expect(postBodies()).toHaveLength(1);
  resolve(Response.json({ ok: true, data: {} }));
});

it("suppresses pending callbacks after unmount", async () => {
  accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }]); let resolve!: (response: Response) => void; fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>((done) => { resolve = done; }) : Promise.resolve(Response.json({ ok: true, data: [] }))); const props = { locale: "en" as const, role: "parent" as const, initialCaseId: caseA, initialAudienceId: audienceA, initialPracticeVersionId: "version-a" };
  render(props); hook.flushEffects(); await tick(); let output = render(props); (find(output, (element) => element.type === "button" && element.props.children === "Add feedback")?.props.onClick as Click)(); output = render(props); (find(output, (element) => element.type === "textarea" && element.props.id === "update-body")?.props.onChange as Change)({ target: { value: "Synthetic pending" } }); output = render(props); (find(output, (element) => element.type === "form")?.props.onSubmit as Submit)({ preventDefault() {} }); await tick(); hook.unmount(); resolve(Response.json({ ok: true, data: {} })); await tick(); expect(hook.afterUnmountUpdates()).toBe(0);
});
