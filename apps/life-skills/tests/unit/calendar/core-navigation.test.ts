import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>'/en/app/calendar',useSearchParams:()=>new URLSearchParams()}));
import { CoreNavigation,selectedCaseId } from '../../../src/ui/workspace/core-navigation.tsx';

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
