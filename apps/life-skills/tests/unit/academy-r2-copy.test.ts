import {trip390Copy} from '../../src/features/group-application/academy-trip390-contract.ts';
import {describe,it,expect} from 'vitest';
import {academyR2Copy,ACADEMY_R2_COPY_VERSION} from '../../src/features/group-application/academy-r2-copy.ts';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AcademyTrip390Page} from '../../src/features/group-application/academy-trip390-page.tsx';
import {AcademyValueIcon} from '../../src/features/group-application/academy-r2-value-icon.tsx';

describe('R2 prospective acquisition presentation',()=>{
 it('keeps the exact supplied copy version and paired identities',()=>{expect(ACADEMY_R2_COPY_VERSION).toBe('JLFA-ACADEMY650-ACQUISITION-20261105-R2');expect(academyR2Copy.en.faqs.map(item=>item.id)).toEqual(academyR2Copy.he.faqs.map(item=>item.id));expect(academyR2Copy.en.faqs).toHaveLength(14);});
 it.each(['en','he'] as const)('binds all supplied %s copy without inventing offer text',locale=>{const copy=academyR2Copy[locale];expect(copy.intro).toEqual(copy.exact.intro);expect(copy.skills).toEqual(copy.exact.learning.cards);expect(copy.founder).toEqual(copy.exact.founder);expect(copy.faqs).toEqual(copy.exact.faq.items);expect(copy.form.interest_ack).toBe(copy.exact.form.consents[0]!.text);expect(copy.form.whatsapp).toBe(trip390Copy[locale].form.whatsapp);});
 it('distinguishes the alternative fee retentions and nonbinding request',()=>{const answer=academyR2Copy.en.faqs.find(item=>item.id==='cancellation')!.a;expect(answer).toContain('$100 administrative fee');expect(answer).toContain('$200 in total');expect(answer).toContain('free reservation request');expect(answer).not.toMatch(/\$300|\$390|fee-free/);});
 it.each(['clipboard-check','messages-square','route','rotate-cw'] as const)('renders %s inline, decorative and with actual geometry',name=>{const markup=renderToStaticMarkup(createElement(AcademyValueIcon,{name}));expect(markup).toContain('stroke="currentColor"');expect(markup).toContain('aria-hidden="true"');expect(markup).toContain('focusable="false"');expect(markup).toMatch(/<(path|rect|circle)/);});
 it.each(['en','he'] as const)('renders %s in the selected order without old pricing/logistics panels',initialLocale=>{const html=renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale}));expect(html).toContain('data-jlfa-hero-action');expect(html).toContain('data-jlfa-values');expect(html).not.toContain('id="how"');expect(html).not.toContain('id="included"');expect(html.match(/data-trip390-skill=/g)).toHaveLength(6);const ids=Array.from(html.matchAll(/data-jlfa-faq="([^"]+)"/g),match=>match[1]);expect(ids).toHaveLength(12);expect(ids).toEqual(academyR2Copy[initialLocale].faqs.map(item=>item.id).filter(id=>id!=='cancellation'&&id!=='conduct'));expect(html).not.toMatch(/Fishing Club|מועדון הדיג|Learn locally\./);expect(html.indexOf('id="learn"')).toBeLessThan(html.indexOf('id="values"'));expect(html.indexOf('id="values"')).toBeLessThan(html.indexOf('id="about"'));});
 it('retains attribution in the committed icon directory',()=>{const license=readFileSync(new URL('../../public/groups/academy/icons/r2/LICENSE.txt',import.meta.url),'utf8');expect(license).toMatch(/ISC|MIT/);expect(license).toMatch(/Lucide|lucide/);});
});
