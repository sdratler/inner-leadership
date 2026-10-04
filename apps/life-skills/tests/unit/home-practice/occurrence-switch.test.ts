import type { ReactElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import type { PracticeOccurrenceItem } from "../../../src/features/home-practice/types.ts";

type Slot = { kind: string; value?: unknown; deps?: readonly unknown[] | undefined; cleanup?: (() => void) | undefined };
const hooks = vi.hoisted(() => {
 const slots: Slot[] = []; let cursor = 0; const effects: Array<() => void> = [];
 const changed = (a?: readonly unknown[], b?: readonly unknown[]) => !a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]);
 const memo = <T,>(fn: () => T, deps: readonly unknown[]) => { const i = cursor++, old = slots[i]; if (!old || changed(old.deps, deps)) slots[i] = { kind: "memo", value: fn(), deps }; return slots[i]!.value as T; };
 return {
  reset() { slots.length = 0; cursor = 0; effects.length = 0; },
  render<T>(fn: () => T) { cursor = 0; return fn(); }, flush() { for (const fn of effects.splice(0)) fn(); },
  useState<T>(initial: T | (() => T)) { const i = cursor++; slots[i] ??= { kind: "state", value: typeof initial === "function" ? (initial as () => T)() : initial }; return [slots[i]!.value as T, (value: T | ((old: T) => T)) => { slots[i]!.value = typeof value === "function" ? (value as (old: T) => T)(slots[i]!.value as T) : value; }] as const; },
  useRef<T>(initial: T) { const i = cursor++; slots[i] ??= { kind: "ref", value: { current: initial } }; return slots[i]!.value as { current: T }; },
  useMemo: memo, useCallback<T>(fn: T, deps: readonly unknown[]) { return memo(() => fn, deps); },
  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) { const i = cursor++, old = slots[i]; if (!old || changed(old.deps, deps)) { slots[i] = { kind: "effect", deps }; effects.push(() => { old?.cleanup?.(); slots[i]!.cleanup = fn() || undefined; }); } },
 };
});
const reads = vi.hoisted(() => vi.fn());
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: hooks.useState, useRef: hooks.useRef, useMemo: hooks.useMemo, useCallback: hooks.useCallback, useEffect: hooks.useEffect }));
vi.mock("../../../src/features/home-practice/occurrence-client.ts", async original => ({ ...await original<typeof import("../../../src/features/home-practice/occurrence-client.ts")>(), practiceRangeOccurrences: reads }));
vi.mock("../../../src/features/calendar/form-support.tsx", () => ({ useDialogGuard: vi.fn() }));
vi.mock("../../../src/ui/workspace/dialogs.tsx", async original => ({ ...await original<typeof import("../../../src/ui/workspace/dialogs.tsx")>(), openDialog: vi.fn(), closeDialog: vi.fn() }));
import { PracticeOccurrenceWorkspace, PracticeOccurrenceCard } from "../../../src/features/home-practice/occurrence-workspace.tsx";
import { UnsavedChangesGuard } from "../../../src/ui/workspace/draft-guard.tsx";

const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
const rows = ids.map(id => ({ occurrence: { id, state: "open" }, practice: { audienceId: ids[0] }, canReport: true }) as PracticeOccurrenceItem);
function find(node: unknown, type: unknown): ReactElement<Record<string, unknown>> | undefined { if (!node || typeof node !== "object") return undefined; if (Array.isArray(node)) return node.map(value => find(value, type)).find(Boolean); const item = node as ReactElement<Record<string, unknown>>; return item.type === type || typeof item.type === "function" && item.type.name === type ? item : find(item.props?.children, type); }
function renderCanvas(tree: ReactElement) { const canvas = find(tree, "PracticeCalendarCanvas")!; (canvas.type as (props: Record<string, unknown>) => unknown)(canvas.props); return tree; }
beforeEach(() => { hooks.reset(); reads.mockResolvedValue({ items: rows, hasMore: false }); vi.stubGlobal("window", { confirm: vi.fn(() => true) }); });

test.each(["en", "he"] as const)("%s accepted occurrence switch clears A's marker; B can save without phantom unsaved warnings", async locale => {
 let onOpen: Parameters<NonNullable<Parameters<typeof PracticeOccurrenceWorkspace>[0]["renderCalendar"]>>[0]["onOpen"];
 const render = () => hooks.render(() => renderCanvas(PracticeOccurrenceWorkspace({ locale, role: "parent", caseId: ids[0], audienceId: ids[0], from: "2026-10-05", to: "2026-10-06", renderCalendar: value => { onOpen = value.onOpen; return null; } })));
 const settle = async () => { let tree = render(); for (let i = 0; i < 4; i++) { hooks.flush(); await Promise.resolve(); tree = render(); } return tree; };
 await settle(); onOpen!(rows[0]!, {} as never); let tree = await settle();
 (find(tree, PracticeOccurrenceCard)!.props.onDirty as (id: string, dirty: boolean) => void)(ids[0]!, true); tree = await settle(); expect(find(tree, UnsavedChangesGuard)!.props.dirty).toBe(true);
 vi.mocked(window.confirm).mockReturnValueOnce(false); onOpen!(rows[1]!, {} as never); tree = await settle(); expect(find(tree, PracticeOccurrenceCard)!.props.item).toBe(rows[0]); expect(find(tree, UnsavedChangesGuard)!.props.dirty).toBe(true);
 onOpen!(rows[1]!, {} as never); tree = await settle(); expect(find(tree, PracticeOccurrenceCard)!.props.item).toBe(rows[1]); expect(find(tree, UnsavedChangesGuard)!.props.dirty).toBe(false);
 const dirty = find(tree, PracticeOccurrenceCard)!.props.onDirty as (id: string, dirty: boolean) => void; dirty(ids[1]!, true); await settle(); dirty(ids[1]!, false); tree = await settle(); expect(find(tree, UnsavedChangesGuard)!.props.dirty).toBe(false); expect(window.confirm).toHaveBeenCalledTimes(2);
});

test("a saving or uncertain occurrence cannot be switched or discarded", async () => {
 let onOpen: Parameters<NonNullable<Parameters<typeof PracticeOccurrenceWorkspace>[0]["renderCalendar"]>>[0]["onOpen"];
 const render = () => hooks.render(() => renderCanvas(PracticeOccurrenceWorkspace({ locale: "en", role: "parent", caseId: ids[0], audienceId: ids[0], from: "2026-10-05", to: "2026-10-06", renderCalendar: value => { onOpen = value.onOpen; return null; } })));
 let tree = render(); for (let i = 0; i < 4; i++) { hooks.flush(); await Promise.resolve(); tree = render(); }
 onOpen!(rows[0]!, {} as never); tree = render(); (find(tree, PracticeOccurrenceCard)!.props.onLockChange as (locked: boolean) => void)(true); render(); onOpen!(rows[1]!, {} as never); tree = render(); expect(find(tree, PracticeOccurrenceCard)!.props.item).toBe(rows[0]); expect(window.confirm).not.toHaveBeenCalled();
});
