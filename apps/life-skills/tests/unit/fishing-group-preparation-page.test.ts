import { beforeEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('PAGE_NOT_FOUND'); },
  redirect: (url: string) => { throw new Error('REDIRECT:' + url); },
}));
vi.mock('../../src/features/integration/page-session.ts', () => ({ requireWorkspaceRole: calls.session }));
vi.mock('../../src/features/fishing-billing/group-preparation-workspace.tsx', () => ({ FishingGroupPreparationWorkspace: () => null }));
import Page from '../../src/app/[locale]/app/fishing-groups/page.tsx';
import { FishingGroupPreparationWorkspace } from '../../src/features/fishing-billing/group-preparation-workspace.tsx';
import { AppError } from '../../src/lib/errors.ts';

const groupId = '123e4567-e89b-42d3-a456-426614174000';
beforeEach(() => { calls.session.mockReset().mockResolvedValue({ role: 'practitioner' }); });

it.each(['en', 'he'] as const)('%s real page requires a fresh practitioner session before returning the workspace', async locale => {
  const page = await Page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ groupId: groupId.toUpperCase(), revision: '2', role: 'practitioner', secret: 'private' }) });
  expect(calls.session).toHaveBeenCalledExactlyOnceWith('practitioner');
  expect(page.type).toBe(FishingGroupPreparationWorkspace);
  expect(page.props).toEqual({ locale, initialGroupId: groupId, initialRevision: 2 });
});

it.each(['en', 'he'] as const)('%s expired session returns only sanitized group context to ordinary login', async locale => {
  calls.session.mockRejectedValueOnce(new AppError('UNAUTHENTICATED'));
  const next = `/${locale}/app/fishing-groups?groupId=${groupId}&revision=2`;
  await expect(Page({ params: Promise.resolve({ locale }), searchParams: Promise.resolve({ groupId, revision: '2', role: 'practitioner', secret: 'private', next: 'https://untrusted.invalid' }) }))
    .rejects.toThrow(`REDIRECT:/${locale}/login?next=${encodeURIComponent(next)}`);
});

it.each(['FORBIDDEN', 'NOT_FOUND'] as const)('the actual page denies %s instead of rendering a workspace', async code => {
  calls.session.mockRejectedValueOnce(new AppError(code));
  await expect(Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ groupId }) })).rejects.toThrow('PAGE_NOT_FOUND');
});

it('an identity outage remains an outage, never sign-out or an empty workspace', async () => {
  const error = new AppError('UNAVAILABLE');
  calls.session.mockRejectedValueOnce(error);
  await expect(Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) })).rejects.toBe(error);
});

it('rejects an unknown locale before session work and removes repeated record hints', async () => {
  await expect(Page({ params: Promise.resolve({ locale: 'xx' }), searchParams: Promise.resolve({ groupId }) })).rejects.toThrow('PAGE_NOT_FOUND');
  expect(calls.session).not.toHaveBeenCalled();
  const page = await Page({ params: Promise.resolve({ locale: 'he' }), searchParams: Promise.resolve({ groupId: [groupId, groupId], revision: '2' }) });
  expect(page.props).toEqual({ locale: 'he' });
});
