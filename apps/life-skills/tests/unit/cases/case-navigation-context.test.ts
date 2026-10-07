import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '', query: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname, useSearchParams: () => navigation.query }));
import { CoreNavigation } from '../../../src/ui/workspace/core-navigation.tsx';
import { workspaceHref } from '../../../src/ui/workspace/navigation-model.ts';

const id = '123e4567-e89b-12d3-a456-426614174000';
const audienceId='223e4567-e89b-42d3-a456-426614174000';
for(const locale of ['en','he'] as const)for(const communityView of ['opportunities','sources','budget','writing_rules'])it(`${locale}: Community ${communityView} replaces the toolbar with four contextual views and preserves language/deep links`,()=>{
 navigation.pathname=`/${locale}/app/marketing`;navigation.query=new URLSearchParams({section:'community',communityView});
 const html=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic Community'})),toolbar=html.match(/<nav class="lsu-top-tabs"[^>]*>(.*?)<\/nav>/)?.[1]??'';
 const links=[...toolbar.matchAll(/<a[^>]+href="([^"]+)"([^>]*)>(.*?)<\/a>/g)];expect(links).toHaveLength(4);expect(links.filter(link=>link[2]!.includes('aria-current="page"'))).toHaveLength(1);
 for(const [i,key] of ['opportunities','sources','budget','writing_rules'].entries()){
  const link=links[i]!,url=new URL(link[1]!.replaceAll('&amp;','&'),'https://private.invalid');expect(url.pathname).toBe(`/${locale}/app/marketing`);expect(url.searchParams.get('section')).toBe('community');expect(url.searchParams.get('communityView')).toBe(key);expect(url.hash).toBe('');expect(link[2]!.includes('aria-current="page"')).toBe(key===communityView);
 }
 expect(html).toContain(`/${locale==='he'?'en':'he'}/app/marketing?section=community&amp;communityView=${communityView}`);expect(toolbar).not.toContain('section=ads');
 const breadcrumbs=html.match(/<nav class="lsu-breadcrumbs"[^>]*>(.*?)<\/nav>/)?.[1]??'';expect(breadcrumbs).toContain(locale==='he'?'קהילה':'Community');expect(breadcrumbs).toContain('section=community');
});
it('audience hints stay scoped to valid case practice/report links, never global destinations',()=>{
 for(const path of ['app/practice','app/reports'])expect(new URL(workspaceHref('en',path,id,{},audienceId),'https://private.invalid').searchParams.get('audienceId')).toBe(audienceId);
 for(const path of ['app/calendar','app/clients','app/marketing','app/payments','app/settings'])expect(new URL(workspaceHref('en',path,id,{},audienceId),'https://private.invalid').searchParams.has('audienceId')).toBe(false);
 for(const [caseHint,audienceHint] of [[id,'invalid'],['invalid',audienceId],[null,audienceId]])expect(new URL(workspaceHref('he','app/practice',caseHint,{},audienceHint),'https://private.invalid').searchParams.has('audienceId')).toBe(false);
});
for(const locale of ['en','he'] as const)for(const section of ['practice','goals','commitments','checkins'])it(`${locale}: practice ${section} uses one contextual toolbar, preserving authorized case and audience hints`,()=>{
 navigation.pathname=`/${locale}/app/practice`;navigation.query=new URLSearchParams({caseId:id,audienceId,context:'client',...(section==='practice'?{}:{section})});
 const html=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic practice'}));
 const toolbar=html.match(/<nav class="lsu-top-tabs"[^>]*>(.*?)<\/nav>/)?.[1]??'';
 const links=[...toolbar.matchAll(/<a[^>]+href="([^"]+)"([^>]*)>(.*?)<\/a>/g)];
 expect(links).toHaveLength(4);expect(links.filter(link=>link[2]!.includes('aria-current="page"'))).toHaveLength(1);
 for(const [i,key] of ['practice','goals','commitments','checkins'].entries()){
  const link=links[i]!;const url=new URL(link[1]!.replaceAll('&amp;','&'),'https://private.invalid');
  expect(url.pathname).toBe(`/${locale}/app/practice`);expect(url.hash).toBe('');
  expect(url.searchParams.get('caseId')).toBe(id);expect(url.searchParams.get('audienceId')).toBe(audienceId);expect(url.searchParams.get('context')).toBe('client');
  expect(url.searchParams.get('section')).toBe(key==='practice'?null:key);
  expect(link[2]!.includes('aria-current="page"')).toBe(key===section);
 }
 expect(toolbar).not.toContain(locale==='he'?'הגדרות':'Settings');
 const label=({en:{practice:'Instructions',goals:'Goals',commitments:'Commitments',checkins:'Check-ins'},he:{practice:'הנחיות',goals:'מטרות',commitments:'מחויבויות',checkins:'דיווחים'}} as const)[locale][section as 'practice'|'goals'|'commitments'|'checkins'];
 expect(html.match(/<nav class="lsu-breadcrumbs"[^>]*>(.*?)<\/nav>/)?.[1]).toContain(label);
 const breadcrumbs=html.match(/<nav class="lsu-breadcrumbs"[^>]*>(.*?)<\/nav>/)?.[1]??'';
 for(const link of [...breadcrumbs.matchAll(/href="([^"]+)"/g)]){
  const url=new URL(link[1]!.replaceAll('&amp;','&'),'https://private.invalid');
  if(url.pathname===`/${locale}/app/practice`){expect(url.searchParams.get('caseId')).toBe(id);expect(url.searchParams.get('audienceId')).toBe(audienceId);}
 }
});
for (const locale of ['en', 'he'] as const) {
 it(`${locale}: case-route context reaches each practitioner destination in desktop and mobile navigation`, () => {
  navigation.pathname = `/${locale}/app/cases/${id}`; navigation.query = new URLSearchParams();
  const markup = renderToStaticMarkup(CoreNavigation({ locale, role: 'practitioner', children: 'Synthetic case' }));
  for (const path of ['app/calendar', 'app/practice', 'app/feedback', 'app/forms', 'app/resources', 'app/reports']) {
   expect(markup.match(new RegExp(`href="/${locale}/${path}\\?caseId=${id}&amp;context=client"`, 'g'))?.length ?? 0).toBe(1);
  }
  expect(markup).toContain(locale==='he'?'חומרים ותרגילים':'Materials &amp; exercises');
  expect(markup).toContain(`lang="${locale}"`); expect(markup).toContain(`dir="${locale === 'he' ? 'rtl' : 'ltr'}"`);
 });
}
for(const locale of ['en','he'] as const)it(`${locale}: session header, sidebar and breadcrumbs keep demo Calendar and report context`,()=>{
 navigation.pathname=`/${locale}/app/cases/${id}/sessions/223e4567-e89b-42d3-a456-426614174000`;
 navigation.query=new URLSearchParams({mode:'demo',date:'2026-09-22',view:'day',context:'client'});
 const html=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic session'}));
 const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1]!.replaceAll('&amp;','&'),'https://private.invalid'));
 for(const path of ['app/calendar','app/reports',`app/cases/${id}/sessions`]){
  const links=hrefs.filter(url=>url.pathname===`/${locale}/${path}`);expect(links.length).toBeGreaterThan(0);
  for(const url of links){expect(url.searchParams.get('mode')).toBe('demo');expect(url.searchParams.get('date')).toBe('2026-09-22');expect(url.searchParams.get('view')).toBe('day');expect(url.searchParams.get('caseId')).toBe(id);expect(url.searchParams.get('context')).toBe('client');}
 }
 expect(html).toContain(locale==='he'?'רשומת מפגש':'Session record');
});
for(const locale of ['en','he'] as const)for(const page of ['forms','resources','reports'])it(`${locale}: adult ${page} has one scoped shared-items strip and no child form shortcuts`,()=>{
 navigation.pathname=`/${locale}/client/${page}`;navigation.query=new URLSearchParams({caseId:id});
 const html=renderToStaticMarkup(CoreNavigation({locale,role:'client',clientRole:'adult_client',children:'Synthetic shared items'}));
 const toolbar=html.match(/<nav class="lsu-top-tabs"[^>]*>(.*?)<\/nav>/)?.[1]??'';
 const links=[...toolbar.matchAll(/<a[^>]+href="([^"]+)"([^>]*)>(.*?)<\/a>/g)];expect(links).toHaveLength(3);
 expect(links.filter(link=>link[2]!.includes('aria-current="page"'))).toHaveLength(1);
 expect(toolbar).not.toContain('/client/calendar');expect(toolbar).toContain(`/${locale}/client/forms?caseId=${id}`);expect(toolbar).toContain(`/${locale}/client/resources?caseId=${id}`);
 const child=renderToStaticMarkup(CoreNavigation({locale,role:'client',clientRole:'child',children:'Synthetic child'}));expect(child).not.toContain(`href="/${locale}/client/forms`);expect(child).not.toContain(`href="/${locale}/client/resources`);
 expect(toolbar).toContain(`/${locale}/client/reports?caseId=${id}`);expect(child).not.toContain(`href="/${locale}/client/reports`);
});
for(const locale of ['en','he'] as const)it(`${locale}: leaving a client keeps global destinations' own toolbar and bounded payment filter`,()=>{
 navigation.pathname=`/${locale}/app/cases/${id}/sessions/223e4567-e89b-42d3-a456-426614174000`;navigation.query=new URLSearchParams({caseId:id,context:'client',mode:'demo',date:'2026-09-22',view:'day'});
 const source=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic session'}));
 const urls=[...source.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1]!.replaceAll('&amp;','&'),'https://private.invalid'));
 for(const destination of ['app/clients','app/marketing','app/payments','app/settings']){
  const links=urls.filter(url=>url.pathname===`/${locale}/${destination}`);expect(links.length).toBeGreaterThan(0);for(const url of links)expect(url.searchParams.has('context')).toBe(false);
 }
 expect(urls.find(url=>url.pathname===`/${locale}/app/payments`)?.searchParams.get('caseId')).toBe(id);
 // Old or caller-supplied global URLs must not hijack the destination's menu either.
 navigation.pathname=`/${locale}/app/marketing`;navigation.query=new URLSearchParams({caseId:id,context:'client',mode:'demo'});
 const destination=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic marketing'}));
 expect(destination).toContain(locale==='he'?'יומן תוכן':'Content Calendar');expect(destination).toContain(locale==='he'?'מודעות':'Ads');expect(destination).not.toContain(locale==='he'?'התיק הנבחר':'Selected case');
});
