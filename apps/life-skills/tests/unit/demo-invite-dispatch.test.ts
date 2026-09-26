import { describe,expect,test } from 'vitest';
import { demoInviteDispatchPlan,type DemoInviteMail } from '../../src/features/demo/invite-dispatch.ts';

const now=new Date('2026-09-27T12:00:00Z');
const ids=['parent','child','adult'];
const rows:DemoInviteMail[]=ids.map((accountId,id)=>({id:`mail-${id}`,accountId,state:'queued',expiresAt:new Date('2026-09-28T12:00:00Z'),nextAttemptAt:new Date('2026-09-27T11:00:00Z')}));

describe('targeted DEMO invitation plan',()=>{
 test('selects exactly the three eligible invites, never a general mail queue',()=>{
  expect(demoInviteDispatchPlan(ids,rows,now)).toEqual({queuedIds:['mail-0','mail-1','mail-2'],alreadySent:0});
 });
 test('is idempotent for an already sent invite',()=>{
  expect(demoInviteDispatchPlan(ids,[{...rows[0]!,state:'sent'},rows[1]!,rows[2]!],now)).toEqual({queuedIds:['mail-1','mail-2'],alreadySent:1});
 });
 test('ignores a canceled or expired predecessor after a deliberate reissue',()=>{
  const history=[{...rows[0]!,id:'old-canceled',state:'canceled'},
   {...rows[1]!,id:'old-expired',expiresAt:new Date('2026-09-26T12:00:00Z')}];
  expect(demoInviteDispatchPlan(ids,[...history,...rows],now)).toEqual({queuedIds:['mail-0','mail-1','mail-2'],alreadySent:0});
 });
 test('fails closed on duplicates, unrelated rows, failed and expired deliveries',()=>{
  expect(()=>demoInviteDispatchPlan(ids,[...rows,rows[0]!],now)).toThrow();
  expect(()=>demoInviteDispatchPlan(ids,[rows[0]!,rows[1]!,{...rows[2]!,accountId:'other'}],now)).toThrow();
  expect(()=>demoInviteDispatchPlan(ids,[rows[0]!,rows[1]!,{...rows[2]!,state:'failed'}],now)).toThrow();
  expect(()=>demoInviteDispatchPlan(ids,[rows[0]!,rows[1]!,{...rows[2]!,expiresAt:now}],now)).toThrow();
  expect(()=>demoInviteDispatchPlan(ids,[...rows,{...rows[0]!,id:'uncertain-old',state:'failed'}],now)).toThrow();
 });
});
