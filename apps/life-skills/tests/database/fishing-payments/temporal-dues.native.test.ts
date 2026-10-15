/** NativeClock scope only: not a job scheduler or Stripe/provider test clock. */
import { randomUUID } from 'node:crypto';
import { afterAll,expect,test } from 'vitest';
import type { Actor } from '../../../src/features/fishing/contract.ts';
import { setup,type NativeFixture } from './fixture.ts';
import { ingestSyntheticSettlement,renewNativeSession } from './recovery-support.ts';

const fixtures:NativeFixture[]=[];afterAll(async()=>{await Promise.all(fixtures.map(n=>n.pool.end()));});
const agreements=[
 {name:'January month-end through spring DST',dues:['2027-01-31T15:00:00.000Z','2027-02-28T15:00:00.000Z','2027-03-31T14:00:00.000Z'],fourthBoundary:'2027-04-30T14:00:00.000Z',offsets:['GMT-05:00','GMT-05:00','GMT-04:00']},
 {name:'October month-end through fall DST',dues:['2027-10-31T14:00:00.000Z','2027-11-30T15:00:00.000Z','2027-12-31T15:00:00.000Z'],fourthBoundary:'2028-01-31T15:00:00.000Z',offsets:['GMT-04:00','GMT-05:00','GMT-05:00']}
];
async function active(n:NativeFixture,actor:Actor){const current=await n.store.read(actor,async c=>({active:c.actor.state==='active',same:c.actor.id===actor.id,role:c.actor.role}));expect(current).toEqual({active:true,same:true,role:actor.role});}

test.each(agreements)('accepted exact3x650: $name, renewed active sessions and fourth-boundary control',async agreement=>{
 const n=await setup();fixtures.push(n);let at=new Date(agreement.dues[0]!);n.deps.clock.now=()=>new Date(at);
 let owner=await renewNativeSession(n,n.owner,at),parent=await renewNativeSession(n,n.parent,at);
 await active(n,owner);await active(n,parent);
 const offer=n.offer('installments',o=>({...o,expiresAt:new Date(at.getTime()+6*3600000).toISOString(),terms:{...o.terms,acceptedAt:new Date(at.getTime()-3600000).toISOString()},lines:o.lines.map(l=>({...l,dues:l.dues.map((d,i)=>({...d,dueAt:agreement.dues[i]!})),capacity:{...l.capacity,expiresAt:new Date(at.getTime()+12*3600000).toISOString()}}))}));
 const purchaseId=(await n.store.registerApprovedOffer(owner,randomUUID(),offer.id,offer.revision)).purchaseIds[0]!,line=offer.lines[0]!;
 expect(line.dues.map(d=>d.amountCents)).toEqual([65000,65000,65000]);
 for(const [i,due] of line.dues.entries()){
  const previousParent=parent;at=new Date(agreement.dues[i]!);
  if(i>0){owner=await renewNativeSession(n,owner,at);parent=await renewNativeSession(n,parent,at);expect(parent.sessionDigest===previousParent.sessionDigest).toBe(false);}
  await active(n,owner);await active(n,parent);
  expect(await n.store.familyView(parent,purchaseId)).toMatchObject({paidCents:i*65000});
  if(i>0)expect(at.getTime()>Date.parse(offer.expiresAt)).toBe(true);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).formatToParts(at);
  expect(parts.find(p=>p.type==='hour')?.value).toBe('10');expect(parts.find(p=>p.type==='timeZoneName')?.value).toBe(agreement.offsets[i]);
  const reserved=await n.service.beginHosted(parent,randomUUID(),purchaseId,due.id),confirmed=await n.service.executeSynthetic(parent,randomUUID(),reserved.id);
  expect(confirmed.state).toBe('confirmed');expect((await n.store.familyView(parent,purchaseId)).paidCents).toBe(i*65000);
  await ingestSyntheticSettlement(n,owner,confirmed,line.id);
  expect((await n.store.familyView(parent,purchaseId)).paidCents).toBe((i+1)*65000);expect(n.provider.calls).toBe(i+1);
 }
 // A fresh independent native session is a positive control at the fourth date.
 const expiredSession=parent;at=new Date(agreement.fourthBoundary);owner=await renewNativeSession(n,owner,at);parent=await renewNativeSession(n,parent,at);
 await expect(n.store.familyView(expiredSession,purchaseId)).rejects.toThrow();
 await active(n,owner);await active(n,parent);
 expect(await n.store.familyView(parent,purchaseId)).toMatchObject({state:'paid',paidCents:195000,enrollmentGranted:false});
 await expect(n.service.beginHosted(parent,randomUUID(),purchaseId,'nonexistent_fourth_due')).rejects.toThrow('WRONG_DUE');
 await expect(n.service.beginHosted(parent,randomUUID(),purchaseId,line.dues[2]!.id)).rejects.toThrow('DUE_ALREADY_PAID');
 expect((await n.store.readPayment(owner,purchaseId))!.dues).toHaveLength(3);expect(await n.count('operations')).toBe(3);expect(await n.count('purchases')).toBe(1);expect(n.provider.calls).toBe(3);
});
