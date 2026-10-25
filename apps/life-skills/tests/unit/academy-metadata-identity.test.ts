import {describe,it,expect} from 'vitest';
import {academyMetadata} from '../../src/features/group-application/academy-metadata.ts';
import {campaignSnapshotSchema,ACADEMY_CAMPAIGN} from '../../src/features/group-application/academy-campaign-contract.ts';
const pre=campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,phase:'PRE_REGISTRATION',revision:1,capacity:30,occupied:1,remaining:29,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
const regular=campaignSnapshotSchema.parse({...pre,phase:'REGULAR_REGISTRATION',revision:2,occupied:30,remaining:0,firstFilledAt:'2026-10-23T14:00:00.000Z'});
const pages=[
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
   const expected=campaign?.phase==='PRE_REGISTRATION'?page[locale]:page[locale].replace('Free Registration','Registration').replace('הרשמה חינמית','הרשמה');
   expect(client.title).toBe(server.title);expect(client.title.startsWith(expected+' | ')).toBe(true);
   expect(client.openGraph.title).toBe(expected);expect(client.openGraph.title).toBe(server.openGraph.title);
   expect(client.alternates).toEqual(server.alternates);expect(client.alternates.canonical.endsWith(page.path)).toBe(true);
   expect(client.openGraph.url).toBe(client.alternates.canonical);
   if(campaign?.phase!=='PRE_REGISTRATION')expect(client.description).not.toContain('first 30');
  }
 });
 it.each(['en','he'] as const)('%s keeps homepage and explicit caller titles while rejecting unknown routes',locale=>{
  const home=academyMetadata(locale,'',undefined,'bna',pre);
  expect(home.title).toBe(locale==='he'?'האקדמיה לדיג ולמנהיגות יהודית בדרום פלורידה':'South Florida Jewish Leadership Fishing Academy');
  expect(home.title).not.toContain(' | ');
  expect(academyMetadata(locale,'/apply','Reviewed custom title','bna',null).openGraph.title).toBe('Reviewed custom title');
  for(const path of ['/stages/unknown','/other','/stages/advanced?x=1'])expect(()=>academyMetadata(locale,path)).toThrow('ACADEMY_PATH_UNAVAILABLE');
 });
});
