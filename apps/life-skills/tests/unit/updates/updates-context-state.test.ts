import {describe,expect,it} from 'vitest';
import {parseUpdateCases,parseUpdateAudiences,parseUpdateThreads,selectedUpdateCase,updateSaveVerified} from '../../../src/features/updates/context-state.ts';
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,now='2026-10-02T07:00:00.000Z';
const report=()=>({id:uid(1),workspaceId:uid(2),caseId:uid(3),audienceId:uid(4),authorAccountId:uid(5),body:'DEMO authorized feedback',eventAt:null,submittedAt:now,reviewState:'new' as const,reviewedByAccountId:null,reviewedAt:null,practice:{workspaceId:uid(2),caseId:uid(3),assignmentId:uid(6),versionId:uid(7),audienceId:uid(4),visibility:'family_full' as const,publishedAt:now,immutableSnapshotDigest:'a'.repeat(64)}});
const reply=()=>({id:uid(8),reportId:uid(1),authorAccountId:uid(9),body:'DEMO authorized reply',state:'published' as const,createdAt:now,publishedAt:now,supersedesReplyId:null});
const submission=()=>({action:'submit_report',caseId:uid(3),audienceId:uid(4),practiceVersionId:uid(7),body:' DEMO authorized feedback ',idempotencyKey:uid(10)});

describe('retained updates context and protected readback',()=>{
 it('keeps 100-reply envelopes bounded and requires an exact oldest-visible cursor',()=>{
  const replies=Array.from({length:100},(_,n)=>({...reply(),id:uid(n+100)}));
  expect(parseUpdateThreads([{report:report(),replies,nextRepliesBefore:replies[0]!.id}],uid(3),uid(4),false)[0]!.replies).toHaveLength(100);
  for(const invalid of [{report:report(),replies:[...replies,{...reply(),id:uid(999)}],nextRepliesBefore:null},{report:report(),replies,nextRepliesBefore:uid(999)},{report:report(),replies:[reply()],nextRepliesBefore:reply().id}])expect(()=>parseUpdateThreads([invalid],uid(3),uid(4),false)).toThrow();
 });
 it('parses only actual unique authorized case/audience DTOs',()=>{
  expect(parseUpdateCases([{id:uid(3),displayName:'DEMO client',kind:'minor',state:'active'}])).toEqual([{id:uid(3),displayName:'DEMO client',kind:'minor'}]);
  expect(parseUpdateAudiences([{id:uid(4),visibility:'family_full',published:true}])).toEqual([{id:uid(4),visibility:'family_full'}]);
  expect(()=>parseUpdateCases([{id:uid(3),displayName:'DEMO',kind:'minor'},{id:uid(3),displayName:'duplicate',kind:'minor'}])).toThrow();
  expect(()=>parseUpdateAudiences([{id:uid(4),visibility:'invented'}])).toThrow();
 });
 it('selects the default only when no case was requested; never substitutes another family',()=>{
  const rows=parseUpdateCases([{id:uid(3),displayName:'DEMO',kind:'minor'}]);expect(selectedUpdateCase(rows,'')).toBe(uid(3));expect(selectedUpdateCase(rows,uid(20))).toBe('');expect(selectedUpdateCase(rows,uid(3))).toBe(uid(3));
 });
 it('validates exact case/audience/frozen-version relationships',()=>{
  expect(parseUpdateThreads([{report:report(),replies:[reply()]}],uid(3),uid(4),false)).toHaveLength(1);
  expect(()=>parseUpdateThreads([{report:report(),replies:[]}],uid(20),uid(4),false)).toThrow();
  expect(()=>parseUpdateThreads([{report:{...report(),practice:{...report().practice,caseId:uid(20)}},replies:[]}],uid(3),uid(4),false)).toThrow();
 });
 it('rejects private draft replies, wrong report joins, duplicate IDs and unexpected private fields',()=>{
  expect(()=>parseUpdateThreads([{report:report(),replies:[{...reply(),state:'draft',publishedAt:null}]}],uid(3),uid(4),false)).toThrow();
  expect(parseUpdateThreads([{report:report(),replies:[{...reply(),state:'draft',publishedAt:null}]}],uid(3),uid(4),true)).toHaveLength(1);
  expect(()=>parseUpdateThreads([{report:report(),replies:[{...reply(),reportId:uid(20)}]}],uid(3),uid(4),true)).toThrow();
  expect(()=>parseUpdateThreads([{report:report(),replies:[]},{report:report(),replies:[]}],uid(3),uid(4),false)).toThrow();
  expect(()=>parseUpdateThreads([{report:{...report(),privateTranscript:'not a permitted field'},replies:[]}],uid(3),uid(4),true)).toThrow();
 });
 it('rejects malformed dates, overlong bodies and oversized envelopes without accepting false empty data',()=>{
  expect(()=>parseUpdateThreads([{report:{...report(),submittedAt:'not a date'},replies:[]}],uid(3),uid(4),true)).toThrow();
  expect(()=>parseUpdateThreads([{report:{...report(),body:'x'.repeat(8001)},replies:[]}],uid(3),uid(4),true)).toThrow();
  expect(()=>parseUpdateThreads(Array.from({length:101},(_,i)=>({report:{...report(),id:uid(i+100)},replies:[]})),uid(3),uid(4),true)).toThrow();
  expect(()=>parseUpdateThreads({ok:true},uid(3),uid(4),false)).toThrow();
 });
 it('does not equate acknowledgement with stored success',()=>{
  const rows=parseUpdateThreads([{report:report(),replies:[]}],uid(3),uid(4),false);
  expect(updateSaveVerified([],submission(),report())).toBe(false);expect(updateSaveVerified(rows,submission(),{})).toBe(false);expect(updateSaveVerified(rows,submission(),report())).toBe(true);
  for(const change of [{caseId:uid(20)},{audienceId:uid(20)},{practiceVersionId:uid(20)},{body:'another body'}])expect(updateSaveVerified(rows,{...submission(),...change},report())).toBe(false);
  expect(updateSaveVerified(rows,submission(),{...report(),authorAccountId:uid(20)})).toBe(false);
 });
 it('verifies a reviewed result and exact published reply independently',()=>{
  const reviewed={...report(),reviewState:'reviewed' as const,reviewedByAccountId:uid(9),reviewedAt:now},rows=parseUpdateThreads([{report:reviewed,replies:[reply()]}],uid(3),uid(4),true);
  expect(updateSaveVerified(rows,{action:'review',reportId:uid(1)},reviewed)).toBe(true);expect(updateSaveVerified(rows,{action:'review',reportId:uid(20)},reviewed)).toBe(false);
  expect(updateSaveVerified(parseUpdateThreads([{report:report(),replies:[]}],uid(3),uid(4),true),{action:'review',reportId:uid(1)},report())).toBe(false);
  const action={action:'reply',reportId:uid(1),body:reply().body,publish:true};expect(updateSaveVerified(rows,action,reply())).toBe(true);expect(updateSaveVerified(rows,{...action,body:'another reply'},reply())).toBe(false);expect(updateSaveVerified(rows,action,{...reply(),id:uid(20)})).toBe(false);
 });
});
