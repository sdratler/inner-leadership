import { NextRequest } from 'next/server';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { loginReturnDestination, practitionerDetailReturnPath } from '../../src/features/identity/login-return.ts';
import { activeItem, breadcrumbItems, primaryNavigation, practitionerContext } from '../../src/ui/workspace/navigation-model.ts';
import { proxy } from '../../src/proxy.ts';
import { WorkspaceShell } from '../../src/ui/workspace/workspace-shell.tsx';

const origin = 'https://life-skills.bneineviimacademy.org';
const groupId = '123e4567-e89b-42d3-a456-426614174000';
const returned = 'x-middleware-request-x-ls-practitioner-return';
afterEach(() => vi.unstubAllEnvs());

it.each(['en', 'he'] as const)('%s group revision survives ordinary owner login without caller authority', locale => {
  const path = `/${locale}/app/fishing-groups`;
  const next = practitionerDetailReturnPath(locale, path, { groupId: groupId.toUpperCase(), revision: '2147483647', role: 'practitioner', secret: 'private', mode: 'demo' });
  expect(next).toBe(`${path}?groupId=${groupId}&revision=2147483647`);
  expect(loginReturnDestination(locale, 'practitioner', next)).toBe(next);
  for (const role of ['parent', 'child', 'adult_client'] as const) expect(loginReturnDestination(locale, role, next)).not.toBe(next);
  for (const other of [path + '/unknown', `/${locale === 'en' ? 'he' : 'en'}/app/fishing-groups`, `//untrusted.invalid${path}`]) {
    expect(practitionerDetailReturnPath(locale, other, { groupId })).toBe(`/${locale}/app/calendar`);
  }
});

it.each(['en', 'he'] as const)('%s rejects ambiguous references and unsafe revisions without losing a valid group', locale => {
  const path = `/${locale}/app/fishing-groups`;
  for (const id of ['constructor', '../private', groupId + '\n', [groupId, groupId]]) {
    expect(practitionerDetailReturnPath(locale, path, { groupId: id, revision: '2' })).toBe(path);
  }
  for (const revision of ['0', '01', '-1', '1.5', '2147483648', '9007199254740993', '2\n', ['2', '2']]) {
    expect(practitionerDetailReturnPath(locale, path, { groupId, revision })).toBe(`${path}?groupId=${groupId}`);
  }
  expect(practitionerDetailReturnPath(locale, path, { revision: '2' })).toBe(path);
});

it.each(['en', 'he'] as const)('%s actual proxy reconstructs group return and strips forged or duplicate hints', locale => {
  for (const [name, value] of Object.entries({ NODE_ENV: 'production', LS_APP_MODE: 'foundation_locked', LS_APP_ORIGIN: origin, LS_PRIVATE_APP_ENABLED: 'true' })) vi.stubEnv(name, value);
  const path = `/${locale}/app/fishing-groups`;
  const request = (query: string, target = path) => proxy(new NextRequest(origin + target + query, { headers: { 'x-ls-practitioner-return': 'https://untrusted.invalid/private' } }));
  expect(request(`?groupId=${groupId}&revision=2&role=practitioner&mode=demo&secret=private`).headers.get(returned)).toBe(`${path}?groupId=${groupId}&revision=2`);
  expect(request(`?groupId=${groupId}&groupId=${groupId}&revision=2`).headers.get(returned)).toBe(path);
  expect(request(`?groupId=${groupId}&revision=2&revision=2`).headers.get(returned)).toBe(`${path}?groupId=${groupId}`);
  expect(request('?revision=2').headers.get(returned)).toBe(path);
  expect(request('', path + '/unknown').headers.get(returned)).toBeNull();
  vi.stubEnv('LS_PRIVATE_APP_ENABLED', 'false');
  const disabled = request(`?groupId=${groupId}`);
  expect(disabled.status).toBe(503);
  expect(disabled.headers.get('x-middleware-next')).toBeNull();
});

it.each(['en', 'he'] as const)('%s group workspace is reachable in People without adding a parent or student destination', locale => {
  const path = `/${locale}/app/fishing-groups`;
  expect(activeItem(path, locale, 'practitioner')?.key).toBe('clients');
  for (const source of [path, `/${locale}/app/clients`, `/${locale}/app/group-applications`]) {
    const links = practitionerContext(source, null);
    expect(links.filter(item => item.path === 'app/fishing-groups')).toHaveLength(1);
    expect(links.some(item => item.path === 'app/group-applications')).toBe(true);
  }
  expect(breadcrumbItems(locale, 'practitioner', path).map(item => item.label)).toEqual(locale === 'he' ? ['בית', 'אנשים', 'קבוצות דיג'] : ['Home', 'People', 'Fishing groups']);
  for (const role of ['parent', 'client'] as const) {
    expect(primaryNavigation[role].some(item => item.path === 'app/fishing-groups')).toBe(false);
    expect(activeItem(path, locale, role)).toBeUndefined();
  }
});

it.each(['en', 'he'] as const)('%s rendered owner shell highlights the actual group destination', locale => {
  const pathname = `/${locale}/app/fishing-groups`;
  const html = renderToStaticMarkup(createElement(WorkspaceShell, {
    locale, role: 'practitioner', pathname, languageHref: pathname.replace(`/${locale}/`, locale === 'en' ? '/he/' : '/en/'),
  } as ComponentProps<typeof WorkspaceShell>, 'Synthetic group workspace'));
  const strip = html.match(/<nav class="lsu-top-tabs"[^>]*>(.*?)<\/nav>/)?.[1];
  expect(strip).toContain(`<a href="/${locale}/app/fishing-groups" aria-current="page">`);
  expect(strip?.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain(`href="/${locale}/app/group-applications"`);
  for (const role of ['parent', 'client'] as const) {
    const privateShell = renderToStaticMarkup(createElement(WorkspaceShell, {
      locale, role, pathname: `/${locale}/${role === 'parent' ? 'family/schedule' : 'client'}`, languageHref: '/',
    } as ComponentProps<typeof WorkspaceShell>, 'Synthetic role content'));
    expect(privateShell).not.toContain(`/app/fishing-groups`);
  }
});
