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
vi.mock("../../../src/features/identity/client.ts", async importOriginal => ({ ...await importOriginal<typeof import('../../../src/features/identity/client.ts')>(), accountRead, sessionInfo }));
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
async function ready(props: Parameters<typeof UpdatesWorkspace>[0]) { for (let index = 0; index < 5; index++) { render(props); hook.flushEffects(); await tick(); } return render(props); }
const authorizedRead = (url: string) => Response.json({ ok: true, data: url.startsWith('/api/identity/audiences') ? [{ id: audienceA, visibility: 'family_full' }] : [] });

beforeEach(() => { hook.reset(); accountRead.mockReset(); sessionInfo.mockClear(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.spyOn(crypto, "randomUUID").mockRestore(); });

function historyFixture(){
 const id=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`,at='2026-10-04T07:00:00.000Z',report={id:id(1),workspaceId:id(2),caseId:caseA,audienceId:audienceA,authorAccountId:id(3),body:'DEMO attributed history',eventAt:null,submittedAt:at,reviewState:'replied',reviewedByAccountId:id(4),reviewedAt:at,practice:{workspaceId:id(2),caseId:caseA,assignmentId:id(5),versionId:id(6),audienceId:audienceA,visibility:'family_full',publishedAt:at,immutableSnapshotDigest:'a'.repeat(64)}};
 const reply=(n:number,body:string)=>({id:id(n),reportId:report.id,authorAccountId:id(4),body,state:'published',createdAt:at,publishedAt:at,supersedesReplyId:null});
 const latest={report,replies:Array.from({length:100},(_,n)=>reply(n+100,'DEMO latest reply')),nextRepliesBefore:id(100)},older={report,replies:[reply(99,'DEMO oldest reply')],nextRepliesBefore:null};
 return{latest,older};
}
it.each(['en','he'] as const)('pages actual retained reply controls with retry/latest return and unsaved input preserved (%s)',async locale=>{
 const f=historyFixture(),props={locale,role:'practitioner' as const,initialCaseId:caseA,initialAudienceId:audienceA};let fail=true;
 accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO synthetic case',kind:'minor'}]);
 fetchMock.mockImplementation(async(url:string)=>{if(url.startsWith('/api/identity/audiences'))return authorizedRead(url);const older=new URL(url,'https://synthetic.invalid').searchParams.has('beforeReplyId');return older&&fail?Response.json({ok:false},{status:503}):Response.json({ok:true,data:[older?f.older:f.latest]});});
 let output=await ready(props);(find(output,e=>e.type==='textarea'&&e.props.id===`reply-${f.latest.report.id}`)?.props.onChange as Change)({target:{value:'DEMO unsaved reply'}});output=render(props);
 const olderLabel=locale==='en'?'Read older replies':'קריאת תגובות קודמות';(find(output,e=>e.type==='button'&&e.props.children===olderLabel)?.props.onClick as Click)();await tick();output=render(props);
 expect(text(output)).toContain('DEMO latest reply');expect(find(output,e=>e.type==='textarea')?.props.value).toBe('DEMO unsaved reply');expect(text(output)).not.toContain('DEMO oldest reply');
 fail=false;(find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Retry reply history':'ניסיון קריאת היסטוריית תגובות נוסף'))?.props.onClick as Click)();await tick();output=render(props);
 expect(text(output)).toContain('DEMO oldest reply');expect(text(output)).not.toContain('DEMO latest reply');expect(find(output,e=>e.type==='textarea')?.props.value).toBe('DEMO unsaved reply');
 (find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Return to latest replies':'חזרה לתגובות האחרונות'))?.props.onClick as Click)();await tick();output=render(props);
 expect(text(output)).toContain('DEMO latest reply');expect(text(output)).not.toContain('DEMO oldest reply');expect(find(output,e=>e.type==='textarea')?.props.value).toBe('DEMO unsaved reply');expect(postBodies()).toHaveLength(0);
});
it('clears private history and the unsaved reply when a fresh older-page read is denied',async()=>{
 const f=historyFixture(),props={locale:'en' as const,role:'practitioner' as const,initialCaseId:caseA,initialAudienceId:audienceA};
 accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO synthetic case',kind:'minor'}]);fetchMock.mockImplementation(async(url:string)=>url.startsWith('/api/identity/audiences')?authorizedRead(url):url.includes('beforeReplyId')?new Response('',{status:403}):Response.json({ok:true,data:[f.latest]}));
 let output=await ready(props);(find(output,e=>e.type==='textarea')?.props.onChange as Change)({target:{value:'DEMO revoked unsaved reply'}});output=render(props);(find(output,e=>e.type==='button'&&e.props.children==='Read older replies')?.props.onClick as Click)();await tick();output=render(props);
 expect(text(output)).not.toContain('DEMO latest reply');expect(JSON.stringify(output)).not.toContain('DEMO revoked unsaved reply');expect(find(output,e=>e.type==='textarea')).toBeUndefined();expect(postBodies()).toHaveLength(0);
});

it.each(['en','he'] as const)('settles an abandoned older-page read without locking or transferring reply text (%s)',async locale=>{
 for(const outcome of ['success','failure'] as const){
  hook.reset();accountRead.mockReset();fetchMock.mockReset();const f=historyFixture();let resolve!:(response:Response)=>void,hold=true;
  const a={locale,role:'practitioner' as const,initialCaseId:caseA,initialAudienceId:audienceA},b={...a,initialCaseId:caseB,initialAudienceId:audienceB};
  accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO A',kind:'minor'},{id:caseB,displayName:'DEMO B',kind:'minor'}]);
  fetchMock.mockImplementation((url:string)=>{
   const query=new URL(url,'https://synthetic.invalid').searchParams,inB=query.get('caseId')===caseB;
   if(url.startsWith('/api/identity/audiences'))return Promise.resolve(Response.json({ok:true,data:[{id:inB?audienceB:audienceA,visibility:'family_full'}]}));
   if(query.has('beforeReplyId')&&hold)return new Promise<Response>(r=>{resolve=r;});
   return Promise.resolve(Response.json({ok:true,data:inB?[]:[query.has('beforeReplyId')?f.older:f.latest]}));
  });
  let output=await ready(a);(find(output,e=>e.type==='textarea')!.props.onChange as Change)({target:{value:'DEMO A scoped unsaved reply'}});output=render(a);
  (find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Read older replies':'קריאת תגובות קודמות'))!.props.onClick as Click)();await tick();
  output=await ready(b);expect(JSON.stringify(output)).not.toContain('DEMO A scoped unsaved reply');
  hold=false;resolve(outcome==='success'?Response.json({ok:true,data:[f.older]}):Response.json({ok:false},{status:503}));await tick();output=render(b);
  expect(text(output)).not.toContain('DEMO oldest reply');expect(JSON.stringify(output)).not.toContain('DEMO A scoped unsaved reply');
  output=await ready(a);expect(find(output,e=>e.type==='textarea')!.props.value).toBe('DEMO A scoped unsaved reply');expect(find(output,e=>e.type==='textarea')!.props.disabled).toBe(false);
  const older=find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Read older replies':'קריאת תגובות קודמות'))!;expect(older.props.disabled).toBe(false);
  (older.props.onClick as Click)();await tick();output=render(a);expect(text(output)).toContain('DEMO oldest reply');expect(find(output,e=>e.type==='textarea')!.props.value).toBe('DEMO A scoped unsaved reply');expect(postBodies()).toHaveLength(0);
 }
});

it('does not update abandoned reply-page state after unmount',async()=>{
 const f=historyFixture(),props={locale:'en' as const,role:'practitioner' as const,initialCaseId:caseA,initialAudienceId:audienceA};let resolve!:(response:Response)=>void;
 accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO A',kind:'minor'}]);fetchMock.mockImplementation((url:string)=>url.includes('beforeReplyId')?new Promise<Response>(r=>{resolve=r;}):Promise.resolve(url.startsWith('/api/identity/audiences')?authorizedRead(url):Response.json({ok:true,data:[f.latest]})));
 const output=await ready(props);(find(output,e=>e.type==='button'&&e.props.children==='Read older replies')!.props.onClick as Click)();await tick();hook.unmount();resolve(Response.json({ok:true,data:[f.older]}));await tick();expect(hook.afterUnmountUpdates()).toBe(0);expect(postBodies()).toHaveLength(0);
});

it.each(['en','he'] as const)('aborts a stalled old-context reply read and fences its cleanup from the new read (%s)',async locale=>{
 const f=historyFixture(),id='90000000-0000-4000-8000-000000000001',bLatest={...f.latest,report:{...f.latest.report,id,caseId:caseB,audienceId:audienceB,practice:{...f.latest.report.practice,caseId:caseB,audienceId:audienceB}},replies:f.latest.replies.map(row=>({...row,reportId:id}))},bOlder={...bLatest,replies:[{...f.older.replies[0]!,reportId:id}],nextRepliesBefore:null};
 const a={locale,role:'practitioner' as const,initialCaseId:caseA,initialAudienceId:audienceA},b={...a,initialCaseId:caseB,initialAudienceId:audienceB};let resolveA!:(r:Response)=>void,resolveB!:(r:Response)=>void,signalA:AbortSignal|undefined;
 accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO A',kind:'minor'},{id:caseB,displayName:'DEMO B',kind:'minor'}]);
 fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
  const q=new URL(url,'https://synthetic.invalid').searchParams,inB=q.get('caseId')===caseB;
  if(url.startsWith('/api/identity/audiences'))return Promise.resolve(Response.json({ok:true,data:[{id:inB?audienceB:audienceA,visibility:'family_full'}]}));
  if(q.has('beforeReplyId'))return new Promise<Response>(resolve=>{if(inB)resolveB=resolve;else{resolveA=resolve;signalA=options?.signal??undefined;}});
  return Promise.resolve(Response.json({ok:true,data:[inB?bLatest:f.latest]}));
 });
 const label=locale==='en'?'Read older replies':'קריאת תגובות קודמות';let output=await ready(a);(find(output,e=>e.type==='button'&&e.props.children===label)!.props.onClick as Click)();await tick();expect(signalA).toBeInstanceOf(AbortSignal);
 output=await ready(b);expect(signalA!.aborted).toBe(true);(find(output,e=>e.type==='button'&&e.props.children===label)!.props.onClick as Click)();await tick();expect(resolveB).toBeTypeOf('function');
 // Even a misbehaving transport resolving AFTER abort cannot clear the new lock.
 resolveA(Response.json({ok:true,data:[f.older]}));await tick();output=render(b);expect(find(output,e=>e.type==='textarea')!.props.disabled).toBe(true);expect(text(output)).not.toContain('DEMO oldest reply');
 resolveB(Response.json({ok:true,data:[bOlder]}));await tick();output=render(b);expect(find(output,e=>e.type==='textarea')!.props.disabled).toBe(false);expect(text(output)).toContain('DEMO oldest reply');expect(postBodies()).toHaveLength(0);
});

it("requires exact case, audience, and practice-version context", () => { expect(feedbackContextReady(caseA, caseA, audienceA, "version-a")).toBe(true); expect(feedbackContextReady(caseA, caseB, audienceA, "version-a")).toBe(false); expect(feedbackContextReady(caseA, caseA, "", "version-a")).toBe(false); });

it("does not render old case/audience data after a delayed switch", async () => {
  accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }, { id: caseB, displayName: "Synthetic B", kind: "minor" }]);
  let resolveA!: (response: Response) => void, resolveB!: (response: Response) => void;
  fetchMock.mockImplementation((url: string) => { if (url.includes(encodeURIComponent(caseA))) return new Promise<Response>((resolve) => { resolveA = resolve; }); if (url.includes(encodeURIComponent(caseB))) return new Promise<Response>((resolve) => { resolveB = resolve; }); return Promise.resolve(Response.json({ ok: true, data: [] })); });
  render({ locale: "en", role: "practitioner" }); hook.flushEffects(); await tick(); let output = render({ locale: "en", role: "practitioner" }); hook.flushEffects(); await tick();
  const select = find(output, (element) => element.type === "select" && element.props.id === "update-case"); if (!select) throw new Error("missing case select"); (select.props.onChange as Change)({ target: { value: caseB } }); output = render({ locale: "en", role: "practitioner" }); hook.flushEffects(); await tick();
   resolveB(Response.json({ ok: true, data: [{ id: audienceB, visibility: "family_full" }] })); await tick(); output = render({ locale: "en", role: "practitioner" }); expect(text(output)).toContain("Authorized participants");
  resolveA(Response.json({ ok: true, data: [{ id: audienceA, visibility: "family_full" }] })); await tick(); output = render({ locale: "en", role: "practitioner" }); expect(JSON.stringify(output)).not.toContain(audienceA); expect(JSON.stringify(output)).toContain(audienceB);
});

it("keeps an exact known-rejected retry key and rotates it after a changed payload", async () => {
  accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }]); let next = 0; vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-00000000000${++next}`);
   fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === "POST" ? Response.json({ok:false,error:{code:'INVALID_REQUEST'}},{status:400}) : authorizedRead(url))); const props = { locale: "en" as const, role: "parent" as const, initialCaseId: caseA, initialAudienceId: audienceA, initialPracticeVersionId: "version-a" };
   let output = await ready(props); const open = find(output, (element) => element.type === "button" && element.props.children === "Add feedback"); if (!open) throw new Error("missing composer"); (open.props.onClick as Click)(); output = render(props); const area = find(output, (element) => element.type === "textarea" && element.props.id === "update-body"); const form = find(output, (element) => element.type === "form"); if (!area || !form) throw new Error("missing composer form"); (area.props.onChange as Change)({ target: { value: "Synthetic retry" } }); output = render(props); const submit = find(output, (element) => element.type === "form"); (submit?.props.onSubmit as Submit)({ preventDefault() {} }); await tick(); output = render(props); (find(output, (element) => element.type === "form")?.props.onSubmit as Submit)({ preventDefault() {} }); await tick(); let bodies = postBodies(); expect(bodies).toHaveLength(2); expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
  const changed = find(output, (element) => element.type === "textarea" && element.props.id === "update-body"); if (!changed) throw new Error("missing changed body"); (changed.props.onChange as Change)({ target: { value: "Synthetic changed" } }); output = render(props); (find(output, (element) => element.type === "form")?.props.onSubmit as Submit)({ preventDefault() {} }); await tick(); bodies = postBodies(); expect(bodies).toHaveLength(3); expect(bodies[2].idempotencyKey).not.toBe(bodies[0].idempotencyKey);
});

it("submits only one write for two same-tick clicks", async () => {
   accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }]); let resolve!: (response: Response) => void; fetchMock.mockImplementation((url: string, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>((done) => { resolve = done; }) : Promise.resolve(authorizedRead(url))); const props = { locale: "en" as const, role: "parent" as const, initialCaseId: caseA, initialAudienceId: audienceA, initialPracticeVersionId: "version-a" };
   let output = await ready(props); (find(output, (element) => element.type === "button" && element.props.children === "Add feedback")?.props.onClick as Click)(); output = render(props); (find(output, (element) => element.type === "textarea" && element.props.id === "update-body")?.props.onChange as Change)({ target: { value: "Synthetic same tick" } }); output = render(props); const submit = find(output, (element) => element.type === "form")?.props.onSubmit as Submit; submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick(); expect(postBodies()).toHaveLength(1);
   resolve(Response.json({ ok: true, data: {} })); await tick();
});

it("suppresses pending callbacks after unmount", async () => {
   accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }]); let resolve!: (response: Response) => void; fetchMock.mockImplementation((url: string, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>((done) => { resolve = done; }) : Promise.resolve(authorizedRead(url))); const props = { locale: "en" as const, role: "parent" as const, initialCaseId: caseA, initialAudienceId: audienceA, initialPracticeVersionId: "version-a" };
   let output = await ready(props); (find(output, (element) => element.type === "button" && element.props.children === "Add feedback")?.props.onClick as Click)(); output = render(props); (find(output, (element) => element.type === "textarea" && element.props.id === "update-body")?.props.onChange as Change)({ target: { value: "Synthetic pending" } }); output = render(props); (find(output, (element) => element.type === "form")?.props.onSubmit as Submit)({ preventDefault() {} }); await tick(); hook.unmount(); resolve(Response.json({ ok: true, data: {} })); await tick(); expect(hook.afterUnmountUpdates()).toBe(0);
});
it.each([['en','post'],['he','post'],['en','session'],['he','session']] as const)('%s settles only the old-context %s write without reporting success, leaking input or changing its retry key',async(locale,phase)=>{
 accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO A',kind:'minor'},{id:caseB,displayName:'DEMO B',kind:'minor'}]);
 let resolve!: (value:Response)=>void,resolveSession!: (value:{csrfToken:string})=>void;
 if(phase==='session')sessionInfo.mockImplementationOnce(()=>new Promise(done=>{resolveSession=done;}));
 fetchMock.mockImplementation((url:string,init?:RequestInit)=>init?.method==='POST'?new Promise<Response>(done=>{resolve=done;}):Promise.resolve(Response.json({ok:true,data:url.startsWith('/api/identity/audiences')?[{id:url.includes(caseB)?audienceB:audienceA,visibility:'family_full'}]:[]})));
 const a={locale,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'},b={...a,initialCaseId:caseB,initialAudienceId:audienceB,initialPracticeVersionId:'version-b'};
 let output=await ready(a);(find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Add feedback':'הוספת משוב'))!.props.onClick as Click)();output=render(a);
 (find(output,e=>e.type==='textarea')!.props.onChange as Change)({target:{value:'DEMO A private unsaved body'}});output=render(a);(find(output,e=>e.type==='form')!.props.onSubmit as Submit)({preventDefault(){}});await tick();
 const original=postBodies()[0];output=await ready(b);expect(JSON.stringify(output)).not.toContain('DEMO A private unsaved body');
 if(phase==='post')resolve(Response.json({ok:true,data:{}}));else resolveSession({csrfToken:'c'.repeat(43)});await tick();output=render(b);
 expect(text(output)).not.toContain(locale==='en'?'Saving and checking the stored result':'שומר ובודק את התוצאה השמורה');expect(text(output)).not.toContain(locale==='en'?'Saved and verified.':'נשמר ואומת.');
 expect(find(output,e=>e.type==='textarea')!.props.disabled).toBe(false);expect(find(output,e=>e.type==='textarea')!.props.value).toBe('');
 output=await ready(a);expect(find(output,e=>e.type==='textarea')!.props.value).toBe('DEMO A private unsaved body');expect(find(output,e=>e.type==='textarea')!.props.disabled).toBe(false);
 (find(output,e=>e.type==='form')!.props.onSubmit as Submit)({preventDefault(){}});await tick();if(phase==='post')expect(postBodies()[1]).toEqual(original);else expect(postBodies()).toHaveLength(1);
 resolve(Response.json({ok:false},{status:400}));await tick();
});

it("reads parent feedback history from Messages without a composer version", async () => {
  accountRead.mockResolvedValue([{ id: caseA, displayName: "Synthetic A", kind: "minor" }]);
  fetchMock.mockImplementation(async (url: string) => Response.json({ ok: true, data: url.startsWith('/api/identity/audiences') ? [{ id: audienceA, visibility: 'family_full' }] : [] }));
  const props = { locale: 'en' as const, role: 'parent' as const, initialCaseId: caseA };
  for (let index = 0; index < 5; index++) { render(props); hook.flushEffects(); await tick(); }
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/updates?') && String(url).includes(audienceA))).toBe(true);
  expect(find(render(props), element => element.type === 'form')).toBeUndefined();
});

it.each(['en','he'] as const)('never substitutes another audience for an unavailable explicit route (%s)',async locale=>{
 accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO A',kind:'minor'}]);
 fetchMock.mockImplementation(async(url:string)=>url.startsWith('/api/identity/audiences')&&new URL(url,'https://synthetic.invalid').searchParams.has('audienceId')?Response.json({ok:false},{status:404}):authorizedRead(url));
 const output=await ready({locale,role:'parent',initialCaseId:caseA,initialAudienceId:audienceB,initialPracticeVersionId:'version-b'});
 expect(fetchMock.mock.calls.some(([url])=>String(url).startsWith('/api/updates?'))).toBe(false);expect(find(output,e=>e.type==='form')).toBeUndefined();
 expect(text(output)).toContain(locale==='en'?'The requested shared practice context is unavailable.':'הקשר התרגול המשותף שהתבקש אינו זמין.');
});

it.each(['en','he'] as const)('an audience route change uses the new exact participant context, never the retained selection (%s)',async locale=>{
 accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO A',kind:'minor'}]);fetchMock.mockImplementation(async(url:string)=>Response.json({ok:true,data:url.startsWith('/api/identity/audiences')?[{id:audienceA,visibility:'family_full'},{id:audienceB,visibility:'family_full'}]:[]}));
 const a={locale,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'},b={...a,initialAudienceId:audienceB,initialPracticeVersionId:'version-b'};
 await ready(a);fetchMock.mockClear();const immediate=render(b);expect(find(immediate,e=>e.type==='form')).toBeUndefined();
 await ready(b);const reads=fetchMock.mock.calls.filter(([url])=>String(url).startsWith('/api/updates?'));expect(reads.length).toBeGreaterThan(0);
 expect(reads.every(([url])=>new URL(String(url),'https://synthetic.invalid').searchParams.get('audienceId')===audienceB)).toBe(true);
});

it.each(['en','he'] as const)('pages retained shared contexts, pins an exact older route, and preserves scoped draft through retry (%s)',async locale=>{
 accountRead.mockResolvedValue([{id:caseA,displayName:'DEMO A',kind:'minor'}]);
 const page=Array.from({length:100},(_,i)=>({id:`80000000-0000-4000-8000-${String(i).padStart(12,'0')}`,visibility:'family_full'})),cursor=page.at(-1)!.id;let fail=true;
 fetchMock.mockImplementation(async(url:string)=>{
  if(!url.startsWith('/api/identity/audiences'))return Response.json({ok:true,data:[]});const q=new URL(url,'https://synthetic.invalid').searchParams;
  if(q.has('audienceId'))return Response.json({ok:true,data:{id:audienceA,visibility:'family_full',published:true}});
  if(q.has('beforeAudienceId'))return fail?Response.json({ok:false},{status:503}):Response.json({ok:true,data:[{id:audienceB,visibility:'family_full',published:true}]});
  return Response.json({ok:true,data:page});
 });
 const props={locale,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'};
 let output=await ready(props);expect(find(output,e=>e.type==='select'&&e.props.id==='update-audience')!.props.value).toBe(audienceA);
 (find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Add feedback':'הוספת משוב'))!.props.onClick as Click)();output=render(props);
 (find(output,e=>e.type==='textarea')!.props.onChange as Change)({target:{value:'DEMO scoped page draft'}});output=render(props);
 (find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Older shared contexts':'הקשרים משותפים קודמים'))!.props.onClick as Click)();output=await ready(props);
 expect(text(output)).toContain(locale==='en'?'Shared practice contexts could not be loaded.':'לא ניתן לטעון את הקשרי התרגול המשותף.');
 expect(fetchMock.mock.calls.some(([url])=>new URL(String(url),'https://synthetic.invalid').searchParams.get('beforeAudienceId')===cursor)).toBe(true);
 fail=false;(find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Retry shared contexts':'ניסיון טעינת ההקשרים המשותפים מחדש'))!.props.onClick as Click)();output=await ready(props);
 expect(find(output,e=>e.type==='select'&&e.props.id==='update-audience')!.props.value).toBe(audienceA);expect(find(output,e=>e.type==='textarea')!.props.value).toBe('DEMO scoped page draft');
 (find(output,e=>e.type==='button'&&e.props.children===(locale==='en'?'Latest shared contexts':'הקשרים משותפים אחרונים'))!.props.onClick as Click)();output=await ready(props);
 expect(find(output,e=>e.type==='textarea')!.props.value).toBe('DEMO scoped page draft');expect(postBodies()).toHaveLength(0);
});

it("shows a genuine failed case read and a working retry instead of false empty context", async () => {
  accountRead.mockRejectedValueOnce(new Error('UNAVAILABLE')).mockResolvedValue([{ id: caseA, displayName: 'Synthetic A', kind: 'minor' }]);
  fetchMock.mockResolvedValue(Response.json({ ok: true, data: [] }));
  const props = { locale: 'en' as const, role: 'parent' as const };
  render(props); hook.flushEffects(); await tick(); let output = render(props);
  const alert = find(output, element => element.props.role === 'alert');
  expect(text(alert)).toContain('Authorized contexts could not be loaded.');
  const retry = find(output, element => element.type === 'button' && element.props.children === 'Retry contexts');
  expect(retry).toBeDefined(); (retry?.props.onClick as Click)();
  for (let index = 0; index < 4; index++) { output = render(props); hook.flushEffects(); await tick(); }
  expect(text(render(props))).toContain('Synthetic A'); expect(accountRead).toHaveBeenCalledTimes(2);
});

it('retains cancelled composer text without leaking it into another case', async () => {
  accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'},{id:caseB,displayName:'Synthetic B',kind:'minor'}]);
  fetchMock.mockImplementation(async (url:string)=>authorizedRead(url));
  const props={locale:'en' as const,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'};
  let output=await ready(props);(find(output,e=>e.type==='button'&&e.props.children==='Add feedback')?.props.onClick as Click)();output=render(props);
  (find(output,e=>e.type==='textarea'&&e.props.id==='update-body')?.props.onChange as Change)({target:{value:'DEMO unsaved private text'}});output=render(props);
  (find(output,e=>e.type==='button'&&e.props.children==='Cancel')?.props.onClick as Click)();output=render(props);expect(find(output,e=>e.type==='textarea')).toBeUndefined();
  (find(output,e=>e.type==='button'&&e.props.children==='Add feedback')?.props.onClick as Click)();output=render(props);expect(find(output,e=>e.type==='textarea')?.props.value).toBe('DEMO unsaved private text');
  (find(output,e=>e.type==='select'&&e.props.id==='update-case')?.props.onChange as Change)({target:{value:caseB}});output=await ready(props);expect(find(output,e=>e.type==='form')).toBeUndefined();expect(JSON.stringify(output)).not.toContain('DEMO unsaved private text');
  (find(output,e=>e.type==='select'&&e.props.id==='update-case')?.props.onChange as Change)({target:{value:caseA}});output=await ready(props);(find(output,e=>e.type==='button'&&e.props.children==='Add feedback')?.props.onClick as Click)();output=render(props);expect(find(output,e=>e.type==='textarea')?.props.value).toBe('DEMO unsaved private text');
});

it('does not substitute a different family for an unavailable requested case',async()=>{
  accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'}]);fetchMock.mockImplementation(async(url:string)=>authorizedRead(url));
  const output=await ready({locale:'he',role:'parent',initialCaseId:caseB});expect(text(output)).toContain('ההקשר שהתבקש אינו זמין');expect(fetchMock).not.toHaveBeenCalled();expect(find(output,e=>e.type==='form')).toBeUndefined();
});

it('locks an unknown500 save and replays exactly the frozen body and key',async()=>{
  accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'}]);fetchMock.mockImplementation(async(url:string,init?:RequestInit)=>init?.method==='POST'?new Response('',{status:500}):authorizedRead(url));
  const props={locale:'en' as const,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'};let output=await ready(props);
  (find(output,e=>e.type==='button'&&e.props.children==='Add feedback')?.props.onClick as Click)();output=render(props);(find(output,e=>e.type==='textarea')?.props.onChange as Change)({target:{value:'DEMO exact lost action'}});output=render(props);
  (find(output,e=>e.type==='form')?.props.onSubmit as Submit)({preventDefault(){}});await tick();output=render(props);expect(text(output)).not.toContain('Saved and verified.');expect(find(output,e=>e.type==='textarea')?.props.disabled).toBe(true);expect(find(output,e=>e.type==='textarea')?.props.value).toBe('DEMO exact lost action');
  (find(output,e=>e.type==='button'&&e.props.children==='Retry this exact action')?.props.onClick as Click)();await tick();output=render(props);expect(postBodies()).toHaveLength(2);expect(postBodies()[1]).toEqual(postBodies()[0]);expect(find(output,e=>e.type==='textarea')?.props.disabled).toBe(true);
});

it('does not offer the old practice composer while another audience is selected',async()=>{
  accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'}]);fetchMock.mockImplementation(async(url:string)=>Response.json({ok:true,data:url.startsWith('/api/identity/audiences')?[{id:audienceA,visibility:'family_full'},{id:audienceB,visibility:'family_full'}]:[]}));
  const props={locale:'en' as const,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'};let output=await ready(props);(find(output,e=>e.type==='button'&&e.props.children==='Add feedback')?.props.onClick as Click)();output=render(props);expect(find(output,e=>e.type==='form')).toBeDefined();
  (find(output,e=>e.type==='select'&&e.props.id==='update-audience')?.props.onChange as Change)({target:{value:audienceB}});output=await ready(props);expect(find(output,e=>e.type==='form')).toBeUndefined();expect(find(output,e=>e.type==='button'&&e.props.children==='Add feedback')).toBeUndefined();
});

it('follows a changed case deep link without a stale first render from the previous family',async()=>{
  accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'},{id:caseB,displayName:'Synthetic B',kind:'minor'}]);fetchMock.mockImplementation(async(url:string)=>authorizedRead(url));await ready({locale:'en',role:'parent',initialCaseId:caseA});
  const output=render({locale:'en',role:'parent',initialCaseId:caseB});expect(find(output,e=>e.type==='select'&&e.props.id==='update-case')?.props.value).toBe(caseB);expect(find(output,e=>e.type==='form')).toBeUndefined();expect(text(output)).not.toContain('No feedback has been shared');
});

it('removes private composer text after an actual404 response instead of retaining a stale authorized view',async()=>{
  accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'}]);fetchMock.mockImplementation(async(url:string,init?:RequestInit)=>init?.method==='POST'?Response.json({ok:false,error:{code:'NOT_FOUND'}},{status:404}):authorizedRead(url));
  const props={locale:'en' as const,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'};let output=await ready(props);(find(output,e=>e.type==='button'&&e.props.children==='Add feedback')?.props.onClick as Click)();output=render(props);(find(output,e=>e.type==='textarea')?.props.onChange as Change)({target:{value:'DEMO revoked private draft'}});output=render(props);
  (find(output,e=>e.type==='form')?.props.onSubmit as Submit)({preventDefault(){}});await tick();output=render(props);expect(find(output,e=>e.type==='textarea')).toBeUndefined();expect(JSON.stringify(output)).not.toContain('DEMO revoked private draft');expect(text(output)).not.toContain('Saved and verified.');expect(text(output)).toContain('Authorized contexts could not be loaded.');
});

it('exposes a retry for a genuine audience failure without opening a composer from query strings',async()=>{
  accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'}]);let failed=true;fetchMock.mockImplementation(async(url:string)=>url.startsWith('/api/identity/audiences')&&failed?new Response('',{status:500}):authorizedRead(url));
  const props={locale:'en' as const,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'};let output=await ready(props);expect(text(output)).toContain('Shared practice contexts could not be loaded.');expect(find(output,e=>e.type==='form')).toBeUndefined();expect(find(output,e=>e.type==='button'&&e.props.children==='Add feedback')).toBeUndefined();
  failed=false;(find(output,e=>e.type==='button'&&e.props.children==='Retry shared contexts')?.props.onClick as Click)();output=await ready(props);expect(find(output,e=>e.type==='button'&&e.props.children==='Add feedback')).toBeDefined();
});

it.each([401,403,404])('clears private unsaved input on an actual denied%d feedback read, including a malformed denial body',async code=>{
 accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'}]);let denied=false;
 fetchMock.mockImplementation(async(url:string)=>url.startsWith('/api/updates?')?new Response('',{status:denied?code:500}):authorizedRead(url));
 const props={locale:'en' as const,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'};let output=await ready(props);
 (find(output,e=>e.type==='button'&&e.props.children==='Add feedback')?.props.onClick as Click)();output=render(props);(find(output,e=>e.type==='textarea')?.props.onChange as Change)({target:{value:'DEMO revoked read private draft'}});output=render(props);expect(find(output,e=>e.type==='textarea')?.props.value).toBe('DEMO revoked read private draft');
 denied=true;(find(output,e=>e.type==='button'&&e.props.children==='Retry feedback read')?.props.onClick as Click)();output=await ready(props);
 expect(find(output,e=>e.type==='textarea')).toBeUndefined();expect(JSON.stringify(output)).not.toContain('DEMO revoked read private draft');expect(text(output)).toContain('Authorized contexts could not be loaded.');expect(postBodies()).toHaveLength(0);
});

it.each([401,403,404])('clears private input after an actual denied%d write even when its denial body is malformed',async code=>{
 accountRead.mockResolvedValue([{id:caseA,displayName:'Synthetic A',kind:'minor'}]);fetchMock.mockImplementation(async(url:string,init?:RequestInit)=>init?.method==='POST'?new Response('',{status:code}):authorizedRead(url));
 const props={locale:'en' as const,role:'parent' as const,initialCaseId:caseA,initialAudienceId:audienceA,initialPracticeVersionId:'version-a'};let output=await ready(props);
 (find(output,e=>e.type==='button'&&e.props.children==='Add feedback')?.props.onClick as Click)();output=render(props);(find(output,e=>e.type==='textarea')?.props.onChange as Change)({target:{value:'DEMO denied write private draft'}});output=render(props);
 (find(output,e=>e.type==='form')?.props.onSubmit as Submit)({preventDefault(){}});await tick();output=render(props);
 expect(find(output,e=>e.type==='textarea')).toBeUndefined();expect(JSON.stringify(output)).not.toContain('DEMO denied write private draft');expect(find(output,e=>e.type==='button'&&e.props.children==='Retry this exact action')).toBeUndefined();expect(text(output)).toContain('Private information has been cleared.');expect(postBodies()).toHaveLength(1);
});
