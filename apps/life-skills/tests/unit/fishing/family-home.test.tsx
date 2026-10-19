import {expect,it} from 'vitest';
import {fishingFamilyContext,fishingFamilyHref,fishingNextTrip} from '../../../src/features/fishing/family-home-contract.ts';
import {parentReturnPath} from '../../../src/features/identity/login-return.ts';
import type {StageView} from '../../../src/features/fishing-stage/contract.ts';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkspaceShell} from '../../../src/ui/workspace/workspace-shell.tsx';
const learner='10000000-0000-4000-8000-000000000001',enrollment='10000000-0000-4000-8000-000000000002',cohort='10000000-0000-4000-8000-000000000003',stage='10000000-0000-4000-8000-000000000004';
const context=new URLSearchParams({fishing:'1',learnerId:learner,enrollmentId:enrollment,cohortId:cohort,stageId:stage,stage:'1'});
it.each(['en','he'] as const)('keeps the exact selected Academy context across %s Home/Calendar/login, without forwarding role/case/provider fields',locale=>{
 const input=new URLSearchParams(context);input.set('role','practitioner');input.set('providerSecret','not-forwarded');input.set('caseId',stage);
 for(const path of ['family','family/schedule'] as const){
  const next=fishingFamilyHref(locale,path,input),url=new URL(next,'https://private.invalid');
  expect(Object.fromEntries(url.searchParams)).toEqual(Object.fromEntries(context));
  const returned=new URL(parentReturnPath(locale,url.pathname,{...Object.fromEntries(url.searchParams),role:'practitioner',providerSecret:'not-forwarded'}),'https://private.invalid');
  expect(Object.fromEntries(returned.searchParams)).toEqual(Object.fromEntries(context));
 }
});
it('does not silently select a different child after malformed, duplicate or incomplete Academy context',()=>{
 for(const key of ['learnerId','enrollmentId','stageId','cohortId','stage','fishing']){
  const duplicate=new URLSearchParams(context);duplicate.append(key,duplicate.get(key)!);expect(fishingFamilyContext(duplicate)).toBeNull();
  const wrong=new URLSearchParams(context);wrong.set(key,'not-valid');expect(fishingFamilyContext(wrong)).toBeNull();
 }
 const partial=new URLSearchParams(context);partial.delete('enrollmentId');expect(fishingFamilyContext(partial)).toBeNull();
 expect(fishingFamilyContext(new URLSearchParams('fishing=1'))?.toString()).toBe('fishing=1');
 expect(fishingFamilyContext(new URLSearchParams('fishing=1&learnerId='+learner))?.toString()).toBe('fishing=1&learnerId='+learner);
 expect(parentReturnPath('en','/en/family',{fishing:'1',learnerId:[learner,learner]})).toBe('/en/family');
});
it.each(['en','he'] as const)('Academy navigation offers Home and Calendar while ordinary %s family navigation keeps the existing clinical destinations',locale=>{
 const plain=renderToStaticMarkup(<WorkspaceShell locale={locale} role="parent" pathname={'/'+locale+'/family'} languageHref="/he/family">Existing</WorkspaceShell>);
 const academy=renderToStaticMarkup(<WorkspaceShell locale={locale} role="parent" academyContext pathname={'/'+locale+'/family'} languageHref="/he/family">Academy</WorkspaceShell>);
 expect(plain).toContain('/family/practice');expect(plain).toContain('/family/reports');
 expect(academy).toContain('/family/schedule');expect(academy).not.toContain('/family/practice');expect(academy).not.toContain('/family/reports');expect(academy).not.toContain('/family/feedback');
});
it('uses only the authorized next-trip pointer; never substitutes another occurrence or an undated/cancelled trip',()=>{
 const occurrence={id:'trip',cohortId:cohort,stageId:stage,stage:1,state:'published',time:{kind:'scheduled',timeZone:'America/New_York',startsAt:'2026-11-01T15:00:00Z',endsAt:'2026-11-01T18:00:00Z'}};
 const view={cohortId:cohort,stageId:stage,stage:1,role:'parent',enrollmentId:enrollment,nextOccurrenceId:'trip',occurrences:[occurrence]} as StageView;
 expect(fishingNextTrip(view)).toBe(occurrence);expect(fishingNextTrip({...view,nextOccurrenceId:'missing'})).toBeNull();expect(fishingNextTrip({...view,occurrences:[...view.occurrences,...view.occurrences]})).toBeNull();
 expect(fishingNextTrip({...view,role:'child'})).toBeNull();
 for(const change of [{state:'cancelled'},{stageId:learner},{time:{kind:'undated',timeZone:'America/New_York'}}])expect(fishingNextTrip({...view,occurrences:[{...occurrence,...change}]} as StageView)).toBeNull();
});
