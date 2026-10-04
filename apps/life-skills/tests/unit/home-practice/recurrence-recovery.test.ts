import type { ReactElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { IdentityClientError } from "../../../src/features/identity/client.ts";
import type { ManagedPracticeVersion } from "../../../src/features/home-practice/types.ts";
import type { RecurrencePlan } from "../../../src/features/home-practice/recurrence-input.ts";

const hooks = vi.hoisted(() => {
 const slots: Array<{ value?: unknown; deps?: readonly unknown[] | undefined; cleanup?: (() => void) | undefined }> = []; let index = 0; const effects: Array<() => void> = [];
 return {
  reset() { slots.length = 0; index = 0; effects.length = 0; }, render<T>(fn: () => T) { index = 0; return fn(); }, flush() { for (const fn of effects.splice(0)) fn(); },
  useState<T>(initial: T) { const i = index++; slots[i] ??= { value: initial }; return [slots[i]!.value as T, (value: T | ((old: T) => T)) => { slots[i]!.value = typeof value === "function" ? (value as (old: T) => T)(slots[i]!.value as T) : value; }] as const; },
  useRef<T>(initial: T) { const i = index++; slots[i] ??= { value: { current: initial } }; return slots[i]!.value as { current: T }; },
  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) { const i = index++, old = slots[i]; if (!old || !deps || !old.deps || deps.some((v, at) => v !== old.deps![at])) { slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i]!.cleanup = fn() || undefined; }); } },
 };
});
const ports = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect }));
vi.mock("../../../src/features/home-practice/management-client.ts", async original => ({ ...await original<typeof import("../../../src/features/home-practice/management-client.ts")>(), readRecurrence: ports.read, saveRecurrence: ports.save }));
import { RecurrenceControls } from "../../../src/features/home-practice/recurrence-controls.tsx";

const id = "00000000-0000-4000-8000-000000000001", dates = ["2026-10-05", "2026-10-06"], digest = "a".repeat(64);
const plan: RecurrencePlan = { assignmentId: id, practiceVersionId: id, caseId: id, audienceId: id, from: dates[0]!, to: dates[1]!, localTime: "18:45", timezone: "UTC", weekdays: [1, 2], planDigest: "b".repeat(64), items: dates.map((date, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 2}`, assignmentId: id, practiceVersionId: id, coordinationVersionId: id, occursOn: date, occursAt: `${date}T18:45:00.000Z`, period: "morning", state: "open", existing: false })) };
const row = { assignmentId: id, versionId: id, caseId: id, audienceId: id, immutableSnapshotDigest: digest, startsOn: dates[0], endsOn: dates[1], version: 1 } as ManagedPracticeVersion;
function nodes(tree: unknown, type: string, result: ReactElement<Record<string, unknown>>[] = []) { if (!tree || typeof tree !== "object") return result; if (Array.isArray(tree)) { tree.forEach(value => nodes(value, type, result)); return result; } const item = tree as ReactElement<Record<string, unknown>>; if (item.type === type) result.push(item); nodes(item.props?.children, type, result); return result; }
function button(tree: unknown, label: string) { return nodes(tree, "button").find(item => item.props.children === label); }
beforeEach(() => { hooks.reset(); ports.read.mockReset().mockResolvedValue(plan); ports.save.mockReset().mockRejectedValue(new IdentityClientError("UNAVAILABLE")); vi.stubGlobal("window", { confirm: vi.fn(() => true) }); });
async function pending(locale: "en" | "he") {
 const word = (en: string, he: string) => locale === "he" ? he : en; const states: Array<{ dirty: boolean; locked: boolean }> = []; const onState = (value: { dirty: boolean; locked: boolean }) => states.push(value);
 const render = () => hooks.render(() => RecurrenceControls({ locale, row, disabled: false, onState }));
 const settle = async () => { let tree = render(); for (let i = 0; i < 4; i++) { hooks.flush(); await Promise.resolve(); tree = render(); } return tree; };
 let tree = await settle(); nodes(tree, "input").forEach((item, i) => (item.props.onChange as (e: unknown) => void)({ target: { value: dates[i] } })); tree = await settle(); (nodes(tree, "form")[0]!.props.onSubmit as (e: unknown) => void)({ preventDefault() {}, currentTarget: { checkValidity: () => true } }); tree = await settle(); (button(tree, word("Confirm recurring schedule", "אישור התרגול החוזר"))!.props.onClick as () => void)(); tree = await settle(); expect(states.at(-1)).toEqual({ dirty: true, locked: true });
 return { word, settle, states, tree };
}
test.each([["en", "CONFLICT"], ["he", "CONFLICT"], ["en", "NOT_FOUND"], ["he", "NOT_FOUND"]] as const)("%s %s checked stale-pending discard retains dates, requires confirmation and never resends/deletes", async (locale, code) => {
 const h = await pending(locale); expect(button(h.tree, h.word("Discard stale pending plan", "ביטול התוכנית הממתינה שהתיישנה"))).toBeUndefined(); ports.read.mockRejectedValueOnce(new IdentityClientError(code)); (button(h.tree, h.word("Check saved calendar entries", "בדיקת רשומות היומן השמורות"))!.props.onClick as () => void)(); let tree = await h.settle();
 const label = h.word("Discard stale pending plan", "ביטול התוכנית הממתינה שהתיישנה"); expect(button(tree, label)).toBeDefined(); vi.mocked(window.confirm).mockReturnValueOnce(false); (button(tree, label)!.props.onClick as () => void)(); tree = await h.settle(); expect(h.states.at(-1)!.locked).toBe(true);
 (button(tree, label)!.props.onClick as () => void)(); tree = await h.settle(); expect(h.states.at(-1)).toEqual({ dirty: true, locked: false }); expect(nodes(tree, "input").map(item => item.props.value)).toEqual(dates); expect(button(tree, label)).toBeUndefined(); expect(ports.save).toHaveBeenCalledTimes(1); expect(window.confirm).toHaveBeenCalledTimes(2); expect(nodes(tree, "fieldset")[0]!.props.disabled).toBe(false);
});
test("a repeated unavailable read does not unlock an unknown save or offer terminal discard", async () => { const h = await pending("en"); ports.read.mockRejectedValueOnce(new IdentityClientError("UNAVAILABLE")); (button(h.tree, "Check saved calendar entries")!.props.onClick as () => void)(); const tree = await h.settle(); expect(button(tree, "Discard stale pending plan")).toBeUndefined(); expect(h.states.at(-1)!.locked).toBe(true); (button(tree, "Retry the same confirmed schedule")!.props.onClick as () => void)(); await h.settle(); expect(ports.save).toHaveBeenCalledTimes(2); expect(ports.save.mock.calls[1]).toEqual(ports.save.mock.calls[0]); });
test("a definitive rejected retry offers checked discard without claiming the earlier save did not happen", async () => { const h = await pending("en"); ports.save.mockRejectedValueOnce(new IdentityClientError("CONFLICT")); (button(h.tree, "Retry the same confirmed schedule")!.props.onClick as () => void)(); const tree = await h.settle(); expect(button(tree, "Discard stale pending plan")).toBeDefined(); expect(button(tree, "Retry the same confirmed schedule")!.props.disabled).toBe(true); expect(h.states.at(-1)!.locked).toBe(true); expect(nodes(tree, "p").some(item => typeof item.props.children === "string" && item.props.children.includes("earlier save outcome is not confirmed"))).toBe(true); });
test("a checked current plan with a different digest can be abandoned, but is never auto-confirmed", async () => { const h = await pending("en"); ports.read.mockResolvedValueOnce({ ...plan, planDigest: "c".repeat(64) }); (button(h.tree, "Check saved calendar entries")!.props.onClick as () => void)(); const tree = await h.settle(); expect(button(tree, "Discard stale pending plan")).toBeDefined(); expect(ports.save).toHaveBeenCalledTimes(1); expect(h.states.at(-1)!.locked).toBe(true); });
