import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {academyExactContentBinding,academyExactCurriculum,academyExactStates} from '../../src/features/group-application/academy-exact-copy.ts';
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Exact public projections independently compared with registered packet05.
const stagePins={"foundation":"306caee0aa56061dcb75b4e0c97f86e82b7ed2933a6d2130cb2639d306515b8c","independent":"f3894cb910e0d0fdbdbf0de4f6fb086e7996046074fe02badf746757839b44a1","advanced":"dc6984edb95714573c21aaba75ec6373234f9401df3e22039a78ac375b4f8e4e","leadership":"0981b1e9260a01145f796e96aada30e1b48076108be023e54c3930f438b1a2fd"};
describe('one source-bound Exact05 content projection',()=>{
 it('records the immutable editorial source without implying legal or release approval',()=>{
  expect(academyExactContentBinding.version).toBe('JLFA-EXACT-COPY-20261026-05');
  expect(academyExactContentBinding.sourceSha256).toBe('771152d0aef0550bd369ea132b472e5bfcc1d44514ebb7815c1e47a7abd41466');
  expect(academyExactContentBinding.reviewState).toBe('NEW_EDITORIAL_COPY_NOT_LEGAL_OR_TRANSLATION_APPROVAL');
 });
 it('has exactly48 historical IDs,12 per stage, and the required Foundation reorder',()=>{
  expect(academyExactCurriculum.stages).toHaveLength(4);
  const ids=academyExactCurriculum.stages.flatMap(stage=>stage.lessons.map(lesson=>lesson.rmId));
  expect(ids).toHaveLength(48);expect(new Set(ids).size).toBe(48);
  expect(academyExactCurriculum.stages[0]!.lessons.map(x=>x.rmId)).toEqual(['RM-101','RM-103','RM-102',...Array.from({length:9},(_,i)=>`RM-${104+i}`)]);
  for(const stage of academyExactCurriculum.stages){
   expect(stage.lessons.map(x=>x.number)).toEqual(Array.from({length:12},(_,i)=>i+1));
   expect(stage.lessons).toHaveLength(12);
   expect(Object.keys(stage.agePanels)).toEqual(['8–10','11–13','14–17']);
   for(const age of Object.values(stage.agePanels))for(const locale of ['en','he']as const)expect(age[locale]).toHaveLength(2);
   expect(sha(stage)).toBe(stagePins[stage.slug as keyof typeof stagePins]);
  }
 });
 it('pins exact paired state, field-error and meaningful curriculum age text against old-copy regression',()=>{
  expect(sha(academyExactStates)).toBe('948f5c290fb867f35c237b5bd42a7387d11447e118267de3c7b769d35b6b673d');
  expect(sha(academyExactCurriculum.common)).toBe('0371ab3cdcd98f4497c7af576fcb3b1bdb9a48ac8b8091c7dd87bf33f478aadb');
  for(const locale of ['en','he']as const){
   expect(new Set(academyExactCurriculum.stages.map(s=>JSON.stringify(s.agePanels['11–13'][locale]))).size).toBe(4);
   expect(academyExactStates[locale].save.emailSent).toContain('{email}');
   expect(academyExactStates[locale].save.reference).toContain('{reference}');
  }
 });
});
