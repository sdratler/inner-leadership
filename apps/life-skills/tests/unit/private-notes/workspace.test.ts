import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";

type Slot = { kind: "state"; value: unknown } | { kind: "ref"; value: { current: unknown } } | { kind: "effect"; deps: readonly unknown[] | undefined; cleanup?: (() => void) | undefined };
const hook = vi.hoisted(() => {
  const slots: Slot[] = [], pending: Array<{ index: number; effect: () => void | (() => void) }> = [];
  let cursor = 0, mounted = true, afterUnmountUpdates = 0;
  const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  return {
    reset() { slots.length = 0; pending.length = 0; cursor = 0; mounted = true; afterUnmountUpdates = 0; },
    render<T>(view: () => T): T { cursor = 0; return view(); },
    flushEffects() { for (const next of pending.splice(0)) { const slot = slots[next.index]; if (slot?.kind === "effect") { slot.cleanup?.(); slot.cleanup = next.effect() || undefined; } } },
    unmount() { mounted = false; for (const slot of slots) if (slot.kind === "effect") slot.cleanup?.(); }, afterUnmountUpdates: () => afterUnmountUpdates,
    useState<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: "state", value: initial }; slots[index] = slot; } if (slot.kind !== "state") throw new Error("HOOK_ORDER"); return [slot.value as T, (value: T) => { if (!mounted) { afterUnmountUpdates++; return; } slot.value = value; }] as const; },
    useRef<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: "ref", value: { current: initial } }; slots[index] = slot; } if (slot.kind !== "ref") throw new Error("HOOK_ORDER"); return slot.value as { current: T }; },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) { const index = cursor++; const slot = slots[index]; if (!slot) { slots[index] = { kind: "effect", deps }; pending.push({ index, effect }); return; } if (slot.kind !== "effect") throw new Error("HOOK_ORDER"); if (changed(slot.deps, deps)) { slot.deps = deps; pending.push({ index, effect }); } },
  };
});
const sessionInfo = vi.hoisted(() => vi.fn(async () => ({ csrfToken: "c".repeat(43) })));
vi.mock("react", async importOriginal => { const actual = await importOriginal<typeof import("react")>(); return { ...actual, useEffect: hook.useEffect, useRef: hook.useRef, useState: hook.useState }; });
vi.mock("../../../src/features/identity/client.ts", () => ({ sessionInfo }));
import { PrivateNotesWorkspace } from "../../../src/features/private-notes/workspace.tsx";

const caseA = "123e4567-e89b-12d3-a456-426614174000", caseB = "223e4567-e89b-12d3-a456-426614174000";
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function find(node: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined { if (!node || typeof node !== "object") return undefined; if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean); const item = node as ReactElement<Record<string, unknown>>; return predicate(item) ? item : find(item.props?.children, predicate); }
function textarea(output: unknown) { const item = find(output, (element) => element.type === "textarea"); if (!item) throw new Error("textarea missing"); return item; }
function save(output: unknown) { const item = find(output, (element) => element.type === "button"); if (!item) throw new Error("save missing"); return item; }

beforeEach(() => { hook.reset(); sessionInfo.mockClear(); vi.stubGlobal("fetch", vi.fn()); vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("10000000-0000-4000-8000-000000000001").mockReturnValueOnce("20000000-0000-4000-8000-000000000002"); });

it("keeps a retry key for an identical request, rotates it for changed body/revision, and blocks a pending double save", async () => {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const fetchMock = vi.mocked(fetch).mockImplementation(async (url, init) => { calls.push({ url: String(url), init }); if (String(url).includes("?") ) return Response.json({ data: { body: "", revision: 0 } }); if (calls.filter((call) => !call.url.includes("?")).length === 1) return new Response("", { status: 500 }); return Response.json({ data: { revision: 1 } }, { status: 201 }); });
  hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); hook.flushEffects(); await tick();
  let output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); (textarea(output).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Synthetic first" } });
  output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); (save(output).props.onClick as () => void)(); await tick();
  output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); (save(output).props.onClick as () => void)(); await tick();
  let writes = calls.filter((call) => !call.url.includes("?")).map((call) => JSON.parse(String(call.init?.body)));
  expect(writes).toHaveLength(2); expect(writes[0].idempotencyKey).toBe(writes[1].idempotencyKey); expect(writes[0]).toMatchObject({ caseId: caseA, body: "Synthetic first", expectedRevision: 0 });
  output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); (textarea(output).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Synthetic changed" } });
  output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); (save(output).props.onClick as () => void)(); (save(output).props.onClick as () => void)(); await tick();
  writes = calls.filter((call) => !call.url.includes("?")).map((call) => JSON.parse(String(call.init?.body)));
  expect(writes).toHaveLength(3); expect(writes[2].idempotencyKey).not.toBe(writes[0].idempotencyKey); expect(writes[2]).toMatchObject({ body: "Synthetic changed", expectedRevision: 1 }); expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("does not let a stale load update a new case or an unmounted workspace", async () => {
  let resolveA!: (response: Response) => void, resolveB!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve; })).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveB = resolve; }));
  hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); hook.flushEffects();
  hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseB })); hook.flushEffects(); resolveB(Response.json({ data: { body: "B note", revision: 4 } })); await tick();
  let output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseB })); expect(textarea(output).props.value).toBe("B note");
  resolveA(Response.json({ data: { body: "A stale", revision: 9 } })); await tick(); output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseB })); expect(textarea(output).props.value).toBe("B note");
  hook.unmount(); expect(hook.afterUnmountUpdates()).toBe(0);
});

it("hides an already-loaded note before the new case effect runs and ignores a save after unmount", async () => {
  let resolveSave!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("?") ? Response.json({ data: { body: "A private note", revision: 1 } }) : new Promise<Response>(resolve => { resolveSave = resolve; }));
  hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); hook.flushEffects(); await tick();
  let output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseA })); expect(textarea(output).props.value).toBe("A private note");
  (save(output).props.onClick as () => void)(); await tick();
  output = hook.render(() => PrivateNotesWorkspace({ locale: "en", caseId: caseB }));
  expect(textarea(output).props.value).toBe(""); expect(save(output).props.disabled).toBe(true);
  hook.unmount(); resolveSave(Response.json({ data: { revision: 2 } })); await tick();
  expect(hook.afterUnmountUpdates()).toBe(0);
});
