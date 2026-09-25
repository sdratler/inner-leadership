import type { ReactElement } from 'react';
import { expect, it, vi, beforeEach } from 'vitest';

type Slot =
 | { kind: 'state'; value: unknown }
 | { kind: 'ref'; value: { current: unknown } }
 | { kind: 'effect'; deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined };

const hook = vi.hoisted(() => {
 const slots: Slot[] = [];
 const pending: Array<{ index: number; effect: () => void | (() => void) }> = [];
 let cursor = 0, mounted = true, afterUnmountUpdates = 0;
 const accountRead = vi.fn();
 const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
 return {
  accountRead,
  reset() { slots.length = 0; pending.length = 0; cursor = 0; mounted = true; afterUnmountUpdates = 0; accountRead.mockReset(); },
  render<T>(view: () => T): T { cursor = 0; return view(); },
  flushEffects() { for (const next of pending.splice(0)) { const slot = slots[next.index]; if (slot?.kind === 'effect') { slot.cleanup?.(); slot.cleanup = next.effect() || undefined; } } },
  unmount() { mounted = false; for (const slot of slots) if (slot.kind === 'effect') slot.cleanup?.(); },
  afterUnmountUpdates: () => afterUnmountUpdates,
  useState<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: 'state', value: initial }; slots[index] = slot; } if (slot.kind !== 'state') throw new Error('HOOK_ORDER'); return [slot.value as T, (value: T) => { if (!mounted) { afterUnmountUpdates++; return; } slot.value = value; }] as const; },
  useRef<T>(initial: T) { const index = cursor++; let slot = slots[index]; if (!slot) { slot = { kind: 'ref', value: { current: initial } }; slots[index] = slot; } if (slot.kind !== 'ref') throw new Error('HOOK_ORDER'); return slot.value as { current: T }; },
  useMemo<T>(factory: () => T) { cursor++; return factory(); },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) { const index = cursor++; const slot = slots[index]; if (!slot) { slots[index] = { kind: 'effect', deps, cleanup: undefined }; pending.push({ index, effect }); return; } if (slot.kind !== 'effect') throw new Error('HOOK_ORDER'); if (changed(slot.deps, deps)) { slot.deps = deps; pending.push({ index, effect }); } },
 };
});

vi.mock('react', async importOriginal => {
 const actual = await importOriginal<typeof import('react')>();
 return { ...actual, useState: hook.useState, useRef: hook.useRef, useMemo: hook.useMemo, useEffect: hook.useEffect };
});
vi.mock('../../../src/features/identity/client.ts', () => ({ accountRead: hook.accountRead }));

import { CaseWorkspace } from '../../../src/features/cases/case-workspace.tsx';
import { ClientsRoster } from '../../../src/features/cases/clients-roster.tsx';
import { ProspectsClient } from '../../../src/features/prospects/client.tsx';

const caseA = { id: '123e4567-e89b-12d3-a456-426614174000', kind: 'minor' as const, state: 'active', displayName: 'Synthetic case A' };
const caseB = { id: '223e4567-e89b-12d3-a456-426614174000', kind: 'minor' as const, state: 'active', displayName: 'Synthetic case B' };
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
 hook.render(() => ClientsRoster({ locale: 'en' })); hook.flushEffects(); await tick();
 let output = hook.render(() => ClientsRoster({ locale: 'en' }));
 const directory = find(output, element => element.type === ProspectsClient);
 expect(directory?.props.caseState).toBe('error');
 expect(directory?.props.onRetryCases).toBeTypeOf('function');
 (directory!.props.onRetryCases as () => void)(); await tick();
 output = hook.render(() => ClientsRoster({ locale: 'en' }));
 const recovered = find(output, element => element.type === ProspectsClient);
 expect(recovered?.props.caseState).toBe('ready');
 expect(recovered?.props.clientCases).toEqual([caseA]);
});

it('keeps the active case-only view free of CRM filters and add-prospect controls', () => {
 const output = hook.render(() => ProspectsClient({ locale: 'en', embedded: true, showProspects: false, clientCases: [caseA], caseState: 'ready' }));
 expect(text(output)).toContain('Synthetic case A');
 expect(text(output)).toContain('Search clients');
 expect(text(output)).not.toContain('Add prospect');
 expect(text(output)).not.toContain('New inquiries');
});
