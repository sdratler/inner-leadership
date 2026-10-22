import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach,expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({query:''}));
vi.mock('next/navigation',()=>({usePathname:()=>'/en/app/calendar',useSearchParams:()=>new URLSearchParams(state.query)}));
import { CoreNavigation,selectedCaseId } from '../../../src/ui/workspace/core-navigation.tsx';
beforeEach(()=>{state.query='';});

it('derives a valid case from the route while explicit query context wins',()=>{
 const id='123e4567-e89b-12d3-a456-426614174000';
 expect(selectedCaseId(`/en/app/cases/${id}`,null)).toBe(id);
 expect(selectedCaseId(`/en/app/cases/${id}`,'223e4567-e89b-12d3-a456-426614174000')).toBe('223e4567-e89b-12d3-a456-426614174000');
 expect(selectedCaseId('/en/app/cases/not-a-uuid',null)).toBeNull();
});

it.each(['en','he'] as const)('practitioner desktop and mobile calendar links resolve to the implemented %s route',locale=>{
 const markup=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic content'}));
 expect(markup.match(new RegExp(`href="/${locale}/app/calendar"`,'g'))?.length ?? 0).toBeGreaterThanOrEqual(2);
 expect(markup).not.toContain(`href="/${locale}/calendar"`);
 expect(existsSync(resolve(import.meta.dirname,'../../../src/app/[locale]/app/calendar/page.tsx'))).toBe(true);
});

it.each(['en','he'] as const)('parent navigation starts with the calendar and retains only routed destinations in %s',locale=>{
 const markup=renderToStaticMarkup(CoreNavigation({locale,role:'parent',children:'Route content'}));
 expect(markup).toContain(`href="/${locale}/family/schedule"`);
 expect(markup).toContain(`href="/${locale}/family/resources"`);
 expect(markup).toContain(`href="/${locale}/family/forms"`);
 expect(markup).toContain(`href="/${locale}/family/reports"`);
 for(const route of ['forms','resources','reports'])expect(existsSync(resolve(import.meta.dirname,`../../../src/app/[locale]/family/${route}/page.tsx`))).toBe(true);
 expect(markup).not.toContain(`href="/${locale}/family#`);
 expect(markup).not.toContain(`/${locale}/student`);
});
it.each(['en','he'] as const)('keeps Academy context on every %s Calendar shell destination without leaking it elsewhere',locale=>{
 const values={fishing:'1',cohortId:'123e4567-e89b-42d3-a456-426614174000',stageId:'223e4567-e89b-42d3-a456-426614174000',stage:'1'};state.query=new URLSearchParams({...values,date:'2026-10-21',view:'day',practice:'1',tasks:'1'}).toString();
 const markup=renderToStaticMarkup(CoreNavigation({locale,role:'practitioner',children:'Synthetic Academy'})),hrefs=[...markup.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1]!.replaceAll('&amp;','&'),'https://private.invalid'));
 const calendar=hrefs.filter(url=>url.pathname===`/${locale}/app/calendar`);expect(calendar.length).toBeGreaterThanOrEqual(7);
 for(const url of calendar){for(const [key,value]of Object.entries(values))expect(url.searchParams.get(key)).toBe(value);expect(url.searchParams.get('date')).toBe('2026-10-21');expect(url.searchParams.has('practice')).toBe(false);expect(url.searchParams.has('tasks')).toBe(false);}
 for(const url of hrefs.filter(url=>url.pathname!==`/${locale}/app/calendar`&&url.pathname!==`/${locale==='en'?'he':'en'}/app/calendar`))for(const key of Object.keys(values))expect(url.searchParams.has(key)).toBe(false);
});
