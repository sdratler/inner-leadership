import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {fishingOwnerNavigation,type FishingOwnerNavigationInput,type FishingOwnerAvailability} from '../../src/features/fishing-owner/fishing-owner-navigation-model.ts';
import {FishingOwnerNavigation} from '../../src/features/fishing-owner/fishing-owner-navigation.tsx';
import {activeItem} from '../../src/ui/workspace/navigation-model.ts';
import {practitionerDetailReturnPath} from '../../src/features/identity/login-return.ts';

const available:FishingOwnerAvailability={inquiries:{state:'available'},family_contacts:{state:'available'},groups_calendar:{state:'available'},marketing:{state:'available'},settings:{state:'available'}};
const input=(locale:'en'|'he'):FishingOwnerNavigationInput=>({mode:'fishing_owner',locale,availability:available});
const render=(value:FishingOwnerNavigationInput)=>renderToStaticMarkup(createElement(FishingOwnerNavigation,value));
const unsafe=(value:unknown)=>value as FishingOwnerNavigationInput;
const hrefs=(html:string)=>[...html.matchAll(/ href="([^"]+)"/g)].map(match=>match[1]);

describe('unmounted Fishing owner work-area navigation',()=>{
 it.each(['en','he'] as const)('uses only the five admitted existing %s destinations in four useful areas',locale=>{
  const model=fishingOwnerNavigation(input(locale))!;
  expect(model.areas.map(area=>area.key)).toEqual(['families','groups_calendar','marketing','settings']);
  expect(hrefs(render(input(locale)))).toEqual(['app/group-applications','app/clients','app/fishing-groups','app/marketing','app/settings'].map(path=>`/${locale}/${path}`));
  expect(model.areas[0]?.items.map(item=>item.label)).toEqual(locale==='he'?['פניות לדיג','משפחות ואנשי קשר']:['Fishing inquiries','Families & contacts']);
 });
 it.each(['en','he'] as const)('renders semantic, localized %s navigation with ordinary keyboard links',locale=>{
  const html=render(input(locale));
  expect(html).toContain(`<nav`);expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);
  expect(html).toContain(locale==='he'?'aria-label="אזורי העבודה של אקדמיית הדיג"':'aria-label="Fishing Academy work areas"');
  expect(html).toContain(locale==='he'?'סביבת ניהול':'Owner workspace');
  expect(html.match(/<a /g)).toHaveLength(5);
  expect(html).not.toMatch(/<button|<form|tabindex=|role="menu|onclick=|aria-hidden/);
  expect(hrefs(html).join(' ')).not.toMatch(/app\/(calendar|payments|feedback|reports|practice)|\/family(?:\/|$)|\/client(?:\/|$)|student|demo|sample|login|sign-in/);
 });
 it.each([null,{}, {mode:'unavailable',locale:'en'}, {mode:'practitioner',locale:'en',availability:available},
  {role:'practitioner',title:'Fishing Academy',query:{mode:'fishing_owner'},locale:'en',availability:available},
  {mode:'fishing_owner',locale:'fr',availability:available},
  Object.create({mode:'fishing_owner',locale:'en',availability:available})])('does not infer Fishing owner scope from unsupported input %#',value=>{
  expect(fishingOwnerNavigation(unsafe(value))).toBeNull();expect(render(unsafe(value))).toBe('');
 });
 it.each(['en','he'] as const)('keeps missing %s availability closed with a visible reason, without fake controls',locale=>{
  const html=render(unsafe({mode:'fishing_owner',locale}));
  expect(hrefs(html)).toEqual([]);expect(html).not.toContain('<button');
  expect(html.match(/data-availability="unavailable"/g)).toHaveLength(5);
  expect(html).toContain(locale==='he'?'הזמינות באזור הניהול של אקדמיית הדיג טרם אומתה.':'Availability has not been confirmed for this Fishing workspace.');
 });
 it('enables only explicitly available own entries and never forwards caller paths or scope',()=>{
  const availability=Object.assign(Object.create({marketing:{state:'available'}}),{
   inquiries:{state:'available',href:'https://outside.invalid/owner'},family_contacts:{state:'enabled'},
   groups_calendar:{state:'unavailable',reason:'temporarily_unavailable'},settings:null,
  });
  const html=render(unsafe({mode:'fishing_owner',locale:'en',availability,role:'parent',query:{workspaceId:'bna',demo:true}}));
  expect(hrefs(html)).toEqual(['/en/app/group-applications']);expect(html).not.toContain('outside.invalid');
  expect(html).toContain('This work area is temporarily unavailable.');expect(html.match(/data-availability="unavailable"/g)).toHaveLength(4);
 });
 it.each(['en','he'] as const)('can explain all seven %s areas without linking unfinished Overview/Billing/Communications',locale=>{
  const props={...input(locale),unavailableAreas:{overview:{state:'unavailable',reason:'not_connected'},billing:{state:'unavailable',reason:'setup_required'},communications:{state:'unavailable',reason:'temporarily_unavailable'}}};
  const model=fishingOwnerNavigation(unsafe(props))!,html=render(unsafe(props));
  expect(model.areas.map(area=>area.key)).toEqual(['overview','families','groups_calendar','billing','communications','marketing','settings']);
  expect(model.areas.filter(area=>area.reason).every(area=>area.items.length===0)).toBe(true);
  expect(hrefs(html)).toHaveLength(5);expect(html).not.toContain('<button');
  for(const text of locale==='he'?['סקירה','חיובים ותשלומים','תקשורת','יש להשלים את ההגדרה לפני פתיחת אזור העבודה הזה.']:['Overview','Billing','Communications','Setup is required before this work area can be opened.'])expect(html).toContain(text);
 });
 it('refuses invented future route availability or reasons and ignores unknown areas',()=>{
  const value=unsafe({...input('en'),unavailableAreas:{overview:{state:'available',href:'/en/app/reports'},billing:{state:'available',href:'/en/app/payments'},communications:{state:'unavailable',reason:'made_up'},practice:{state:'unavailable',reason:'setup_required'}}});
  expect(fishingOwnerNavigation(value)?.areas.map(area=>area.key)).toEqual(['families','groups_calendar','marketing','settings']);
  expect(hrefs(render(value))).toEqual(hrefs(render(input('en'))));
 });
 it('marks only the explicitly selected available destination current',()=>{
  const html=render({...input('en'),currentDestination:'family_contacts'} as FishingOwnerNavigationInput);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);expect(html).toContain('href="/en/app/clients" aria-current="page"');
  const blocked=render({...input('en'),availability:{...available,family_contacts:{state:'unavailable',reason:'setup_required'}},currentDestination:'family_contacts'} as FishingOwnerNavigationInput);
  expect(blocked).not.toContain('aria-current');expect(hrefs(blocked)).not.toContain('/en/app/clients');
  expect(render(unsafe({...input('en'),pathname:'/en/app/clients',query:{currentDestination:'family_contacts'}}))).not.toContain('aria-current');
 });
 it.each(['en','he'] as const)('retains the existing %s group destination/return-path guard contract without treating navigation as authentication',locale=>{
  const path=`/${locale}/app/fishing-groups`,id='11111111-1111-4111-8111-111111111111';
  expect(activeItem(path,locale,'practitioner')?.key).toBe('clients');
  expect(activeItem(path,locale,'parent')).toBeUndefined();expect(activeItem(path,locale,'client')).toBeUndefined();
  expect(practitionerDetailReturnPath(locale,path,{groupId:id,revision:'2',role:'parent',workspaceId:'bna',mode:'demo',next:'https://outside.invalid'})).toBe(path+'?groupId='+id+'&revision=2');
  expect(practitionerDetailReturnPath(locale,path,{groupId:'bad',revision:'2'})).toBe(path);
 });
});
