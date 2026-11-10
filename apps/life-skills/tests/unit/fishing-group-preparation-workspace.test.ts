import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {createGroupDraft} from '../../src/features/fishing-billing/group-preparation-client.ts';
import {GROUP_PREPARATION_CLASS,GROUP_PREPARATION_PROGRAM,groupPreparationRecord} from '../../src/features/fishing-billing/group-preparation-contract.ts';
import {
 FishingGroupPreparationWorkspace,GroupPreparationWorkspace,GroupPreparationPendingNotice,GroupPreparationRecordSummary,
 groupPreparationError,retainGroupOperation,
} from '../../src/features/fishing-billing/group-preparation-workspace.tsx';

const group='00000000-0000-4000-8000-000000000001',operation='00000000-0000-4000-8000-000000000002',owner='00000000-0000-4000-8000-000000000003';
const pending={save:createGroupDraft(group,operation,{label:'Synthetic group',firstClassLocalDate:'',proposedCapacity:''}),uncertain:true};
function record(capacity:number|null=null){
 return groupPreparationRecord.parse({version:pending.save.command.version,classification:GROUP_PREPARATION_CLASS,programKey:GROUP_PREPARATION_PROGRAM,
  groupId:group,workspaceId:'00000000-0000-4000-8000-000000000004',revision:1,state:'draft',action:'create',createdBy:owner,recordedBy:owner,
  createdAt:'2026-11-10T18:30:00.000Z',recordedAt:'2026-11-10T18:30:00.000Z',operationId:operation,requestDigest:'a'.repeat(64),previousDigest:null,
  fields:{label:'Synthetic group',timeZone:'America/New_York',period:null,firstClassAt:null,firstClassLocalDate:null,venueSource:null,proposedCapacity:capacity}});
}
describe('owner group preparation state and bilingual view',()=>{
 it.each(['en','he'] as const)('exports a mountable %s owner workspace with a truthful loading boundary and no SSR request',locale=>{
  const network=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw new Error('SSR_NETWORK');});
  try{
   const html=renderToStaticMarkup(createElement(FishingGroupPreparationWorkspace,{locale,initialGroupId:group,initialRevision:1}));
   expect(html).toContain('lang="'+locale+'"');expect(html).toContain('dir="'+(locale==='he'?'rtl':'ltr')+'"');
   expect(html).toContain(locale==='he'?'טוען טיוטות קבוצה שמורות':'Loading saved group drafts');
   expect(html).toContain(locale==='he'?'אינן מאשרות':'do not confirm');
   expect(html).not.toContain('Synthetic group');expect(html).not.toContain('<form');
   expect(network).not.toHaveBeenCalled();expect(GroupPreparationWorkspace).toBe(FishingGroupPreparationWorkspace);
  }finally{network.mockRestore();}
 });
 it('rejects an invalid deep link before displaying a saved record or attempting a request',()=>{
  const html=renderToStaticMarkup(createElement(FishingGroupPreparationWorkspace,{locale:'en',initialRevision:2}));
  expect(html).toContain('This group link is invalid');expect(html).not.toContain('Loading saved group drafts');
  expect(html).toContain('href="/en/app/fishing-groups"');expect(html).not.toContain('<form');
 });
 it.each(['en','he'] as const)('renders unknown and zero capacity distinctly without a paid/full/seat claim in %s',locale=>{
  const unset=renderToStaticMarkup(createElement(GroupPreparationRecordSummary,{record:record(),locale}));
  const zero=renderToStaticMarkup(createElement(GroupPreparationRecordSummary,{record:record(0),locale}));
  expect(unset).toContain(locale==='he'?'לא הוגדר':'Not set');expect(unset).not.toContain('<bdi>0</bdi>');
  expect(zero).toContain('<bdi>0</bdi>');expect(zero).toContain(locale==='he'?'קיבולת מוצעת':'Proposed capacity');
  expect(zero).not.toMatch(/(?:\bFull\b|\bPaid\b|קבוצה מלאה|שולם|650|ILS|₪)/);
 });
 it('shows Florida time independently of the execution host timezone',()=>{
  const html=renderToStaticMarkup(createElement(GroupPreparationRecordSummary,{record:record(),locale:'he'}));
  expect(html).toContain('13:30');expect(html).not.toContain('20:30');
 });
 it('renders saved text as text rather than markup and introduces no public artwork',()=>{
  const item=record();item.fields.venueSource={id:'<img src=x onerror=alert(1)>',sha256:'b'.repeat(64)};
  const html=renderToStaticMarkup(createElement(GroupPreparationRecordSummary,{record:item,locale:'en'}));
  expect(html).toContain('&lt;img');expect(html).not.toContain('<img');expect(html).not.toContain('onerror="');
 });
 it.each(['en','he'] as const)('offers explicit same-save recovery with usable disabled busy controls in %s',locale=>{
  const html=renderToStaticMarkup(createElement(GroupPreparationPendingNotice,{pending,busy:false,locale,retry:()=>undefined,check:()=>undefined}));
  expect(html).toContain(locale==='he'?'ניסיון חוזר לאותה שמירה':'Retry the same save');
  expect(html).toContain(locale==='he'?'בדיקת התוצאה השמורה':'Check saved result');
  expect(html).toContain(locale==='he'?'הפעולה המקורית':'Original action');
  const busy=renderToStaticMarkup(createElement(GroupPreparationPendingNotice,{pending,busy:true,locale,retry:()=>undefined,check:()=>undefined}));
  expect(busy.match(/disabled=""/g)).toHaveLength(2);expect(busy).toContain('aria-busy="true"');
 });
 it.each(['UNAUTHENTICATED','FORBIDDEN','CONFLICT','INVALID_REQUEST','RATE_LIMITED'] as const)('retains an earlier uncertain operation after a later %s denial',code=>{
  const kept=retainGroupOperation(pending,{state:'rejected',code,requestId:null});
  expect(kept?.save).toBe(pending.save);expect(kept?.uncertain).toBe(true);
  expect(kept?.save.serialized).toBe(pending.save.serialized);
 });
 it('unlocks a definitely rejected first attempt but retains every uncertain first result',()=>{
  const first={...pending,uncertain:false};
  expect(retainGroupOperation(first,{state:'rejected',code:'CONFLICT',requestId:null})).toBeNull();
  expect(retainGroupOperation(first,{state:'not_sent',code:'UNAUTHENTICATED',requestId:null})).toBeNull();
  expect(retainGroupOperation(first,{state:'unknown',code:'UNAVAILABLE',requestId:null})?.save).toBe(first.save);
  expect(retainGroupOperation(pending,{state:'saved',record:record(),replayed:true,requestId:operation})).toBeNull();
 });
 it.each(['en','he'] as const)('distinguishes denied, conflict and unavailable feedback in %s',locale=>{
  const values=['FORBIDDEN','CONFLICT','UNAVAILABLE','UNAUTHENTICATED'].map(code=>groupPreparationError(code as 'FORBIDDEN',locale));
  expect(new Set(values).size).toBe(4);expect(values.every(value=>value.length>20)).toBe(true);
  expect(groupPreparationError('UNAVAILABLE',locale)).toContain(locale==='he'?'אין פירוש הדבר':'not an empty list');
 });
});
