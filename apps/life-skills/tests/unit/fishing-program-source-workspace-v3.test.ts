import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {PROGRAM_SOURCE_V3,programSourceRecordV3Schema,type ProgramSourceCommandV3} from '../../src/features/fishing-billing/program-source-contract-v3.ts';
import {programSourceGroupDataV3Schema} from '../../src/features/fishing-billing/program-source-owner-contract-v3.ts';
import {prepareProgramSourceSaveV3,programLessonInputsV3,prepareProgramLessonSaveV3,ProgramLessonInputErrorV3} from '../../src/features/fishing-billing/program-source-client-v3.ts';
import {ProgramSourceWorkspaceV3,ProgramSourceSummaryV3,ProgramSourceLessonsV3,retainProgramSourceOperationV3} from '../../src/features/fishing-billing/program-source-workspace-v3.tsx';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const group=id(4),owner=id(1),workspace=id(2);
const base={version:PROGRAM_SOURCE_V3,groupId:group,id:group,expectedRevision:0,operationId:id(5)};
function record(command:ProgramSourceCommandV3){return programSourceRecordV3Schema.parse({version:PROGRAM_SOURCE_V3,workspaceId:workspace,
 revision:command.expectedRevision+1,recordedBy:owner,recordedAt:'2026-11-10T18:30:00.000Z',previousDigest:command.expectedRevision? 'b'.repeat(64):null,command});}
function lesson(sequence=1){return record({...base,kind:'lesson',id:id(20+sequence),operationId:id(30+sequence),
 fields:{state:'scheduled',sequence,startsAt:'2026-11-15T15:00:00.000Z',endsAt:'2026-11-15T16:00:00.000Z',timeZone:'America/New_York'}});}
function data(){return programSourceGroupDataV3Schema.parse({version:PROGRAM_SOURCE_V3,kind:'group_source',classification:'scheduling_facts_only',
 group:{record:record({...base,kind:'group',fields:{state:'forming',location:'Synthetic <venue>',venueSource:{id:'synthetic-evidence',sha256:'a'.repeat(64)}}}),digest:'c'.repeat(64)},
 lessons:[{record:lesson(),digest:'d'.repeat(64)}],progressions:[]});}

describe('native owner program readable views',()=>{
 it.each(['en','he'] as const)('renders an honest %s selected-group loading view without SSR network or internal IDs',locale=>{
  const network=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw new Error('SSR_NETWORK');});
  try{
   const html=renderToStaticMarkup(createElement(ProgramSourceWorkspaceV3,{locale,groupId:group,groupLabel:'Synthetic group'}));
   expect(html).toContain(locale==='he'?'טוען את לוח הזמנים השמור':'Loading the saved schedule');expect(html).toContain('dir="'+(locale==='he'?'rtl':'ltr')+'"');
   expect(html).not.toContain(group);expect(html).not.toContain('<form');expect(html).not.toContain('No lessons have been saved');expect(network).not.toHaveBeenCalled();
  }finally{network.mockRestore();}
 });
 it('keeps no-selection and invalid-selection distinct from loading or saved-empty',()=>{
  const idle=renderToStaticMarkup(createElement(ProgramSourceWorkspaceV3,{locale:'en'}));
  const invalid=renderToStaticMarkup(createElement(ProgramSourceWorkspaceV3,{locale:'en',groupId:'invalid'}));
  expect(idle).toContain('Choose a saved group');expect(idle).not.toContain('Loading');expect(invalid).toContain('selection is invalid');expect(invalid).not.toContain('No lessons');
 });
 it.each(['en','he'] as const)('shows actual scheduling facts and readable Florida lessons in %s without paid/active authority',locale=>{
  const value=data(),summary=renderToStaticMarkup(createElement(ProgramSourceSummaryV3,{data:value,locale}));
  const lessons=renderToStaticMarkup(createElement(ProgramSourceLessonsV3,{data:value,locale}));
  expect(summary).toContain('Synthetic &lt;venue&gt;');expect(summary).not.toContain('synthetic-evidence');
  expect(summary).toContain(locale==='he'?'בהכנה':'In preparation');expect(summary).toContain(locale==='he'?'לא נשמרו תוכניות':'No participant plans');
  expect(lessons).toContain(locale==='he'?'שעון פלורידה':'Florida time');expect(lessons).toContain(locale==='he'?'10:00':'10:00 AM');
  expect(lessons).not.toContain('<button');expect(summary+lessons).not.toMatch(/(?:\$650|650 USD|\bPaid\b|\bActive\b|₪|00000000-0000)/);
 });
 it('orders the full saved lesson data before applying an explicit readable page limit',()=>{
  const value=data(),earlier=lesson(2),later=lesson(3);
  if(earlier.command.kind!=='lesson'||later.command.kind!=='lesson')throw new Error('FIXTURE_KIND');
  earlier.command.fields.startsAt='2026-11-14T15:00:00.000Z';earlier.command.fields.endsAt='2026-11-14T16:00:00.000Z';later.command.fields.state='cancelled';
  value.lessons.push({record:earlier,digest:'a'.repeat(64)},{record:later,digest:'b'.repeat(64)});
  const html=renderToStaticMarkup(createElement(ProgramSourceLessonsV3,{data:value,locale:'en',limit:1,edit:()=>undefined}));
  expect(html).toContain('Lesson <bdi>2</bdi>');expect(html).not.toContain('Lesson <bdi>1</bdi>');expect(html).toContain('of <bdi>3</bdi>');expect(html).toContain('Edit lesson');
 });
 it('counts saved readiness and withdrawn plans without presenting them as paid seats or verified guardian facts',()=>{
  const value=data();
  for(const [n,state,readiness] of [[1,'planned','needs_foundation'],[2,'withdrawn','foundation_complete']] as const){
   value.progressions.push({digest:'a'.repeat(64),record:record({...base,kind:'progression',id:id(50+n),operationId:id(60+n),
    fields:{state,readiness,familyId:id(7),proposalId:id(8),reference:id(9),expectedEpoch:1,eligibleFrom:'2026-11-15T15:00:00.000Z',evidence:readiness==='needs_foundation'?null:{id:'synthetic-skill',sha256:'b'.repeat(64)}}})});
  }
  const html=renderToStaticMarkup(createElement(ProgramSourceSummaryV3,{data:value,locale:'en'}));
  expect(html).toContain('Needs the foundation lessons');expect(html).toContain('Withdrawn plans');expect(html).not.toContain('Foundation lessons complete');
  expect(html).not.toContain('synthetic-skill');expect(html).not.toContain('Paid');
 });
 it('retains an earlier uncertain operation after later known rejection and clears it only on an authenticated saved result',()=>{
  const save=prepareProgramSourceSaveV3(lesson().command),pending={save,uncertain:true};
  expect(retainProgramSourceOperationV3(pending,{state:'rejected',code:'FORBIDDEN',requestId:null})?.save).toBe(save);
  expect(retainProgramSourceOperationV3({save,uncertain:false},{state:'not_sent',code:'INVALID_REQUEST',requestId:null})).toBeNull();
  expect(retainProgramSourceOperationV3(pending,{state:'saved',requestId:id(3),value:{version:PROGRAM_SOURCE_V3,kind:'recorded_source',record:record(save.command),digest:'a'.repeat(64),replayed:true}})).toBeNull();
 });
});

describe('owner lesson edits preserve reviewed Florida time facts',()=>{
 it('preserves exact original offset, seconds and milliseconds for unchanged ambiguous displayed times',()=>{
  const original=lesson();if(original.command.kind!=='lesson')throw new Error('FIXTURE_KIND');
  original.command.fields.startsAt='2026-11-01T01:30:45.123-04:00';original.command.fields.endsAt='2026-11-01T02:30:45.123-05:00';
  const inputs=programLessonInputsV3(original);
  expect(inputs.startsAt).toBe('2026-11-01T01:30:45.123');
  expect(prepareProgramLessonSaveV3(group,original.command.id,id(80),inputs,original)).toBeNull();
  const prepared=prepareProgramLessonSaveV3(group,original.command.id,id(81),{...inputs,sequence:'2'},original);
  expect(prepared?.command).toMatchObject({expectedRevision:1,fields:{sequence:2,startsAt:original.command.fields.startsAt,endsAt:original.command.fields.endsAt}});
 });
 it.each([['2026-11-01T01:45','ambiguous'],['2026-03-08T02:30','nonexistent']] as const)('requires correction of changed Florida time %s rather than selecting a host-zone offset', (startsAt,reason)=>{
  const original=lesson(),inputs={...programLessonInputsV3(original),startsAt};
  try{prepareProgramLessonSaveV3(group,original.command.id,id(80),inputs,original);throw new Error('EXPECTED_REJECTION');}
  catch(error){expect(error).toBeInstanceOf(ProgramLessonInputErrorV3);expect(error).toMatchObject({reason,field:'startsAt'});}
 });
 it('creates only explicit valid ordered lesson facts with a stable caller-supplied operation, and refuses another selected record',()=>{
  const inputs={sequence:'1',startsAt:'2026-11-15T10:00',endsAt:'2026-11-15T11:00',state:'scheduled' as const};
  expect(prepareProgramLessonSaveV3(group,id(20),id(80),inputs)?.command).toMatchObject({kind:'lesson',operationId:id(80),expectedRevision:0,
   fields:{startsAt:'2026-11-15T15:00:00.000Z',endsAt:'2026-11-15T16:00:00.000Z'}});
  expect(()=>prepareProgramLessonSaveV3(id(99),id(21),id(80),inputs,lesson())).toThrow('LESSON_SELECTION_MISMATCH');
  expect(()=>prepareProgramLessonSaveV3(group,id(20),id(80),{...inputs,endsAt:'2026-11-15T09:00'})).toThrow();
  expect(()=>prepareProgramLessonSaveV3(group,id(20),id(80),{...inputs,sequence:'1.5'})).toThrow();
 });
});
