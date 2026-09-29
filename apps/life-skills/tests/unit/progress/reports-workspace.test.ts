import type { ReactElement } from "react";
import { afterEach,beforeEach, expect, it, vi } from "vitest";

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
const replace=vi.hoisted(()=>vi.fn());
vi.mock('next/navigation',()=>({useRouter:()=>({replace})}));
vi.mock("react", async importOriginal => { const actual = await importOriginal<typeof import("react")>(); return { ...actual, useEffect: hook.useEffect, useRef: hook.useRef, useState: hook.useState }; });
vi.mock("../../../src/features/identity/client.ts", () => ({ accountRead, sessionInfo }));
import { ReportsPage, ReportCaseWorkspace, ReportEditor, ReportReadout, type Review } from "../../../src/features/progress/reports-page.tsx";

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

beforeEach(() => { hook.reset(); accountRead.mockReset(); sessionInfo.mockClear(); fetchMock.mockReset();replace.mockClear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(()=>vi.unstubAllGlobals());

it('loads practitioner cases in the explicit authorized mode and never substitutes an unavailable requested case',async()=>{
 accountRead.mockResolvedValue([{id:ids.otherAudienceId,displayName:'Synthetic other',kind:'minor',state:'active',mode:'demo'}]);
 const props={locale:'en' as const,role:'practitioner' as const,caseId:ids.caseId,mode:'demo' as const};
 hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();const output=hook.render(()=>ReportsPage(props));
 expect(accountRead).toHaveBeenCalledWith('cases','demo');expect(find(output,e=>e.type===ReportCaseWorkspace)).toBeUndefined();
 expect(text(output)).toContain('The selected case is unavailable');expect(text(output)).toContain('No other case was opened');
});
it('keeps parent cases on the ordinary authorized API without a practitioner mode request',async()=>{
 accountRead.mockResolvedValue([{id:ids.caseId,displayName:'Synthetic child',kind:'minor'}]);
 const props={locale:'he' as const,role:'parent' as const,caseId:ids.caseId};hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();
 expect(accountRead).toHaveBeenCalledWith('cases');expect(find(hook.render(()=>ReportsPage(props)),e=>e.type===ReportCaseWorkspace)?.props.caseId).toBe(ids.caseId);
});
it('rejects mixed practitioner provenance instead of hiding a corrupt response as an empty list',async()=>{
 accountRead.mockResolvedValue([{id:ids.caseId,displayName:'Synthetic child',kind:'minor',state:'active',mode:'live'}]);
 const props={locale:'en' as const,role:'practitioner' as const,mode:'demo' as const};hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();
 const output=hook.render(()=>ReportsPage(props));expect(find(output,e=>e.type===ReportCaseWorkspace)).toBeUndefined();expect(find(output,e=>e.props.role==='alert')).toBeDefined();
});
it('ignores a stale case-list response after explicit live/demo context changes',async()=>{
 let resolve!:(items:unknown)=>void;accountRead.mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockResolvedValueOnce([{id:ids.caseId,displayName:'Synthetic demo',kind:'minor',state:'active',mode:'demo'}]);
 hook.render(()=>ReportsPage({locale:'en',role:'practitioner',mode:'live'}));hook.flushEffects();
 const next={locale:'en' as const,role:'practitioner' as const,mode:'demo' as const};hook.render(()=>ReportsPage(next));hook.flushEffects();await tick();
 resolve([{id:ids.otherAudienceId,displayName:'Stale live',kind:'minor',state:'active',mode:'live'}]);await tick();
 expect(find(hook.render(()=>ReportsPage(next)),e=>e.type===ReportCaseWorkspace)?.props.caseId).toBe(ids.caseId);
 expect(hook.afterUnmountUpdates()).toBe(0);
});
it('preserves a dirty report when the practitioner declines changing the selected case, and blocks an unknown write state',async()=>{
 const other=ids.otherAudienceId;accountRead.mockResolvedValue([{id:ids.caseId,displayName:'Synthetic A',kind:'minor',state:'active',mode:'demo'},{id:other,displayName:'Synthetic B',kind:'adult',state:'active',mode:'demo'}]);
 const confirm=vi.fn(()=>false);vi.stubGlobal('window',{confirm});const props={locale:'en' as const,role:'practitioner' as const,mode:'demo' as const,caseId:ids.caseId};
 hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();let output=hook.render(()=>ReportsPage(props));
 const child=find(output,e=>e.type===ReportCaseWorkspace)!;(child.props.onEditorStateChange as (s:unknown)=>void)({dirty:true,busy:false,uncertain:false});
 output=hook.render(()=>ReportsPage(props));(find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:other}});
 expect(confirm).toHaveBeenCalledTimes(1);expect(find(hook.render(()=>ReportsPage(props)),e=>e.type===ReportCaseWorkspace)?.props.caseId).toBe(ids.caseId);
 (child.props.onEditorStateChange as (s:unknown)=>void)({dirty:true,busy:false,uncertain:true});output=hook.render(()=>ReportsPage(props));
 expect(find(output,e=>e.type==='select')?.props.disabled).toBe(true);(find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:other}});
 expect(confirm).toHaveBeenCalledTimes(1);expect(find(hook.render(()=>ReportsPage(props)),e=>e.type===ReportCaseWorkspace)?.props.caseId).toBe(ids.caseId);
});
it('shows a failed case read with a bounded retry and does not update state after unmount',async()=>{
 accountRead.mockRejectedValueOnce(Error('synthetic failure')).mockResolvedValueOnce([{id:ids.caseId,displayName:'Synthetic A',kind:'minor',state:'active',mode:'demo'}]);
 const props={locale:'en' as const,role:'practitioner' as const,mode:'demo' as const};hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();
 click(hook.render(()=>ReportsPage(props)),'Retry case list')();hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();
 expect(find(hook.render(()=>ReportsPage(props)),e=>e.type===ReportCaseWorkspace)?.props.caseId).toBe(ids.caseId);expect(accountRead).toHaveBeenCalledTimes(2);
 hook.reset();let resolve!:(data:unknown)=>void;accountRead.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));hook.render(()=>ReportsPage(props));hook.flushEffects();hook.unmount();resolve([]);await tick();expect(hook.afterUnmountUpdates()).toBe(0);
});
it('updates the practitioner deep link and clears the old case audience only after a permitted case switch',async()=>{
 const other=ids.otherAudienceId;accountRead.mockResolvedValue([{id:ids.caseId,displayName:'Synthetic A',kind:'minor',state:'active',mode:'demo'},{id:other,displayName:'Synthetic B',kind:'adult',state:'active',mode:'demo'}]);
 const props={locale:'en' as const,role:'practitioner' as const,mode:'demo' as const,caseId:ids.caseId,audienceId:ids.audienceId,navigationContext:{date:'2026-09-21',view:'agenda' as const}};
 hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();const output=hook.render(()=>ReportsPage(props));
 (find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:other}});
 const target=new URL(replace.mock.calls[0]![0],'https://app.example');expect(target.pathname).toBe('/en/app/reports');expect(Object.fromEntries(target.searchParams)).toEqual({caseId:other,date:'2026-09-21',view:'agenda',mode:'demo'});
 expect(find(hook.render(()=>ReportsPage(props)),e=>e.type===ReportCaseWorkspace)?.props.initialAudienceId).toBeUndefined();
});
it('does not navigate or discard when a dirty practitioner case switch is cancelled',async()=>{
 const other=ids.otherAudienceId;accountRead.mockResolvedValue([{id:ids.caseId,displayName:'Synthetic A',kind:'minor',state:'active',mode:'demo'},{id:other,displayName:'Synthetic B',kind:'adult',state:'active',mode:'demo'}]);
 vi.stubGlobal('window',{confirm:()=>false});const props={locale:'he' as const,role:'practitioner' as const,mode:'demo' as const,caseId:ids.caseId,audienceId:ids.audienceId};
 hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();const child=find(hook.render(()=>ReportsPage(props)),e=>e.type===ReportCaseWorkspace)!;
 (child.props.onEditorStateChange as (s:unknown)=>void)({dirty:true,busy:false,uncertain:false});const output=hook.render(()=>ReportsPage(props));(find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:other}});
 expect(replace).not.toHaveBeenCalled();expect(find(hook.render(()=>ReportsPage(props)),e=>e.type===ReportCaseWorkspace)?.props.initialAudienceId).toBe(ids.audienceId);
});
it('does not substitute another published family audience for an unavailable deep link',async()=>{
 fetchMock.mockImplementation(async(url:string)=>Response.json({ok:true,data:url.startsWith('/api/identity/audiences')?[{id:ids.audienceId,visibility:'family_full',published:true}]:[]}));
 const props={locale:'en' as const,role:'practitioner' as const,caseId:ids.caseId,initialAudienceId:ids.otherAudienceId};hook.render(()=>ReportCaseWorkspace(props));hook.flushEffects();await tick();const output=hook.render(()=>ReportCaseWorkspace(props));
 expect(text(output)).toContain('No other audience was selected');expect(find(output,e=>e.type===ReportEditor)).toBeUndefined();
});
it('keeps private evidence separate from the blank family draft and preserves text on a cancelled draft switch',()=>{
 const confirm=vi.fn(()=>false);vi.stubGlobal('window',{confirm});const props={locale:'en' as const,...ids,reviews:[review('423e4567-e89b-12d3-a456-426614174000','draft')],onSaved:vi.fn()};
 let output=hook.render(()=>ReportEditor(props));expect(all(output,e=>e.type==='textarea').every(e=>e.props.value==='')).toBe(true);fillEditor(output);
 output=hook.render(()=>ReportEditor(props));(find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:'423e4567-e89b-12d3-a456-426614174000'}});
 expect(confirm).toHaveBeenCalledTimes(1);expect(all(hook.render(()=>ReportEditor(props)),e=>e.type==='textarea')[0]?.props.value).toBe('Synthetic taught');expect(fetchMock).not.toHaveBeenCalled();
});

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
