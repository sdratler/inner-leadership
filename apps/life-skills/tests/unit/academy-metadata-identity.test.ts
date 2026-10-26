import {academyExactCopy,academyExactCurriculum,academyExactStates} from '../../src/features/group-application/academy-exact-copy.ts';
import {describe,it,expect} from 'vitest';
import {academyMetadata} from '../../src/features/group-application/academy-metadata.ts';
import {campaignSnapshotSchema,ACADEMY_CAMPAIGN} from '../../src/features/group-application/academy-campaign-contract.ts';
const pre=campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,phase:'PRE_REGISTRATION',revision:1,capacity:30,occupied:1,remaining:29,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
const regular=campaignSnapshotSchema.parse({...pre,phase:'REGULAR_REGISTRATION',revision:2,occupied:30,remaining:0,firstFilledAt:'2026-10-23T14:00:00.000Z'});
const pages=[
 {path:'/confirm-interest',en:'Confirm your interest',he:'אישור התעניינות'},
 {path:'/stages/foundation',en:'Foundation Angler',he:'יסודות הדיג'},
 {path:'/stages/independent',en:'Independent Angler',he:'דיג עצמאי'},
 {path:'/stages/advanced',en:'Advanced Angler',he:'דיג מתקדם'},
 {path:'/stages/leadership',en:'Leadership Angler',he:'דיג ומנהיגות'},
 {path:'/pricing',en:'Pricing & outings',he:'מחירים ויציאות'},
 {path:'/apply',en:'Free Registration for the Fishing Academy',he:'הרשמה חינמית לאקדמיה לדיג'},
] as const;
describe('Academy registered page metadata identity',()=>{
 it.each(['en','he'] as const)('%s hydration and campaign changes retain each registered page title and exact route',locale=>{
  for(const mode of ['legacy','bna'] as const)for(const campaign of [pre,regular,null])for(const page of pages){
   const server=academyMetadata(locale,page.path,page[locale],mode,campaign);
   const client=academyMetadata(locale,page.path,undefined,mode,campaign);
   const copy=academyExactCopy[locale].metadata,stage=academyExactCurriculum.stages.find(item=>page.path===`/stages/${item.slug}`);const expected=page.path==='/confirm-interest'?academyExactStates[locale].confirmation.heading+' | '+copy.landingTitle:page.path==='/apply'?(campaign?.phase==='PRE_REGISTRATION'?copy.formTitleA:copy.formTitleB):page.path==='/pricing'?copy.pricingTitle:copy.curriculumTitle.replace('{stage_title}',stage!.title[locale]);
   expect(client.title).toBe(server.title);expect(client.title).toBe(expected);
   expect(client.openGraph.title).toBe(expected);expect(client.openGraph.title).toBe(server.openGraph.title);
   expect(client.alternates).toEqual(server.alternates);expect(client.alternates.canonical.endsWith(page.path)).toBe(true);
   expect(client.openGraph.url).toBe(client.alternates.canonical);
   if(campaign?.phase!=='PRE_REGISTRATION')expect(client.description).not.toContain('first 30');
  }
 });
 it.each(['en','he'] as const)('%s keeps exact registered copy over legacy caller titles while rejecting unknown routes',locale=>{
  const home=academyMetadata(locale,'',undefined,'bna',pre);
  expect(home.title).toBe(locale==='he'?'האקדמיה לדיג ולמנהיגות יהודית בדרום פלורידה':'South Florida Jewish Leadership Fishing Academy');
  expect(home.title).not.toContain(' | ');
  expect(academyMetadata(locale,'/apply','Legacy caller title','bna',null).openGraph.title).toBe(academyExactCopy[locale].metadata.formTitleB);
  for(const path of ['/stages/unknown','/other','/stages/advanced?x=1'])expect(()=>academyMetadata(locale,path)).toThrow('ACADEMY_PATH_UNAVAILABLE');
 });
});

it('uses the exact approved Fishing logo for route-scoped SSR social metadata and icons in every phase',()=>{
 for(const locale of ['en','he'] as const)for(const mode of ['legacy','bna'] as const)for(const campaign of [pre,regular,null])for(const path of ['',...pages.map(page=>page.path)]){
  const metadata=academyMetadata(locale,path,undefined,mode,campaign),logo=new URL('/groups/brand/jlfa-logo-locked-v1.png',metadata.alternates.canonical).href;
  expect(metadata.openGraph.images).toEqual([{url:logo,alt:locale==='he'?'האקדמיה לדיג ולמנהיגות יהודית בדרום פלורידה':'South Florida Jewish Leadership Fishing Academy'}]);
  expect(metadata.twitter.images).toEqual([logo]);expect(metadata.twitter.title).toBe(metadata.openGraph.title);expect(metadata.icons.icon[0]?.url).toBe(logo);expect(metadata.icons.apple[0]?.url).toBe(logo);expect(JSON.stringify(metadata)).not.toMatch(/localhost|127\.0\.0\.1|prereg-approved-square/);
 }
});

it.each(['en','he'] as const)('%s confirmation metadata uses exact H identity, stays noindex and reveals no token',locale=>{
 const meta=academyMetadata(locale,'/confirm-interest',undefined,'bna',null);expect(meta.description).toBe(academyExactStates[locale].confirmation.text);expect(meta.robots).toEqual({index:false,follow:false});expect(meta.alternates.canonical).toMatch(/\/confirm-interest$/);expect(JSON.stringify(meta)).not.toMatch(/token=|confirmed|reserved/);
});
