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
const review = (id: string, state: "draft" | "published", audienceId = ids.audienceId): Review => ({ id, caseId: ids.caseId, audienceId, periodStart: "2026-09-01", periodEnd: "2026-09-29", attendedSessionCount: 2, state, narrative, revision: 1 });
// A revision now awaits POST, operation readback and current-head readback.
const tick = async () => { for (let index = 0; index < 60; index++) await Promise.resolve(); };
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
 const props={locale:'en' as const,role:'practitioner' as const,mode:'demo' as const,caseId:ids.caseId,audienceId:ids.audienceId,navigationContext:{date:'2026-09-21',view:'agenda' as const,context:'client' as const}};
 hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();const output=hook.render(()=>ReportsPage(props));
 (find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:other}});
 const target=new URL(replace.mock.calls[0]![0],'https://app.example');expect(target.pathname).toBe('/en/app/reports');expect(Object.fromEntries(target.searchParams)).toEqual({caseId:other,date:'2026-09-21',view:'agenda',mode:'demo',context:'client'});
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
for(const locale of ['en','he'] as const)it(`${locale}: retries a failed authorized report read without changing its case or audience`,async()=>{
 let failed=true,resolveReviews!:(response:Response)=>void;
 fetchMock.mockImplementation(async(url:string)=>url.startsWith('/api/identity/audiences')?
  Response.json({ok:true,data:[{id:ids.audienceId,visibility:'family_full',published:true}]}):
  failed?Response.json({ok:false,error:{code:'UNAVAILABLE'}},{status:503}):new Promise<Response>(resolve=>{resolveReviews=resolve;}));
 const props={locale,role:'parent' as const,caseId:ids.caseId,initialAudienceId:ids.audienceId};
 hook.render(()=>ReportCaseWorkspace(props));hook.flushEffects();await tick();
 let output=hook.render(()=>ReportCaseWorkspace(props));expect(find(output,e=>e.props.role==='alert')).toBeDefined();
 expect(all(output,e=>e.type===ReportReadout)).toHaveLength(0);
 failed=false;click(output,locale==='he'?'ניסיון טעינה חוזר':'Retry reports')();
 output=hook.render(()=>ReportCaseWorkspace(props));hook.flushEffects();await tick();
 expect(find(output,e=>e.props.role==='status')).toBeDefined();expect(find(output,e=>e.props.role==='alert')).toBeUndefined();
 resolveReviews(Response.json({ok:true,data:[review('published','published'),review('private','draft'),review('other','published',ids.otherAudienceId)]}));await tick();
 output=hook.render(()=>ReportCaseWorkspace(props));expect(all(output,e=>e.type===ReportReadout).map(e=>(e.props.review as Review).id)).toEqual(['published']);
 expect(find(output,e=>e.type==='select')?.props.value).toBe(ids.audienceId);expect(fetchMock).toHaveBeenCalledTimes(4);
 expect(fetchMock.mock.calls.every(([url,init])=>String(url).includes(`caseId=${ids.caseId}`)&&!(init as RequestInit).method)).toBe(true);
});
it('a report retry preserves an unavailable requested audience instead of choosing another one',async()=>{
 let failed=true;fetchMock.mockImplementation(async(url:string)=>Response.json(failed?{ok:false}:{ok:true,data:url.startsWith('/api/identity/audiences')?[{id:ids.audienceId,visibility:'family_full',published:true}]:[]},{status:failed?503:200}));
 const props={locale:'en' as const,role:'practitioner' as const,caseId:ids.caseId,initialAudienceId:ids.otherAudienceId,section:'drafts' as const};
 hook.render(()=>ReportCaseWorkspace(props));hook.flushEffects();await tick();failed=false;
 click(hook.render(()=>ReportCaseWorkspace(props)),'Retry reports')();hook.render(()=>ReportCaseWorkspace(props));hook.flushEffects();await tick();
 const output=hook.render(()=>ReportCaseWorkspace(props));expect(text(output)).toContain('No other audience was selected');expect(find(output,e=>e.type===ReportEditor)).toBeUndefined();
});
it('does not render stale report data on a case change or accept its late response',async()=>{
 let resolveOld!:(response:Response)=>void;
 fetchMock.mockImplementation(async(url:string)=>url.includes(`caseId=${ids.caseId}`)?
  url.startsWith('/api/identity/audiences')?Response.json({ok:true,data:[{id:ids.audienceId,visibility:'family_full',published:true}]}):new Promise<Response>(resolve=>{resolveOld=resolve;}):
  Response.json({ok:true,data:url.startsWith('/api/identity/audiences')?[{id:ids.audienceId,visibility:'family_full',published:true}]:[{...review('current','published'),caseId:ids.otherAudienceId}]}));
 hook.render(()=>ReportCaseWorkspace({locale:'en',role:'parent',caseId:ids.caseId}));hook.flushEffects();await tick();
 const props={locale:'en' as const,role:'parent' as const,caseId:ids.otherAudienceId};
 expect(all(hook.render(()=>ReportCaseWorkspace(props)),e=>e.type===ReportReadout)).toHaveLength(0);hook.flushEffects();await tick();
 resolveOld(Response.json({ok:true,data:[review('stale','published')]}));await tick();
 expect(all(hook.render(()=>ReportCaseWorkspace(props)),e=>e.type===ReportReadout).map(e=>(e.props.review as Review).id)).toEqual(['current']);
 hook.unmount();await tick();expect(hook.afterUnmountUpdates()).toBe(0);
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

for(const locale of ['en','he'] as const)it(`${locale}: adult reports use independent wording, authorized cases and published-only readouts`,async()=>{
 accountRead.mockResolvedValue([{id:ids.caseId,displayName:'Synthetic adult',kind:'adult'}]);
 const props={locale,role:'adult_client' as const,caseId:ids.caseId};
 hook.render(()=>ReportsPage(props));hook.flushEffects();await tick();let output=hook.render(()=>ReportsPage(props));
 expect(accountRead).toHaveBeenCalledWith('cases');expect(text(output)).not.toMatch(/Child|Family|ילד\/ה|משפחה/);
 expect(find(output,e=>e.type==='a')?.props.href).toBe(`/${locale}/client`);
 hook.reset();
 fetchMock.mockImplementation(async(url:string)=>Response.json({ok:true,data:url.startsWith('/api/identity/audiences')?[{id:ids.audienceId,visibility:'family_full',published:true}]:[review('published','published'),review('draft','draft'),review('wrong-audience','published',ids.otherAudienceId),{...review('wrong-case','published'),caseId:ids.otherAudienceId}]}));
 hook.render(()=>ReportCaseWorkspace(props));hook.flushEffects();await tick();output=hook.render(()=>ReportCaseWorkspace(props));
 expect(all(output,e=>e.type===ReportReadout).map(e=>(e.props.review as Review).id)).toEqual(['published']);
 expect(all(output,e=>e.type===ReportEditor)).toHaveLength(0);expect(text(output)).not.toMatch(/Family|family|משפחה|Private draft/);
 expect(fetchMock.mock.calls.every(call=>!(call[1] as RequestInit)?.method)).toBe(true);
});
it("renders the actual parent-published report readout without implied parent attribution", () => {
  const output = hook.render(() => ReportReadout({ locale: "en", review: review("423e4567-e89b-12d3-a456-426614174000", "published") }));
  expect(text(output)).toContain("Synthetic observation"); expect(text(output)).toContain("2026-09-29"); expect(text(output)).not.toContain("Attributed parent reports");
});

for(const section of ['due','drafts','published','history'] as const)it(`renders only ${section} report content without an unrelated editor or expanded readouts`,async()=>{
 const draft={...review('423e4567-e89b-12d3-a456-426614174000','draft'),periodStart:'2000-01-01',periodEnd:'2000-01-29'},published=review('523e4567-e89b-12d3-a456-426614174000','published');
 fetchMock.mockImplementation(async(url:string)=>Response.json({ok:true,data:url.startsWith('/api/identity/audiences')?[{id:ids.audienceId,visibility:'family_full',published:true}]:[draft,published]}));
 const props={locale:'en' as const,role:'practitioner' as const,caseId:ids.caseId,section,navigationContext:{mode:'demo' as const,context:'client' as const,date:'2026-09-29'}};
 hook.render(()=>ReportCaseWorkspace(props));hook.flushEffects();await tick();const output=hook.render(()=>ReportCaseWorkspace(props));
 const readouts=all(output,e=>e.type===ReportReadout);expect(readouts.map(e=>(e.props.review as Review).state)).toEqual(section==='published'?['published']:section==='history'?['draft','published']:['draft']);
 expect(all(output,e=>e.type===ReportEditor)).toHaveLength(section==='drafts'?1:0);
 expect(all(output,e=>e.type==='details').every(e=>e.props.open===undefined)).toBe(true);
 const tabs=all(output,e=>e.type==='a'&&typeof e.props.href==='string'&&e.props['aria-current']==='page');expect(tabs).toHaveLength(1);expect(tabs[0]?.props.href).toContain(`audienceId=${ids.audienceId}&section=${section}`);
 expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls.every(call=>!call[1]||(call[1] as RequestInit).method!=='POST')).toBe(true);
});

it('a forged parent view hint cannot render practitioner editing or private history',async()=>{
 fetchMock.mockImplementation(async(url:string)=>Response.json({ok:true,data:url.startsWith('/api/identity/audiences')?[{id:ids.audienceId,visibility:'family_full',published:true}]:[review('423e4567-e89b-12d3-a456-426614174000','draft')]}));
 const props={locale:'he' as const,role:'parent' as const,caseId:ids.caseId,section:'history' as const};hook.render(()=>ReportCaseWorkspace(props));hook.flushEffects();await tick();const output=hook.render(()=>ReportCaseWorkspace(props));
 expect(all(output,e=>e.type===ReportEditor)).toHaveLength(0);expect(all(output,e=>e.type===ReportReadout)).toHaveLength(0);expect(all(output,e=>e.type==='nav')).toHaveLength(0);expect(text(output)).toContain('אין דוחות להצגה.');
});

it("blocks publish when selected draft has unsaved edits", async () => {
  const onSaved = vi.fn(); let output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [review("423e4567-e89b-12d3-a456-426614174000", "draft")], onSaved }));
  const select = find(output, (element) => element.type === "select"); if (!select) throw new Error("missing draft select"); (select.props.onChange as Change)({ target: { value: "423e4567-e89b-12d3-a456-426614174000" } });
  output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [review("423e4567-e89b-12d3-a456-426614174000", "draft")], onSaved })); const field = find(output, (element) => element.type === "textarea"); if (!field) throw new Error("missing field"); (field.props.onChange as Change)({ target: { value: "Dirty synthetic edit" } });
  output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [review("423e4567-e89b-12d3-a456-426614174000", "draft")], onSaved })); click(output, "Publish saved draft")(); await tick();
  expect(vi.mocked(fetch)).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
});

it("writes once for a double-click and sends CSRF-bound new-draft data", async () => {
  let resolve!: (response: Response) => void,readback!: (response:Response)=>void; fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })).mockImplementationOnce(()=>new Promise<Response>(done=>{readback=done;})); const onSaved = vi.fn(); let output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); hook.flushEffects(); fillEditor(output);
  output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); const saveButton = find(output, (element) => element.type === "button" && element.props.children === "Save new draft version"); expect(saveButton?.props.disabled).toBe(false); const save = click(output, "Save new draft version"); save(); save(); await tick(); expect(sessionInfo).toHaveBeenCalledTimes(1); output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); expect(text(output)).not.toContain("Complete the required fields"); expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = fetchMock.mock.calls[0]![1] as RequestInit; expect(request.headers).toMatchObject({ "X-CSRF-Token": "c".repeat(43) }); expect(JSON.parse(String(request.body))).toMatchObject({ caseId: ids.caseId, audienceId: ids.audienceId, parentReportIds: [], assignmentVersionIds: [] });
  resolve(Response.json({ ok: true, data: { reviewId: "723e4567-e89b-12d3-a456-426614174000", attendedSessionCount: 3,revision:1 } })); await tick(); expect(onSaved).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(2);
  const saved={...review('723e4567-e89b-12d3-a456-426614174000','draft'),attendedSessionCount:3,narrative:JSON.parse(String(request.body)).narrative};
  readback(Response.json({ok:true,data:[saved]}));await tick();expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved);
});

it("suppresses onSaved after unmount", async () => {
  let resolve!: (response: Response) => void; fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })); const onSaved = vi.fn(); let output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); hook.flushEffects(); fillEditor(output); output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); click(output, "Save new draft version")(); await tick(); hook.unmount(); resolve(Response.json({ ok: true, data: { reviewId: "723e4567-e89b-12d3-a456-426614174000", attendedSessionCount: 3 } })); await tick(); expect(onSaved).not.toHaveBeenCalled(); expect(hook.afterUnmountUpdates()).toBe(0);
});

it("locks an ambiguous mutation failure behind explicit reload", async () => {
  fetchMock.mockRejectedValueOnce(new Error("ambiguous synthetic failure")); const onSaved = vi.fn(); let output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); hook.flushEffects(); fillEditor(output);
  output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); click(output, "Save new draft version")(); await tick(); output = hook.render(() => ReportEditor({ locale: "en", ...ids, reviews: [], onSaved })); expect(text(output)).toContain("Reload reports"); click(output, "Save new draft version")(); await tick();
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(onSaved).not.toHaveBeenCalled();
});

for(const locale of ['en','he'] as const)it(`${locale}: a confirmed duplicate-period409 keeps text and permits choosing another period, without claiming a save`,async()=>{
 fetchMock.mockResolvedValueOnce(Response.json({ok:false,error:{code:'CONFLICT'}},{status:409}));const onSaved=vi.fn(),props={locale,...ids,reviews:[],onSaved};
 let output=hook.render(()=>ReportEditor(props));hook.flushEffects();fillEditor(output);output=hook.render(()=>ReportEditor(props));click(output,locale==='he'?'שמירת גרסת טיוטה חדשה':'Save new draft version')();await tick();output=hook.render(()=>ReportEditor(props));
 expect(onSaved).not.toHaveBeenCalled();expect(all(output,e=>e.type==='textarea')[0]?.props.value).toBe('Synthetic taught');expect(text(output)).toContain(locale==='he'?'כבר קיים דוח לתקופה הזו':'A report for this period already exists');expect(text(output)).not.toContain(locale==='he'?'נשמרה טיוטה חדשה':'New draft saved');expect(find(output,e=>e.props.role==='alert')).toBeDefined();expect(text(output)).not.toContain(locale==='he'?'טעינת דוחות מחדש':'Reload reports');
 const input=find(output,e=>e.type==='input')!;(input.props.onChange as Change)({target:{value:'2026-10-01'}});output=hook.render(()=>ReportEditor(props));expect(all(output,e=>e.type==='textarea')[0]?.props.value).toBe('Synthetic taught');expect(find(output,e=>e.type==='button'&&e.props.children===(locale==='he'?'שמירת גרסת טיוטה חדשה':'Save new draft version'))?.props.disabled).toBe(false);
});
it('keeps an unrecognized409 response behind the existing ambiguous-write lock',async()=>{
 fetchMock.mockResolvedValueOnce(Response.json({ok:false,error:{code:'UNEXPECTED'}},{status:409}));const onSaved=vi.fn(),props={locale:'en' as const,...ids,reviews:[],onSaved};let output=hook.render(()=>ReportEditor(props));hook.flushEffects();fillEditor(output);click(hook.render(()=>ReportEditor(props)),'Save new draft version')();await tick();output=hook.render(()=>ReportEditor(props));expect(text(output)).toContain('Reload reports');expect(text(output)).not.toContain('A report for this period already exists');expect(onSaved).not.toHaveBeenCalled();
});

for(const locale of ['en','he'] as const){
 it(`${locale}: edits a fixed saved period using one revision request, preserved attribution and actual readback after a lost response`,async()=>{
  const original={...review('423e4567-e89b-12d3-a456-426614174000','draft'),parentReports:[{reportId:'synthetic-parent-report'}],assignmentVersionIds:['synthetic-version'],narrative:{...narrative,parentReportedExamples:['Synthetic attributed example to preserve']}};
  let sent:Record<string,unknown>|undefined;
  fetchMock.mockImplementation(async(url:string,options?:RequestInit)=>{
   if(options?.method==='POST'){sent=JSON.parse(String(options.body));throw Error('Synthetic response lost after commit');}
   const saved={...original,revision:2,narrative:sent!.narrative};
   return Response.json({ok:true,data:url.includes('/revisions?')?{reviewId:original.id,currentRevision:2,state:'draft',hasMore:false,nextBefore:null,revisions:[{revision:2,operationId:sent!.operationId,savedAt:'2026-09-29T10:00:00Z',authorAccountId:'synthetic-owner',narrative:sent!.narrative}]}:[saved]});
  });
  const onSaved=vi.fn(),props={locale,...ids,reviews:[original],onSaved};let output=hook.render(()=>ReportEditor(props));hook.flushEffects();
  expect(find(output,e=>e.type==='select')?.props['aria-label']).toBe(locale==='he'?'טיוטה שמורה':'Saved draft');
  (find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:original.id}});output=hook.render(()=>ReportEditor(props));
  expect(find(output,e=>e.type==='input')?.props.disabled).toBe(true);
  (all(output,e=>e.type==='textarea')[5]!.props.onChange as Change)({target:{value:'Synthetic revised next'}});
  output=hook.render(()=>ReportEditor(props));const save=click(output,locale==='he'?'שמירת גרסת הטיוטה':'Save draft revision');save();save();await tick();
  expect(fetchMock.mock.calls.filter(call=>(call[1] as RequestInit)?.method==='POST')).toHaveLength(1);
  expect(sent).toMatchObject({reviewId:original.id,expectedRevision:1,narrative:{...original.narrative,nextAdjustment:'Synthetic revised next'}});
  expect(sent).not.toHaveProperty('periodStart');expect(sent).not.toHaveProperty('parentReportIds');
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:original.id,revision:2,narrative:sent!.narrative}));
  expect(text(hook.render(()=>ReportEditor(props)))).toContain(locale==='he'?'אומתה בקריאה חוזרת':'saved and read back');
 });
}

it('an interrupted revision read stays locked, preserves input, and retries the identical request after real readback is unavailable',async()=>{
 const original=review('423e4567-e89b-12d3-a456-426614174000','draft'),requests:unknown[]=[];
 let unavailable=true;
 fetchMock.mockImplementation(async(url:string,options?:RequestInit)=>{
  if(options?.method==='POST'){const body=JSON.parse(String(options.body));requests.push(body);return Response.json({ok:true,data:{reviewId:body.reviewId,revision:2,operationId:body.operationId}});}
  if(unavailable)return Response.json({ok:false,error:{code:'RATE_LIMITED'}},{status:429});
  const body=requests[0] as {operationId:string;narrative:typeof narrative};
  return Response.json({ok:true,data:url.includes('/revisions?')?{reviewId:original.id,currentRevision:2,state:'draft',hasMore:false,nextBefore:null,revisions:[{revision:2,operationId:body.operationId,savedAt:'2026-09-29T10:00:00Z',authorAccountId:'synthetic-owner',narrative:body.narrative}]}:[{...original,revision:2,narrative:body.narrative}]});
 });
 const onSaved=vi.fn(),props={locale:'en' as const,...ids,reviews:[original],onSaved};let output=hook.render(()=>ReportEditor(props));hook.flushEffects();
 (find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:original.id}});output=hook.render(()=>ReportEditor(props));
 (all(output,e=>e.type==='textarea')[5]!.props.onChange as Change)({target:{value:'Synthetic preserved uncertain edit'}});
 click(hook.render(()=>ReportEditor(props)),'Save draft revision')();await tick();output=hook.render(()=>ReportEditor(props));
 expect(onSaved).not.toHaveBeenCalled();expect(all(output,e=>e.type==='textarea')[5]?.props.value).toBe('Synthetic preserved uncertain edit');expect(find(output,e=>e.type==='select')?.props.disabled).toBe(true);
 unavailable=false;click(output,'Retry the same revision')();await tick();
 expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(onSaved).toHaveBeenCalledTimes(1);
});

it('a confirmed newer draft keeps the loser text, blocks blind publication and offers an explicit reviewed rebase',async()=>{
 const original=review('423e4567-e89b-12d3-a456-426614174000','draft'),newer={...original,revision:2,narrative:{...narrative,nextAdjustment:'Synthetic other tab saved'}};
 fetchMock.mockImplementation(async(url:string,options?:RequestInit)=>Response.json(options?.method==='POST'?{ok:false,error:{code:'CONFLICT'}}:{ok:true,data:url.includes('/revisions?')?{reviewId:original.id,currentRevision:2,state:'draft',hasMore:false,nextBefore:null,revisions:[]}:[newer]},{status:options?.method==='POST'?409:200}));
 const confirm=vi.fn(()=>false);vi.stubGlobal('window',{confirm});
 const onSaved=vi.fn(),props={locale:'en' as const,...ids,reviews:[original],onSaved};let output=hook.render(()=>ReportEditor(props));hook.flushEffects();
 (find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:original.id}});output=hook.render(()=>ReportEditor(props));(all(output,e=>e.type==='textarea')[5]!.props.onChange as Change)({target:{value:'Synthetic unsaved loser'}});
 click(hook.render(()=>ReportEditor(props)),'Save draft revision')();await tick();output=hook.render(()=>ReportEditor(props));
 expect(text(output)).toContain('Another saved revision exists');expect(all(output,e=>e.type==='textarea')[5]?.props.value).toBe('Synthetic unsaved loser');expect(find(output,e=>e.type==='button'&&e.props.children==='Publish saved draft')?.props.disabled).toBe(true);
 click(output,'Keep my text and use this saved revision as the base')();expect(confirm).toHaveBeenCalledTimes(1);expect(find(hook.render(()=>ReportEditor(props)),e=>e.type==='select')?.props.disabled).toBe(true);
 confirm.mockReturnValue(true);click(hook.render(()=>ReportEditor(props)),'Keep my text and use this saved revision as the base')();output=hook.render(()=>ReportEditor(props));expect(all(output,e=>e.type==='textarea')[5]?.props.value).toBe('Synthetic unsaved loser');expect(find(output,e=>e.type==='button'&&e.props.children==='Save draft revision')?.props.disabled).toBe(false);
});

it('publishes only the exact reviewed revision and does not claim success until the published narrative is read back',async()=>{
 const original={...review('423e4567-e89b-12d3-a456-426614174000','draft'),revision:3};let readback!:(value:Response)=>void;
 fetchMock.mockResolvedValueOnce(Response.json({ok:true,data:{reviewId:original.id,revision:3,attendedSessionCount:2}})).mockImplementationOnce(()=>new Promise<Response>(done=>{readback=done;}));
 const onSaved=vi.fn(),props={locale:'en' as const,...ids,reviews:[original],onSaved};const output=hook.render(()=>ReportEditor(props));hook.flushEffects();(find(output,e=>e.type==='select')!.props.onChange as Change)({target:{value:original.id}});
 click(hook.render(()=>ReportEditor(props)),'Publish saved draft')();await tick();expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({reviewId:original.id,expectedRevision:3});expect(onSaved).not.toHaveBeenCalled();
 readback(Response.json({ok:true,data:[{...original,state:'published'}]}));await tick();expect(onSaved).toHaveBeenCalledExactlyOnceWith({...original,state:'published'});
});
