import { describe,expect,it } from 'vitest';
import { AppError } from '../../src/lib/errors.ts';
import type { SqlSession } from '../../src/features/identity/store.ts';
import type { CreditEffectReference } from '../../src/features/identity/interfaces.ts';
import { asId } from '../../src/lib/ids.ts';
import { applyCalendarCreditEffect } from '../../src/features/payments/calendar-consumer.ts';
const workspace='10000000-0000-4000-8000-000000000010',caseId=asId('10000000-0000-4000-8000-000000000011','case'),appointmentId=asId('10000000-0000-4000-8000-000000000012','appointment'),actorId=asId('10000000-0000-4000-8000-000000000013','account');
type Facts={caseId:string;kind:'individual'|'parent_guidance';termsVersion:string;noticeEligibility:'credit_preserved'|'late_notice'|null;attendanceState:'present'|'late'|'no_show'|'canceled'|null;exceptionReason:'practitioner_exception'|'provider_unavailable'|null};
class FakeSession implements SqlSession{
 facts:Facts={caseId,kind:'individual',termsVersion:'Product2.3',noticeEligibility:null,attendanceState:'present',exceptionReason:null};
 demoBatch:string|null=null;suppressed=new Map<string,{caseId:string;eventDigest:string}>();
 receipts=new Map<string,{effect:string;eventDigest:string}>();events:Array<{blockId:string;kind:string;delta:number;appointmentId:string|null;key:string}>=[];blocks=[{id:'10000000-0000-4000-8000-000000000020',balance:4},{id:'10000000-0000-4000-8000-000000000021',balance:4}];
 async query<T extends object>(sql:string,values:readonly unknown[]=[]):Promise<T[]>{let rows:object[]=[];
  if(sql.startsWith('SELECT effect,event_digest')){const value=this.receipts.get(String(values[1]));if(value)rows=[value];}
  else if(sql.startsWith('SELECT a.case_id'))rows=[this.facts];
  else if(sql.includes('FROM ls_demo.cases')){if(this.demoBatch)rows=[{batchId:this.demoBatch}];}
  else if(sql.includes('FROM ls_calendar.events WHERE workspace_id=$1 AND id=$2'))rows=[{caseId,appointmentId}];
  else if(sql.includes('FROM ls_demo.suppressed_effects')){const value=this.suppressed.get(String(values[1]));if(value)rows=[value];}
  else if(sql.startsWith('INSERT INTO ls_demo.suppressed_effects'))this.suppressed.set(String(values[1]),{caseId:String(values[2]),eventDigest:String(values[4])});
  else if(sql.startsWith('SELECT credit_block_id')){const value=this.events.find(item=>item.kind==='consume'&&item.appointmentId===values[1]);if(value)rows=[{blockId:value.blockId}];}
  else if(sql.startsWith('SELECT b.id FROM ls_payments.credit_blocks')){const value=this.blocks.find(item=>item.balance>0);if(value)rows=[{id:value.id}];}
  else if(sql.startsWith('INSERT INTO ls_payments.credit_events')){const item={blockId:String(values[3]),kind:String(values[4]),delta:Number(values[5]),appointmentId:values[7]===null?null:String(values[7]),key:String(values[9])};this.events.push(item);const block=this.blocks.find(value=>value.id===item.blockId);if(block)block.balance+=item.delta;}
  else if(sql.startsWith('INSERT INTO ls_payments.calendar_receipts'))this.receipts.set(String(values[6]),{effect:String(values[7]),eventDigest:String(values[8])});
  else throw new Error('Unexpected SQL: '+sql.slice(0,70));return rows as T[];
 }
}
function reference(effect:CreditEffectReference['effect']='consume'):CreditEffectReference{return {schemaVersion:1,caseId,appointmentId,rescheduleRequestId:null,termsVersion:'Product2.3',effect,idempotencyKey:`credit:${appointmentId}:${effect}`,actorAccountId:actorId,occurredAt:'2026-09-11T12:00:00.000Z'};}
const meta={id:'10000000-0000-4000-8000-000000000099',sequence:1,workspaceId:workspace,appointmentId};
describe('LS-060 durable calendar consumer',()=>{
 it('consumes one credit from the oldest funded block',async()=>{const db=new FakeSession();await applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference()},meta);expect(db.events).toHaveLength(1);expect(db.events[0]).toMatchObject({blockId:db.blocks[0]!.id,kind:'consume',delta:-1});expect(db.blocks[0]!.balance).toBe(3);});
 it('replays the same event without a second effect',async()=>{const db=new FakeSession(),event={type:'credit_effect' as const,reference:reference()};await applyCalendarCreditEffect(db,event,meta);await applyCalendarCreditEffect(db,event,meta);expect(db.events).toHaveLength(1);expect(db.receipts).toHaveLength(1);});
 it('rejects a reused key with changed bytes',async()=>{const db=new FakeSession(),first=reference();await applyCalendarCreditEffect(db,{type:'credit_effect',reference:first},meta);await expect(applyCalendarCreditEffect(db,{type:'credit_effect',reference:{...first,occurredAt:'2026-09-11T12:01:00.000Z'}},meta)).rejects.toBeInstanceOf(AppError);});
 it('fails rather than creating debt when all credits are exhausted',async()=>{const db=new FakeSession();db.blocks.forEach(block=>{block.balance=0;});await expect(applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference()},meta)).rejects.toBeInstanceOf(AppError);expect(db.events).toHaveLength(0);});
 it('records timely preservation without changing the ledger',async()=>{const db=new FakeSession();db.facts.noticeEligibility='credit_preserved';db.facts.attendanceState=null;await applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference('preserve')},meta);expect(db.events).toHaveLength(0);expect(db.receipts.size).toBe(1);});
 it('does not accept a consume for timely notice',async()=>{const db=new FakeSession();db.facts.noticeEligibility='credit_preserved';await expect(applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference()},meta)).rejects.toBeInstanceOf(AppError);});
 it('consumes a late notice even without attendance',async()=>{const db=new FakeSession();db.facts.noticeEligibility='late_notice';db.facts.attendanceState=null;await applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference()},meta);expect(db.events[0]?.kind).toBe('consume');});
 it('consumes no-show independently of attended-session counting',async()=>{const db=new FakeSession();db.facts.attendanceState='no_show';await applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference()},meta);expect(db.events[0]).toMatchObject({kind:'consume',delta:-1});});
 it('restores to the exact consumed block after an exception',async()=>{const db=new FakeSession(),consume=reference();await applyCalendarCreditEffect(db,{type:'credit_effect',reference:consume},meta);db.facts.exceptionReason='practitioner_exception';const restored=reference('restore');await applyCalendarCreditEffect(db,{type:'credit_effect',reference:restored},{...meta,id:'10000000-0000-4000-8000-000000000098',sequence:2});expect(db.events.map(item=>[item.kind,item.blockId])).toEqual([['consume',db.blocks[0]!.id],['restore',db.blocks[0]!.id]]);expect(db.blocks[0]!.balance).toBe(4);});
 it('rejects credit effects for joint-parent check-ins',async()=>{const db=new FakeSession();db.facts.kind='parent_guidance';await expect(applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference()},meta)).rejects.toBeInstanceOf(AppError);});
 it('rejects appointment metadata mismatches',async()=>{const db=new FakeSession();await expect(applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference()},{...meta,appointmentId:'10000000-0000-4000-8000-000000000088'})).rejects.toBeInstanceOf(AppError);});
 it('acknowledges marked demo attendance without touching real credits, including replay',async()=>{const db=new FakeSession();db.demoBatch='ls-owner-20260925';const event={type:'credit_effect',reference:reference()};await applyCalendarCreditEffect(db,event,meta);await applyCalendarCreditEffect(db,event,meta);expect(db.suppressed.size).toBe(1);expect(db.events).toHaveLength(0);expect(db.receipts.size).toBe(0);expect(db.blocks[0]!.balance).toBe(4);});
 it('rejects a changed demo effect on replay',async()=>{const db=new FakeSession();db.demoBatch='ls-owner-20260925';await applyCalendarCreditEffect(db,{type:'credit_effect',reference:reference()},meta);await expect(applyCalendarCreditEffect(db,{type:'credit_effect',reference:{...reference(),occurredAt:'2026-09-11T12:01:00.000Z'}},meta)).rejects.toBeInstanceOf(AppError);});
});
