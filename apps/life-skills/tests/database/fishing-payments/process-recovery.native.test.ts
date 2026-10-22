import { randomUUID } from 'node:crypto';
import { afterAll,expect,test } from 'vitest';
import { setup,type NativeFixture } from './fixture.ts';
import { ingestSyntheticSettlement,runRecoveryChild } from './recovery-support.ts';
import type { ApprovedOffer } from '../../../src/features/fishing/contract.ts';

const fixtures:NativeFixture[]=[];afterAll(async()=>{await Promise.all(fixtures.map(n=>n.pool.end()));});
async function fixture(){const n=await setup();fixtures.push(n);return n;}
function proof(o:ApprovedOffer){return {offerId:o.id,workspaceId:o.workspaceId,payerId:o.payerAccountId,operatorId:o.operatorAccountId,learnerId:o.lines[0]!.learnerId,eligibilityEvidenceId:o.lines[0]!.eligibility.evidenceId};}

test('separate process recovers UNKNOWN hosted invoice without another create or cash from result',async()=>{
 const n=await fixture(),p=await n.issue(),line=p.offer.lines[0]!;
 const reserved=await n.service.beginHosted(n.parent,randomUUID(),p.purchaseId,line.dues[0]!.id),startKey=randomUUID();
 n.provider.loseResponse=true;
 const unknown=await n.service.executeSynthetic(n.parent,startKey,reserved.id);
 expect(unknown.state).toBe('unknown');expect(n.provider.calls).toBe(1);
 const matchingResult=n.provider.results.get(unknown.idempotencyKey);if(!matchingResult)throw Error('SYNTHETIC_EXTERNAL_RESULT_MISSING');
 const child=await runRecoveryChild({actor:n.parent,operationId:unknown.id,originalStartKey:startKey,matchingResult,proof:proof(p.offer),withdrawal:null});
 expect(Number.isInteger(child.pid)&&child.pid!==process.pid).toBe(true);
 expect(child).toMatchObject({initialUnknown:true,retriesUnknown:true,createCalls:0,readbackMismatchRejected:true,resolved:true,dispatchCount:1,cashBefore:{paidCents:0,refundedCents:0},cashAfter:{paidCents:0,refundedCents:0}});
 expect(n.provider.calls).toBe(1);expect(await n.count('operations')).toBe(1);expect(await n.count('settlements')).toBe(0);
 const confirmed=await n.service.reconcileOperation(n.parent,randomUUID(),unknown.id);
 expect(confirmed.state).toBe('confirmed');expect((await n.store.familyView(n.parent,p.purchaseId)).paidCents).toBe(0);
 await ingestSyntheticSettlement(n,n.owner,confirmed,line.id);
 expect(await n.store.familyView(n.parent,p.purchaseId)).toMatchObject({paidCents:175000,refundedCents:0,state:'paid',enrollmentGranted:false});
 expect(await n.count('settlements')).toBe(1);expect(n.provider.calls).toBe(1);
});

test('separate process recovers UNKNOWN approved refund without another create or cash from result',async()=>{
 const n=await fixture(),p=await n.issue(),line=p.offer.lines[0]!;
 const hosted=await n.service.beginHosted(n.parent,randomUUID(),p.purchaseId,line.dues[0]!.id),paidOperation=await n.service.executeSynthetic(n.parent,randomUUID(),hosted.id);
 await ingestSyntheticSettlement(n,n.owner,paidOperation,line.id);
 const preview=await n.service.refundPreview(n.owner,p.purchaseId),reserved=await n.service.approveRefund(n.owner,randomUUID(),p.purchaseId,preview.token!),startKey=randomUUID();
 n.provider.loseResponse=true;
 const unknown=await n.service.executeSynthetic(n.owner,startKey,reserved.id);
 expect(unknown.state).toBe('unknown');expect(n.provider.calls).toBe(2);
 const matchingResult=n.provider.results.get(unknown.idempotencyKey);if(!matchingResult)throw Error('SYNTHETIC_EXTERNAL_RESULT_MISSING');
 const withdrawal=await n.store.read(n.owner,c=>n.authority.withdrawalFacts(c.tx,c.actor,p.offer,line));
 const child=await runRecoveryChild({actor:n.owner,operationId:unknown.id,originalStartKey:startKey,matchingResult,proof:proof(p.offer),withdrawal});
 expect(Number.isInteger(child.pid)&&child.pid!==process.pid).toBe(true);
 expect(child).toMatchObject({initialUnknown:true,retriesUnknown:true,createCalls:0,readbackMismatchRejected:true,resolved:true,dispatchCount:1,cashBefore:{paidCents:175000,refundedCents:0},cashAfter:{paidCents:175000,refundedCents:0}});
 expect(n.provider.calls).toBe(2);expect(await n.count('operations')).toBe(2);expect(await n.count('settlements')).toBe(1);
 const confirmed=await n.service.reconcileOperation(n.owner,randomUUID(),unknown.id);
 expect(confirmed.state).toBe('confirmed');expect((await n.store.familyView(n.parent,p.purchaseId)).refundedCents).toBe(0);
 await ingestSyntheticSettlement(n,n.owner,confirmed,line.id,'refund');
 expect(await n.store.familyView(n.parent,p.purchaseId)).toMatchObject({paidCents:175000,refundedCents:125833,state:'refund_recorded',enrollmentGranted:false});
 expect(await n.count('settlements')).toBe(2);expect(n.provider.calls).toBe(2);
});
