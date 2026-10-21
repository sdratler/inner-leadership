import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {approvedOffer,initialPayment,settled,familyPayment,POLICY_VERSION,type SettlementFact} from '../../../src/features/fishing-payments/domain.ts';
import {owner03PolicyVersion} from '../../../src/features/fishing-payments/owner03-policy.ts';
import {offerFixture,merchant} from './fixture.ts';

// Synthetic saved-offer representation only; actual native approval/acceptance
// and occurrence membership must still be reloaded by the authority adapter.
function rawBlock(){
 const offer=offerFixture(),line=offer.lines[0]!;
 return {...offer,policyVersion:owner03PolicyVersion,lines:[{...line,mode:'monthly_block',sessions:4,totalCents:65000,discountBasis:'monthly_block_full_rate',
  eligibility:{...line.eligibility,policyVersion:owner03PolicyVersion},
  block:{id:randomUUID(),acceptanceId:randomUUID(),occurrenceIds:Array.from({length:4},()=>randomUUID())},
  dues:[{...line.dues[0]!,index:1,amountCents:65000}]}]};
}

test('a block is one four-lesson purchase and one650-dollar due, not a stage obligation',()=>{
 const raw=rawBlock(),offer=approvedOffer(raw),line=offer.lines[0]!;
 expect(line).toMatchObject({mode:'monthly_block',sessions:4,totalCents:65000});
 expect(line.dues.map(d=>[d.index,d.amountCents])).toEqual([[1,65000]]);
 expect(line.mode==='monthly_block'&&line.block.occurrenceIds).toEqual(raw.lines[0]!.block.occurrenceIds);
 raw.lines[0]!.block.occurrenceIds[0]=randomUUID();
 expect(line.mode==='monthly_block'&&line.block.occurrenceIds).not.toEqual(raw.lines[0]!.block.occurrenceIds);
});

test('four unique occurrences and a separate acceptance reference are mandatory',()=>{
 const o=rawBlock(),l=o.lines[0]!;
 for(const block of [undefined,{...l.block,acceptanceId:undefined},{...l.block,occurrenceIds:l.block.occurrenceIds.slice(0,3)},{...l.block,occurrenceIds:[...l.block.occurrenceIds,randomUUID()]},{...l.block,occurrenceIds:Array(4).fill(l.block.occurrenceIds[0])}]){
  expect(()=>approvedOffer({...o,lines:[{...l,block}]})).toThrow();
 }
});

test('old policy, twelve lessons, future dues, discounts and automatic-renewal fields cannot describe a new block',()=>{
 const o=rawBlock(),l=o.lines[0]!;
 const bad=[
  {...o,policyVersion:POLICY_VERSION,lines:[{...l,eligibility:{...l.eligibility,policyVersion:POLICY_VERSION}}]},
  {...o,lines:[{...l,sessions:12}]},
  {...o,lines:[{...l,totalCents:195000}]},
  {...o,lines:[{...l,totalCents:55000,dues:[{...l.dues[0]!,amountCents:55000}]}]},
  {...o,lines:[{...l,discountBasis:'ordinary_sibling_prepay',eligibility:{...l.eligibility,kind:'verified_sibling'}}]},
  {...o,lines:[{...l,dues:[...l.dues,{...l.dues[0]!,id:randomUUID(),index:2}]}]},
  {...o,lines:[{...l,automaticRenewal:true}]},
  {...o,lines:[{...l,block:{...l.block,nextBlockId:randomUUID()}}]},
 ];
 for(const value of bad)expect(()=>approvedOffer(value)).toThrow();
});

test('legacy three-dues snapshots stay historical and cannot be relabelled as Owner03',()=>{
 const historical=offerFixture('installments'),line=historical.lines[0]!;
 expect(approvedOffer(historical)).toEqual(historical);
 expect(line).toMatchObject({mode:'installments',sessions:12,totalCents:195000});
 expect('block' in line).toBe(false);
 expect(()=>approvedOffer({...historical,policyVersion:owner03PolicyVersion,lines:[{...line,eligibility:{...line.eligibility,policyVersion:owner03PolicyVersion}}]})).toThrow('RETIRED_INSTALLMENT_POLICY');
 expect(()=>approvedOffer({...historical,lines:[{...line,block:rawBlock().lines[0]!.block}]})).toThrow();
});

test('a settled block exposes only650 dollars and its one due to the family',()=>{
 const offer=approvedOffer(rawBlock()),line=offer.lines[0]!,purchaseId=randomUUID(),state=initialPayment(offer,line,purchaseId,merchant);
 const at=new Date().toISOString(),fact:SettlementFact={canonicalTransactionId:'pi_synthetic_block',providerReceiptId:'evt_synthetic_block',relatedProviderObjectId:'in_synthetic_block',operationId:randomUUID(),purchaseId,purchaseLineId:line.id,dueId:line.dues[0]!.id,providerAccountId:merchant.accountId,livemode:false,currency:'USD',kind:'payment',cents:65000,feeCents:null,originalPaymentId:null,occurredAt:at};
 const paid=settled(state,[fact],at),view=familyPayment(paid);
 expect(view).toMatchObject({totalCents:65000,paidCents:65000,state:'paid',enrollmentGranted:false});
 expect(view.dues).toHaveLength(1);
 expect(()=>settled(state,[{...fact,dueId:randomUUID()}],at)).toThrow('WRONG_DUE');
 expect(JSON.stringify(view)).not.toMatch(/acct_synthetic|acceptanceId|occurrenceIds/);
});
