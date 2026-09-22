import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '', query: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname, useSearchParams: () => navigation.query }));
import { CoreNavigation } from '../../../src/ui/workspace/core-navigation.tsx';

const id = '123e4567-e89b-12d3-a456-426614174000';
for (const locale of ['en', 'he'] as const) {
 it(`${locale}: case-route context reaches each practitioner destination in desktop and mobile navigation`, () => {
  navigation.pathname = `/${locale}/app/cases/${id}`; navigation.query = new URLSearchParams();
  const markup = renderToStaticMarkup(CoreNavigation({ locale, role: 'practitioner', children: 'Synthetic case' }));
  for (const path of ['app/calendar', 'app/practice', 'app/feedback', 'app/forms', 'app/resources', 'app/reports', 'app/payments']) {
   expect(markup.match(new RegExp(`href="/${locale}/${path}\\?caseId=${id}"`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2);
  }
  expect(markup).toContain(`lang="${locale}"`); expect(markup).toContain(`dir="${locale === 'he' ? 'rtl' : 'ltr'}"`);
 });
}
