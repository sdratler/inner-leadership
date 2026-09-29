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
  for (const path of ['app/calendar', 'app/practice', 'app/feedback', 'app/forms', 'app/reports']) {
   expect(markup.match(new RegExp(`href="/${locale}/${path}\\?caseId=${id}&amp;context=client"`, 'g'))?.length ?? 0).toBe(1);
  }
  expect(markup).not.toContain(`href="/${locale}/app/resources`);
  expect(markup).toContain(`lang="${locale}"`); expect(markup).toContain(`dir="${locale === 'he' ? 'rtl' : 'ltr'}"`);
 });
}
for(const locale of ['en','he'] as const)it(`${locale}: session header, sidebar and breadcrumbs keep demo Calendar and report context`,()=>{
 navigation.pathname=`/${locale}/app/cases/${id}/sessions/223e4567-e89b-42d3-a456-426614174000`;
 navigation.query=new URLSearchParams({mode:'demo',date:'2026-09-22',view:'day'});
 const html=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic session'}));
 const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1]!.replaceAll('&amp;','&'),'https://private.invalid'));
 for(const path of ['app/calendar','app/reports',`app/cases/${id}/sessions`]){
  const links=hrefs.filter(url=>url.pathname===`/${locale}/${path}`);expect(links.length).toBeGreaterThan(0);
  for(const url of links){expect(url.searchParams.get('mode')).toBe('demo');expect(url.searchParams.get('date')).toBe('2026-09-22');expect(url.searchParams.get('view')).toBe('day');expect(url.searchParams.get('caseId')).toBe(id);}
 }
 expect(html).toContain(locale==='he'?'רשומת מפגש':'Session record');
});
