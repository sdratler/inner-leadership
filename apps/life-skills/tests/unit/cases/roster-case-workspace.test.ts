import type { ReactElement } from 'react';
import { expect, it, vi, beforeEach } from 'vitest';

type Slot =
 | { kind: 'state'; value: unknown }
 | { kind: 'ref'; value: { current: unknown } }
 | { kind: 'effect'; deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined }
 | { kind: 'callback'; deps: readonly unknown[]; value: unknown };

const hook = vi.hoisted(() => {
 const slots: Slot[] = [];
 const pending: Array<{ index: number; effect: () => void | (() => void) }> = [];
 let cursor = 0, mounted = true, afterUnmountUpdates = 0;
 const accountRead = vi.fn(), peopleRead = vi.fn();
 const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
 return {
  accountRead, peopleRead,
  reset() { slots.length = 0; pending.length = 0; cursor = 0; mounted = true; afterUnmountUpdates = 0; accountRead.mockReset(); peopleRead.mockReset(); },
  render<T>(view: () => T): T { cursor = 0; return view(); },
  flushEffects() { for (const next of pending.splice(0)) { const slot = slots[next.index]; if (slot?.kind === 'effect') { slot.cleanup?.(); slot.cleanup = next.effect() || undefined; } } },
  unmount() { mounted = false; for (const slot of slots) if (slot.kind === 'effect') slot.cleanup?.(); },
  afterUnmountUpdates: () => afterUnmountUpdates,
  useState<T>(initial: T | (() => T)) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: 'state', value: typeof initial === 'function' ? (initial as () => T)() : initial }; slots[index] = slot; } if (slot.kind !== 'state') throw new Error('HOOK_ORDER'); return [slot.value as T, (value: T | ((current: T) => T)) => { if (!mounted) { afterUnmountUpdates++; return; } slot.value = typeof value === 'function' ? (value as (current: T) => T)(slot.value as T) : value; }] as const; },
  useRef<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: 'ref', value: { current: initial } }; slots[index] = slot; } if (slot.kind !== 'ref') throw new Error('HOOK_ORDER'); return slot.value as { current: T }; },
  useMemo<T>(factory: () => T) { cursor++; return factory(); },
  useCallback<T>(callback:T,deps:readonly unknown[]){const index=cursor++,slot=slots[index];if(!slot||slot.kind==='callback'&&changed(slot.deps,deps)){slots[index]={kind:'callback',deps,value:callback};return callback;}if(slot.kind!=='callback')throw Error('HOOK_ORDER');return slot.value as T;},
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) { const index = cursor++; const slot = slots[index]; if (!slot) { slots[index] = { kind: 'effect', deps, cleanup: undefined }; pending.push({ index, effect }); return; } if (slot.kind !== 'effect') throw new Error('HOOK_ORDER'); if (changed(slot.deps, deps)) { slot.deps = deps; pending.push({ index, effect }); } },
 };
});

vi.mock('react', async importOriginal => {
 const actual = await importOriginal<typeof import('react')>();
 return { ...actual, useState: hook.useState, useRef: hook.useRef, useMemo: hook.useMemo, useCallback:hook.useCallback, useEffect: hook.useEffect };
});
vi.mock('../../../src/features/identity/client.ts', async importOriginal => ({ ...(await importOriginal<typeof import('../../../src/features/identity/client.ts')>()), accountRead: hook.accountRead }));
vi.mock('../../../src/features/contact-ops/native-people-workspace.tsx',async importOriginal=>({...await importOriginal<typeof import('../../../src/features/contact-ops/native-people-workspace.tsx')>(),requestPeople:hook.peopleRead}));

import { CaseWorkspace } from '../../../src/features/cases/case-workspace.tsx';
import { ClientsRoster,LegacyClientsRoster } from '../../../src/features/cases/clients-roster.tsx';
import {NativePeopleWorkspace,PeopleRequestError} from '../../../src/features/contact-ops/native-people-workspace.tsx';
import { ProspectsClient } from '../../../src/features/prospects/client.tsx';
import { IdentityClientError } from '../../../src/features/identity/client.ts';

const caseA = { id: '123e4567-e89b-12d3-a456-426614174000', kind: 'minor' as const, state: 'active', displayName: 'Synthetic case A', mode: 'live' as const };
const caseB = { id: '223e4567-e89b-12d3-a456-426614174000', kind: 'minor' as const, state: 'active', displayName: 'Synthetic case B', mode: 'live' as const };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function text(node: unknown): string {
 if (node === null || node === undefined || typeof node === 'boolean') return '';
 if (typeof node === 'string' || typeof node === 'number') return String(node);
 if (Array.isArray(node)) return node.map(text).join('');
 const element = node as ReactElement<{ children?: unknown }>;
 return text(element.props?.children);
}
function find(node: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
 if (!node || typeof node !== 'object') return undefined;
 if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } return undefined; }
 const element = node as ReactElement<Record<string, unknown>>;
 if (predicate(element)) return element;
 return find(element.props?.children, predicate);
}

beforeEach(() => hook.reset());

it.each(['all', 'active', 'archived'])('keeps %s live cases separate from DEMO using provenance, not a name prefix', async section => {
 const state = section === 'archived' ? 'archived' : 'active';
 const live = {...caseA, state, displayName: 'DEMO is part of this real name'};
 const demo = {...caseB, state, displayName: 'Synthetic exercise record', mode: 'demo' as const};
 hook.accountRead.mockResolvedValue([live, demo]);
 const view = () => hook.render(() => LegacyClientsRoster({locale: 'en', section}));
 view(); hook.flushEffects(); await tick();
 const directory = find(view(), element => element.type === ProspectsClient);
 expect(directory?.props.caseState).toBe('ready');
 expect(directory?.props.clientCases).toEqual([live]);
 expect(hook.accountRead).toHaveBeenCalledExactlyOnceWith('cases','live');
});

it.each([undefined, 'unknown', null])('treats an unavailable case provenance %s as an error, not an empty/live directory', async mode => {
 hook.accountRead.mockResolvedValue([{...caseA, mode}]);
 const view = () => hook.render(() => LegacyClientsRoster({locale: 'he'}));
 view(); hook.flushEffects(); await tick();
 const directory = find(view(), element => element.type === ProspectsClient);
 expect(directory?.props.caseState).toBe('error');
 expect(directory?.props.clientCases).toEqual([]);
});

it('retries an invalid provenance read without resurrecting cached case rows', async () => {
 hook.accountRead.mockResolvedValueOnce([caseA]).mockResolvedValueOnce([{...caseA, mode: undefined}]).mockResolvedValueOnce([caseA]);
 const view = () => hook.render(() => LegacyClientsRoster({locale: 'en'}));
 view(); hook.flushEffects(); await tick();
 let directory = find(view(), element => element.type === ProspectsClient);
 expect(directory?.props.clientCases).toEqual([caseA]);
 (directory!.props.onRetryCases as () => void)(); await tick();
 directory = find(view(), element => element.type === ProspectsClient);
 expect(directory?.props.caseState).toBe('error'); expect(directory?.props.clientCases).toEqual([]);
 (directory!.props.onRetryCases as () => void)();
 directory = find(view(), element => element.type === ProspectsClient);
 expect(directory?.props.caseState).toBe('loading'); expect(directory?.props.clientCases).toEqual([]);
 await tick(); expect(find(view(), element => element.type === ProspectsClient)?.props.clientCases).toEqual([caseA]);
});

it('does not let a late A response replace the selected B case', async () => {
 let resolveA!: (rows: typeof caseA[]) => void, resolveB!: (rows: typeof caseB[]) => void;
 const pendingA = new Promise<typeof caseA[]>(resolve => { resolveA = resolve; });
 const pendingB = new Promise<typeof caseB[]>(resolve => { resolveB = resolve; });
 hook.accountRead.mockReturnValueOnce(pendingA).mockReturnValueOnce(pendingB);
 hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseA.id })); hook.flushEffects(); await tick();
 hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseB.id })); hook.flushEffects(); await tick();
 resolveB([caseB]); await tick();
 let output = hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseB.id }));
 expect(text(output)).toContain('Synthetic case B'); expect(text(output)).not.toContain('Synthetic case A');
 resolveA([caseA]); await tick();
 output = hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseB.id }));
 expect(text(output)).toContain('Synthetic case B'); expect(text(output)).not.toContain('Synthetic case A');
});

it('shows loading while the current selected case is unresolved', async () => {
 let resolve!: (rows: typeof caseA[]) => void;
 hook.accountRead.mockReturnValueOnce(new Promise<typeof caseA[]>(done => { resolve = done; }));
 hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseA.id })); hook.flushEffects(); await tick();
 expect(text(hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseA.id })))).toContain('Loading case…');
 resolve([caseA]); await tick();
 expect(text(hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseA.id })))).toContain('Synthetic case A');
});

it('clears the previous case before rendering a newly selected unresolved case', async () => {
 let resolveA!: (rows: typeof caseA[]) => void, resolveB!: (rows: typeof caseB[]) => void;
 hook.accountRead.mockReturnValueOnce(new Promise<typeof caseA[]>(done => { resolveA = done; })).mockReturnValueOnce(new Promise<typeof caseB[]>(done => { resolveB = done; }));
 hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseA.id })); hook.flushEffects(); await tick(); resolveA([caseA]); await tick();
 expect(text(hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseA.id })))).toContain('Synthetic case A');
 const switched = hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseB.id }));
 expect(text(switched)).toContain('Loading case…'); expect(text(switched)).not.toContain('Synthetic case A');
 resolveB([caseB]);
});

it('guards a late request after unmount/logout', async () => {
 let resolve!: (rows: typeof caseA[]) => void;
 hook.accountRead.mockReturnValueOnce(new Promise<typeof caseA[]>(done => { resolve = done; }));
 hook.render(() => CaseWorkspace({ locale: 'en', caseId: caseA.id })); hook.flushEffects(); await tick();
 hook.unmount(); resolve([caseA]); await tick();
 expect(hook.afterUnmountUpdates()).toBe(0);
});

it('offers an actionable retry after a roster error and reloads synthetic cases', async () => {
 hook.accountRead.mockRejectedValueOnce(new Error('synthetic offline')).mockResolvedValueOnce([caseA]);
 hook.render(() => LegacyClientsRoster({ locale: 'en' })); hook.flushEffects(); await tick();
 let output = hook.render(() => LegacyClientsRoster({ locale: 'en' }));
 const directory = find(output, element => element.type === ProspectsClient);
 expect(directory?.props.caseState).toBe('error');
 expect(directory?.props.onRetryCases).toBeTypeOf('function');
 (directory!.props.onRetryCases as () => void)(); await tick();
 output = hook.render(() => LegacyClientsRoster({ locale: 'en' }));
 const recovered = find(output, element => element.type === ProspectsClient);
 expect(recovered?.props.caseState).toBe('ready');
 expect(recovered?.props.clientCases).toEqual([caseA]);
});

it('distinguishes an expired case-directory session from a CRM outage and preserves the selected People URL', async () => {
 hook.accountRead.mockRejectedValueOnce(new IdentityClientError('UNAUTHENTICATED'));
 hook.render(() => LegacyClientsRoster({ locale: 'he', section: 'prospects', prospectFilter: 'today' })); hook.flushEffects(); await tick();
 const output = hook.render(() => LegacyClientsRoster({ locale: 'he', section: 'prospects', prospectFilter: 'today' }));
 const directory = find(output, element => element.type === ProspectsClient);
 expect(directory?.props.caseState).toBe(null); // The prospects-only view does not read the case directory.
 hook.render(() => LegacyClientsRoster({ locale: 'he', section: 'all', prospectFilter: 'today' })); hook.flushEffects(); await tick();
 const active = hook.render(() => LegacyClientsRoster({ locale: 'he', section: 'all', prospectFilter: 'today' }));
 const cases = find(active, element => element.type === ProspectsClient);
 expect(cases?.props.caseState).toBe('auth');
 expect(cases?.props.returnPath).toBe('/he/app/clients?section=all&filter=today');
});

it('keeps the active case-only view free of CRM filters and add-prospect controls', () => {
 const output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, showProspects: false, clientCases: [caseA], caseState: 'ready' }));
 expect(text(output)).toContain('Synthetic case A');
 expect(text(output)).toContain('Search clients');
 expect(text(output)).not.toContain('Add prospect');
 expect(text(output)).not.toContain('New inquiries');
});

it('hides stale private rows and contact actions when either People source denies access', () => {
 const output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: [caseA], caseState: 'auth' }));
 expect(text(output)).not.toContain('Synthetic case A');
 expect(text(output)).not.toContain('Add prospect');
 expect(text(output)).toContain('Your session has ended');
});

it('offers same-locale sign-in instead of a false CRM outage when the private lead API rejects the session', async () => {
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ ok: false, error: { code: 'UNAUTHENTICATED' } }) }));
 try {
  hook.render(() => ProspectsClient({ locale: 'he', embedded: true, caseState: 'ready', returnPath: '/he/app/clients?section=prospects&filter=today' }));
  hook.flushEffects(); await tick();
  await vi.waitFor(() => expect(text(hook.render(() => ProspectsClient({ locale: 'he', embedded: true, caseState: 'ready', returnPath: '/he/app/clients?section=prospects&filter=today' })))).toContain('פג תוקף החיבור'));
  const output = hook.render(() => ProspectsClient({ locale: 'he', embedded: true, caseState: 'ready', returnPath: '/he/app/clients?section=prospects&filter=today' }));
  expect(text(output)).toContain('פג תוקף החיבור');
  expect(text(output)).not.toContain('לא ניתן לטעון את ה-CRM');
  const signIn = find(output, element => typeof element.props.href === 'string' && String(element.props.href).includes('/he/login?next='));
  expect(signIn?.props.href).toBe('/he/login?next=%2Fhe%2Fapp%2Fclients%3Fsection%3Dprospects%26filter%3Dtoday');
 } finally { vi.unstubAllGlobals(); }
});

it('shows one searchable People list without hiding a linked child case or duplicating status tabs', async () => {
 const lead = { leadId: 'synthetic-lead', caseId: caseA.id, name: 'Synthetic parent', phone: '0500000000', stage: 'New inquiry', language: 'he', receivedAt: '2026-09-25T08:00:00Z', dueDate: '', formSent: '', formSubmitted: '', paymentVerified: false, bookingStatus: '', outcome: '', journeyState: '' };
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: [lead], pendingOperations: [], pendingNext: null }) }));
 try {
  hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: [caseA], caseState: 'ready' }));
  hook.flushEffects(); await tick();
  const output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: [caseA], caseState: 'ready' }));
  expect(text(output)).toContain('Synthetic parent');
  expect(text(output)).toContain('Synthetic case A');
  expect(find(output, element => element.props.className === 'lsu-people-results')).toBeDefined();
  expect(find(output, element => element.props.role === 'tablist')).toBeUndefined();
 } finally { vi.unstubAllGlobals(); }
});

it('keeps an orphaned pending send discoverable on a later ledger page without offering a resend', async () => {
 const cursor='00000000-0000-4000-8000-000000000001';
 const orphan={leadId:'LS-LEAD-synthetic-missing',operationId:'00000000-0000-4000-8000-000000000002',
  state:'sent_pending',message:'Synthetic message',createdAt:'2026-09-29T00:00:00Z'};
 const fetch=vi.fn().mockImplementation(async (url:string)=>({ok:true,status:200,json:async()=>({ok:true,data:[],
  pendingOperations:url.includes('pendingAfter=')?[orphan]:[],pendingNext:url.includes('pendingAfter=')?null:cursor})}));
 vi.stubGlobal('fetch',fetch);
 try{
  const view=()=>hook.render(()=>ProspectsClient({locale:'en',embedded:true,caseState:'ready'}));
  view();hook.flushEffects();await tick();
  await vi.waitFor(()=>expect(text(view())).toContain('Load more pending send attempts'));
  expect(text(view())).not.toContain(orphan.leadId);
  const more=find(view(),element=>element.type==='button'&&element.props.children==='Load more pending send attempts');
  (more!.props.onClick as()=>void)();
  await vi.waitFor(()=>expect(text(view())).toContain(orphan.leadId));
  expect(text(view())).toContain('Restore the exact source record and lead ID');
  expect(text(view())).toContain('Verify restored lead and update CRM (no resend)');
  expect(fetch).toHaveBeenCalledWith(`/api/prospects?pendingAfter=${cursor}`,expect.anything());
 }finally{vi.unstubAllGlobals();}
});

it('paginates cases and prospects together without repeating cases on the next page', async () => {
 const cases = Array.from({ length: 13 }, (_, index) => ({ id: `synthetic-case-${index + 1}`, kind: 'minor' as const, state: 'active', displayName: `Synthetic case ${String(index + 1).padStart(2, '0')}` }));
 const lead = { leadId: 'LS-LEAD-synthetic', caseId: '', name: 'ZZ prospect', phone: '0500000000', stage: 'New inquiry', language: 'he', receivedAt: '2026-09-25T08:00:00Z', dueDate: '', formSent: '', formSubmitted: '', paymentVerified: false, bookingStatus: '', outcome: '', journeyState: '' };
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: [lead], pendingOperations: [], pendingNext: null }) }));
 try {
  hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: cases, caseState: 'ready' }));
  hook.flushEffects(); await tick();
  let output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: cases, caseState: 'ready' }));
  let results = find(output, element => element.props.className === 'lsu-people-results');
  expect(text(results)).toContain('Synthetic case 01');
  expect(text(results)).not.toContain('Synthetic case 13');
  expect(text(results)).not.toContain('ZZ prospect');
  const pagination = find(output, element => element.type === 'nav' && element.props['aria-label'] === 'Page');
  const next = find(pagination, element => element.type === 'button' && element.props.children === 'Next');
  expect(next?.props.disabled).toBe(false);
  (next!.props.onClick as () => void)();
  output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: cases, caseState: 'ready' }));
  results = find(output, element => element.props.className === 'lsu-people-results');
  expect(text(results)).not.toContain('Synthetic case 01');
  expect(text(results)).toContain('Synthetic case 13');
  expect(text(results)).toContain('ZZ prospect');
 } finally { vi.unstubAllGlobals(); }
});

it('navigates from the visible page when the combined result shrinks', () => {
 const cases = Array.from({ length: 25 }, (_, index) => ({ id: `synthetic-case-${index + 1}`, kind: 'minor' as const, state: 'active', displayName: `Synthetic case ${String(index + 1).padStart(2, '0')}` }));
 const view = (rows: typeof cases) => hook.render(() => ProspectsClient({ locale: 'en', embedded: true, showProspects: false, clientCases: rows, caseState: 'ready' }));
 for (let step = 0; step < 2; step++) {
  const next = find(find(view(cases), element => element.type === 'nav' && element.props['aria-label'] === 'Page'), element => element.type === 'button' && element.props.children === 'Next');
  (next!.props.onClick as () => void)();
 }
 let output = view(cases.slice(0, 13));
 let pagination = find(output, element => element.type === 'nav' && element.props['aria-label'] === 'Page');
 expect(text(pagination)).toContain('Page 2 / 2');
 const previous = find(pagination, element => element.type === 'button' && element.props.children === 'Previous');
 (previous!.props.onClick as () => void)();
 output = view(cases.slice(0, 13));
 pagination = find(output, element => element.type === 'nav' && element.props['aria-label'] === 'Page');
 expect(text(pagination)).toContain('Page 1 / 2');
 expect(text(find(output, element => element.props.className === 'lsu-people-results'))).toContain('Synthetic case 01');
});

it('keeps ready cases reachable while the CRM request is still loading', async () => {
 const cases = Array.from({ length: 13 }, (_, index) => ({ id: `synthetic-case-${index + 1}`, kind: 'minor' as const, state: 'active', displayName: `Synthetic case ${String(index + 1).padStart(2, '0')}` }));
 vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
 try {
  hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: cases, caseState: 'ready' }));
  hook.flushEffects(); await tick();
  let output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: cases, caseState: 'ready' }));
  expect(text(output)).toContain('Loading the private CRM');
  const next = find(find(output, element => element.type === 'nav' && element.props['aria-label'] === 'Page'), element => element.type === 'button' && element.props.children === 'Next');
  expect(next?.props.disabled).toBe(false);
  (next!.props.onClick as () => void)();
  output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, clientCases: cases, caseState: 'ready' }));
  expect(text(find(output, element => element.props.className === 'lsu-people-results'))).toContain('Synthetic case 13');
 } finally { vi.unstubAllGlobals(); }
});

it('keeps ready prospects reachable while client cases are still loading', async () => {
 const leads = Array.from({ length: 13 }, (_, index) => ({ leadId: `LS-LEAD-synthetic-${index + 1}`, caseId: '', name: `Synthetic lead ${String(index + 1).padStart(2, '0')}`, phone: '0500000000', stage: 'New inquiry', language: 'he', receivedAt: '2026-09-25T08:00:00Z', dueDate: '', formSent: '', formSubmitted: '', paymentVerified: false, bookingStatus: '', outcome: '', journeyState: '' }));
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: leads, pendingOperations: [], pendingNext: null }) }));
 try {
  hook.render(() => ProspectsClient({ locale: 'en', embedded: true, caseState: 'loading' }));
  hook.flushEffects(); await tick();
  await vi.waitFor(() => expect(text(hook.render(() => ProspectsClient({ locale: 'en', embedded: true, caseState: 'loading' })))).toContain('Synthetic lead 01'));
  let output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, caseState: 'loading' }));
  const next = find(find(output, element => element.type === 'nav' && element.props['aria-label'] === 'Page'), element => element.type === 'button' && element.props.children === 'Next');
  expect(next?.props.disabled).toBe(false);
  (next!.props.onClick as () => void)();
  output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, caseState: 'loading' }));
  expect(text(find(output, element => element.props.className === 'lsu-people-results'))).toContain('Synthetic lead 13');
 } finally { vi.unstubAllGlobals(); }
});

it('opens the selected prospect from a calendar deep link even when it belongs on a later People page', async () => {
 const leads = Array.from({ length: 13 }, (_, index) => ({ leadId: `LS-LEAD-synthetic-${index + 1}`, caseId: '', name: `Synthetic lead ${String(index + 1).padStart(2, '0')}`, phone: '0500000000', stage: 'New inquiry', language: 'he', receivedAt: '2026-09-25T08:00:00Z', dueDate: '', formSent: '', formSubmitted: '', paymentVerified: false, bookingStatus: '', outcome: '', journeyState: '' }));
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: leads, pendingOperations: [], pendingNext: null }) }));
 try {
  const render = () => hook.render(() => ProspectsClient({ locale: 'en', embedded: true, caseState: null, focusLeadId: 'LS-LEAD-synthetic-13' }));
  render(); hook.flushEffects(); await tick();
  render(); hook.flushEffects();
  const output = render();
  const selected = find(output, element => element.type === 'details' && element.props['data-focused'] === true);
  expect(selected?.props.open).toBe(true);
  expect(text(selected)).toContain('Synthetic lead 13');
  expect(text(output)).toContain('Page 2 / 2');
 } finally { vi.unstubAllGlobals(); }
});

it('does not call unavailable private data an empty People directory', async () => {
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ ok: false, error: { code: 'UNAVAILABLE' } }) }));
 try {
  hook.render(() => ProspectsClient({ locale: 'en', embedded: true, caseState: 'error' }));
  hook.flushEffects(); await tick();
  await vi.waitFor(() => expect(text(hook.render(() => ProspectsClient({ locale: 'en', embedded: true, caseState: 'error' })))).toContain('The CRM could not be loaded'));
  const output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, caseState: 'error' }));
  expect(text(output)).toContain('The CRM could not be loaded');
  expect(text(output)).not.toContain('No prospects match these filters');
 } finally { vi.unstubAllGlobals(); }
});

it('renders exactly the durable Sheet directory, without reading native shadows',async()=>{
 hook.peopleRead.mockResolvedValue({source:'sheet',authorityEpoch:1});
 const view=()=>hook.render(()=>ClientsRoster({locale:'en',section:'prospects'}));view();hook.flushEffects();await tick();
 const output=view();expect(output.type).toBe(LegacyClientsRoster);
 expect(find(output,e=>e.type===NativePeopleWorkspace)).toBeUndefined();
 expect(hook.peopleRead).toHaveBeenCalledWith(new URLSearchParams({view:'prospects'}));
 expect(hook.accountRead).not.toHaveBeenCalled();
});
it('renders one native directory only after the server selects the actual native authority',async()=>{
 const data={source:'native',authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}};
 hook.peopleRead.mockResolvedValue(data);
 const view=()=>hook.render(()=>ClientsRoster({locale:'he',section:'active'}));view();hook.flushEffects();await tick();
 const output=view(),native=find(output,e=>e.type===NativePeopleWorkspace);
 expect(native?.props.initial).toBe(data);expect(native?.props.view).toBe('active');
 expect(find(output,e=>e.type===LegacyClientsRoster||e.type===ProspectsClient)).toBeUndefined();
 expect(hook.accountRead).not.toHaveBeenCalled();
});
it.each([401,403,409,503])('source failure %i never initializes Sheet or calls a directory empty',async status=>{
 hook.peopleRead.mockRejectedValue(new PeopleRequestError(status));
 const view=()=>hook.render(()=>ClientsRoster({locale:'en'}));view();hook.flushEffects();await tick();
 const output=view();expect(find(output,e=>e.type===LegacyClientsRoster||e.type===NativePeopleWorkspace||e.type===ProspectsClient)).toBeUndefined();
 expect(find(output,e=>e.props.role==='alert')).toBeDefined();expect(text(output)).not.toContain('No people match');
 expect(hook.accountRead).not.toHaveBeenCalled();
});
it('ignores a late previous-section source response and all source responses after unmount',async()=>{
 let first!:(r:unknown)=>void,second!:(r:unknown)=>void;
 hook.peopleRead.mockReturnValueOnce(new Promise(resolve=>{first=resolve;})).mockReturnValueOnce(new Promise(resolve=>{second=resolve;}));
 hook.render(()=>ClientsRoster({locale:'en',section:'all'}));hook.flushEffects();await tick();
 hook.render(()=>ClientsRoster({locale:'en',section:'active'}));hook.flushEffects();await tick();
 second({source:'native',authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}});await tick();
 first({source:'sheet',authorityEpoch:0});await tick();
 expect(find(hook.render(()=>ClientsRoster({locale:'en',section:'active'})),e=>e.type===NativePeopleWorkspace)).toBeDefined();
 hook.reset();let late!:(r:unknown)=>void;hook.peopleRead.mockReturnValue(new Promise(resolve=>{late=resolve;}));
 hook.render(()=>ClientsRoster({locale:'en'}));hook.flushEffects();await tick();hook.unmount();late({source:'sheet',authorityEpoch:0});await tick();
 expect(hook.afterUnmountUpdates()).toBe(0);
});
it('preserves validated selected-person and DEMO context on mid-page session expiry',async()=>{
 const personId='00000000-0000-4000-8000-000000000001';hook.peopleRead.mockRejectedValue(new PeopleRequestError(401));
 const view=()=>hook.render(()=>ClientsRoster({locale:'he',section:'active',prospectFilter:'today',focusLeadId:'LS-LEAD-synthetic',personId,mode:'demo'}));
 view();hook.flushEffects();await tick();
 const signIn=find(view(),e=>e.type==='a'&&String(e.props.href).startsWith('/he/login?next='));
 expect(signIn?.props.href).toBe('/he/login?next='+encodeURIComponent(`/he/app/clients?section=active&filter=today&leadId=LS-LEAD-synthetic&personId=${personId}&mode=demo`));
 const invalid=hook.render(()=>ClientsRoster({locale:'he',personId:'../../escape',mode:'practitioner'}));
 expect(find(invalid,e=>e.type==='a')?.props.href).toBe('/he/login?next=%2Fhe%2Fapp%2Fclients');
});
it('binds the first native response to validated DEMO/person context, before rendering any rows',async()=>{
 const personId='00000000-0000-4000-8000-000000000001';
 const data={source:'native',authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}};
 hook.peopleRead.mockResolvedValue(data);
 const view=()=>hook.render(()=>ClientsRoster({locale:'en',section:'paid',personId,mode:'demo'}));
 view();hook.flushEffects();await tick();
 expect(hook.peopleRead).toHaveBeenCalledWith(new URLSearchParams({view:'all',mode:'demo',personId}));
 const native=find(view(),e=>e.type===NativePeopleWorkspace);
 expect(native?.props.initialMode).toBe('demo');expect(native?.props.initialPersonId).toBe(personId);
});
it('never renders live Sheet records under an explicit DEMO context',async()=>{
 hook.peopleRead.mockResolvedValue({source:'sheet',authorityEpoch:1});
 const view=()=>hook.render(()=>ClientsRoster({locale:'en',mode:'demo'}));view();hook.flushEffects();await tick();
 expect(find(view(),e=>e.type===LegacyClientsRoster||e.type===ProspectsClient)).toBeUndefined();
 expect(text(view())).toContain('No live records are shown in DEMO');
});
it('accepts a verified live Sheet response after returning from an initially DEMO native view',async()=>{
 const data={source:'native',authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}};
 hook.peopleRead.mockResolvedValue(data);
 const view=()=>hook.render(()=>ClientsRoster({locale:'en',mode:'demo'}));view();hook.flushEffects();await tick();
 const native=find(view(),e=>e.type===NativePeopleWorkspace);
 (native!.props.onSheet as(response:{source:'sheet';authorityEpoch:number},context:{mode:'live';filter:'all'})=>void)({source:'sheet',authorityEpoch:4},{mode:'live',filter:'all'});
 expect(view().type).toBe(LegacyClientsRoster);
 expect(text(view())).not.toContain('No live records are shown in DEMO');
});
it('binds the Sheet fallback callback to the live request after leaving DEMO',async()=>{
 let location=new URL('https://synthetic.invalid/en/app/clients?mode=demo');
 vi.stubGlobal('window',{get location(){return location;},history:{pushState(_state:unknown,_unused:string,url:URL){location=new URL(url);}},addEventListener(){},removeEventListener(){}});
 const sheet={source:'sheet' as const,authorityEpoch:4};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({ok:true,data:sheet})}));
 const initial={source:'native' as const,authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}},onSheet=vi.fn();
 const view=()=>hook.render(()=>NativePeopleWorkspace({locale:'en',view:'all',initial,initialMode:'demo',onSheet}));
 try{
  (find(view(),e=>e.type==='button'&&e.props.children==='Return to live app')!.props.onClick as()=>void)();
  await tick();await tick();expect(location.search).toBe('');
  expect(onSheet).toHaveBeenCalledExactlyOnceWith(sheet,{mode:'live',filter:'all',personId:undefined,leadId:undefined});
 }finally{vi.unstubAllGlobals();}
});

it('uses accepted workflow and person context after a native-to-Sheet rollback instead of original props',async()=>{
 hook.peopleRead.mockResolvedValue({source:'native',authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}});
 const view=()=>hook.render(()=>ClientsRoster({locale:'en',section:'prospects',prospectFilter:'today',focusLeadId:'LS-LEAD-synthetic-old'}));view();hook.flushEffects();await tick();
 const native=find(view(),e=>e.type===NativePeopleWorkspace),accept=native!.props.onSheet as(response:{source:'sheet';authorityEpoch:number},context:{mode:'live';filter:'all';personId?:string;leadId?:string})=>void;
 accept({source:'sheet',authorityEpoch:4},{mode:'live',filter:'all'});
 expect(view().type).toBe(LegacyClientsRoster);expect(view().props.prospectFilter).toBe('all');expect(view().props.focusLeadId).toBeUndefined();
 accept({source:'sheet',authorityEpoch:4},{mode:'live',filter:'all',leadId:'LS-LEAD-synthetic-current'});
 expect(view().props.focusLeadId).toBe('LS-LEAD-synthetic-current');
 accept({source:'sheet',authorityEpoch:4},{mode:'live',filter:'all',personId:'00000000-0000-4000-8000-000000000001'});
 expect(view().type).not.toBe(LegacyClientsRoster);expect(text(view())).toContain('No unrelated records are shown.');
});

it('carries the cleared workflow preset in the actual Sheet fallback request',async()=>{
 let location=new URL('https://synthetic.invalid/en/app/clients?filter=today');
 vi.stubGlobal('window',{get location(){return location;},history:{pushState(_state:unknown,_unused:string,url:URL){location=new URL(url);}},addEventListener(){},removeEventListener(){}});
 const sheet={source:'sheet' as const,authorityEpoch:4},onSheet=vi.fn(),initial={source:'native' as const,authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({ok:true,data:sheet})}));
 try{
  const view=()=>hook.render(()=>NativePeopleWorkspace({locale:'en',view:'prospects',initial,initialFilter:'today',onSheet}));
  (find(view(),e=>e.type==='button'&&e.props.children==='Clear workflow filter')!.props.onClick as()=>void)();await tick();await tick();
  expect(location.search).toBe('');expect(onSheet).toHaveBeenCalledExactlyOnceWith(sheet,{mode:'live',filter:'all',personId:undefined,leadId:undefined});
 }finally{vi.unstubAllGlobals();}
});
it('resolves a Calendar lead deep link through the native API before rendering its person',async()=>{
 const personId='00000000-0000-4000-8000-000000000001',leadId='LS-LEAD-synthetic-follow-up';
 const data={source:'native',authorityEpoch:3,page:{items:[{personId}],total:1,page:1,pageSize:12,pages:1}};
 hook.peopleRead.mockResolvedValue(data);
 const view=()=>hook.render(()=>ClientsRoster({locale:'en',section:'prospects',focusLeadId:leadId}));view();hook.flushEffects();await tick();
 expect(hook.peopleRead).toHaveBeenCalledWith(new URLSearchParams({view:'all',leadId}));
 const native=find(view(),e=>e.type===NativePeopleWorkspace);
 expect(native?.props.initialLeadId).toBe(leadId);expect(native?.props.initialPersonId).toBe(personId);
});
it.each(['today','new','intake','payment','booking','archived'] as const)('preserves the validated legacy %s workflow before the native list renders',async filter=>{
 const data={source:'native',authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}};hook.peopleRead.mockResolvedValue(data);
 const view=()=>hook.render(()=>ClientsRoster({locale:'en',section:'prospects',prospectFilter:filter}));view();hook.flushEffects();await tick();
 expect(hook.peopleRead).toHaveBeenCalledWith(new URLSearchParams({view:'prospects',filter}));
 expect(find(view(),e=>e.type===NativePeopleWorkspace)?.props.initialFilter).toBe(filter);
});
it('does not allow a workflow filter to hide the selected Calendar person',async()=>{
 hook.peopleRead.mockResolvedValue({source:'native',authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}});
 const view=()=>hook.render(()=>ClientsRoster({locale:'he',section:'prospects',prospectFilter:'today',focusLeadId:'LS-LEAD-synthetic'}));view();hook.flushEffects();await tick();
 expect(hook.peopleRead).toHaveBeenCalledWith(new URLSearchParams({view:'all',leadId:'LS-LEAD-synthetic'}));
});
it('keeps URL workflow context on reload and Back and clears it explicitly without unrelated filters',async()=>{
 let location=new URL('https://synthetic.invalid/en/app/clients?section=prospects&filter=today'),popstate:(()=>void)|undefined;
 vi.stubGlobal('window',{get location(){return location;},history:{pushState(_state:unknown,_unused:string,url:URL){location=new URL(url);}},addEventListener(event:string,listener:()=>void){if(event==='popstate')popstate=listener;},removeEventListener(){}});
 const initial={source:'native' as const,authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}};
 const fetch=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({ok:true,data:initial})});vi.stubGlobal('fetch',fetch);
 const view=()=>hook.render(()=>NativePeopleWorkspace({locale:'en',view:'prospects',initial,initialFilter:'today',onSheet:()=>{}}));
 try{
  view();hook.flushEffects();await tick();await tick();
  expect(new URL(String(fetch.mock.calls[0]![0]),'https://synthetic.invalid').searchParams.get('filter')).toBe('today');
  expect(text(view())).toContain('Due today');
  (find(view(),e=>e.type==='button'&&e.props.children==='Clear workflow filter')!.props.onClick as()=>void)();await tick();await tick();
  expect(location.search).toBe('?section=prospects');expect(text(view())).not.toContain('Clear workflow filter');
  expect(new URL(String(fetch.mock.calls.at(-1)![0]),'https://synthetic.invalid').searchParams.has('filter')).toBe(false);
  location=new URL('https://synthetic.invalid/en/app/clients?section=prospects&filter=today');popstate!();await tick();await tick();
  expect(new URL(String(fetch.mock.calls.at(-1)![0]),'https://synthetic.invalid').searchParams.get('filter')).toBe('today');
 }finally{vi.unstubAllGlobals();}
});
it('keeps an unresolved native lead in an explicit person context instead of an unrelated first page',async()=>{
 hook.peopleRead.mockResolvedValue({source:'native',authorityEpoch:3,page:{items:[],total:0,page:1,pageSize:12,pages:1}});
 const view=()=>hook.render(()=>ClientsRoster({locale:'he',focusLeadId:'LS-LEAD-synthetic-missing'}));view();hook.flushEffects();await tick();
 const native=find(view(),e=>e.type===NativePeopleWorkspace);
 expect(native?.props.initialLeadId).toBe('LS-LEAD-synthetic-missing');expect(native?.props.initialPersonId).toBeUndefined();
});
it.each([409,503])('clears live rows on DEMO transition failure %i and retries DEMO, not live',async status=>{
 let location=new URL('https://synthetic.invalid/en/app/clients');
 vi.stubGlobal('window',{get location(){return location;},history:{pushState(_state:unknown,_unused:string,url:URL){location=new URL(url);}},addEventListener(){},removeEventListener(){}});
 const fetch=vi.fn().mockResolvedValue({ok:false,status,json:async()=>({ok:false})});vi.stubGlobal('fetch',fetch);
 const row={personId:'00000000-0000-4000-8000-000000000001',displayName:'Synthetic live record',identityKind:'adult' as const,stage:'New inquiry',nextAction:null,followUpDate:null,notes:'',version:1,mode:'live' as const,archived:false,doNotContact:false,references:[]};
 const initial={source:'native' as const,authorityEpoch:3,page:{items:[row],total:1,page:1,pageSize:12,pages:1}},onSheet=vi.fn();
 const view=()=>hook.render(()=>NativePeopleWorkspace({locale:'en',view:'all',initial,onSheet}));
 try{
  expect(text(view())).toContain(row.displayName);
  (find(view(),e=>e.type==='button'&&e.props.children==='DEMO records')!.props.onClick as()=>void)();
  expect(location.search).toBe('?mode=demo');expect(text(view())).not.toContain(row.displayName);
  await tick();await tick();expect(text(view())).not.toContain(row.displayName);
  (find(view(),e=>e.type==='button'&&e.props.children==='Retry')!.props.onClick as()=>void)();
  await tick();await tick();expect(fetch).toHaveBeenCalledTimes(2);
  for(const [url] of fetch.mock.calls)expect(new URL(String(url),'https://synthetic.invalid').searchParams.get('mode')).toBe('demo');
  expect(text(view())).not.toContain(row.displayName);expect(onSheet).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});
