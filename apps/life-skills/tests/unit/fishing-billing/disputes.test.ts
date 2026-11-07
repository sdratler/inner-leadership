import {it,expect} from 'vitest';
import {syntheticDisputeFixture,syntheticDisputeViewFixtures} from '../../../src/features/fishing-billing/dispute-fixtures-v1.ts';
import {planDisputeReconciliation,projectDisputeBalance,type BillingDisputeAllocationAuthority} from '../../../src/features/fishing-billing/disputes.ts';
import {syntheticId} from '../../../src/features/fishing-billing/fixtures.ts';
import {syntheticReceipt} from '../../../src/features/fishing-billing/fixtures.ts';
import {disputeFactsSchema,disputeReconciliationPlanSchema,type DisputeAdjustment,type DisputeFacts,type DisputeMovement} from '../../../src/features/fishing-billing/dispute-contracts-v1.ts';
function scenario(){const f=syntheticDisputeFixture();let id=750;return {...f,history:[] as DisputeAdjustment[],newId:()=>syntheticId(id++)};}
const allocations:BillingDisputeAllocationAuthority={resolve:async({movement,history})=>({
 allocations:[{lineId:syntheticId(10),amountMinor:movement.principalMinor!}],
 evidence:{id:'SYNTHETIC-NATIVE-ALLOCATION-NOT-APPROVAL',sha256:'d'.repeat(64)},
 withdrawalAdjustmentId:movement.direction==='withdrawal'?null:history.find(a=>a.kind==='dispute_withdrawal'&&a.disputeId===movement.sourceDisputeId)!.id,
})};
it('round-trips strict additive view fixtures without changing the existing billing DTO shape',async()=>{
 const f=JSON.parse(JSON.stringify(await syntheticDisputeViewFixtures()));expect(f.syntheticOnly).toBe(true);
 for(const value of [f.withdrawn,f.reinstated,f.unresolved])expect(disputeReconciliationPlanSchema.parse(value)).toEqual(value);
 expect(f.withdrawn.balance.paidMinor).toBe(65000);expect(f.reinstated.balance.paidMinor).toBe(85000);
 expect(f.unresolved).toMatchObject({state:'review_required',additions:[]});
});
it('deducts verified principal, retains a distinct withdrawal/history and excludes processor fees from family debt',async()=>{
 const f=scenario(),before=JSON.stringify(f.receipts),r=await planDisputeReconciliation(f,allocations);
 expect(r.state).toBe('ready');expect(r.additions).toHaveLength(1);
 expect(r.additions[0]).toMatchObject({kind:'dispute_withdrawal',originalReceiptId:f.paymentBinding.originalReceiptId,withdrawalAdjustmentId:null});
 expect(r.additions[0]).not.toHaveProperty('kind','card');
 expect(r.balance).toMatchObject({dueMinor:130000,paidMinor:65000,remainingMinor:65000,processorFeeMinor:1500,collectionState:'held_pending_native_adoption'});
 expect(JSON.stringify(f.receipts)).toBe(before);
});
it('reconciles reinstatement before webhook withdrawal arrival from a complete read, then replays without duplicate money',async()=>{
 const f=scenario(),facts={...f.facts,status:'won' as const,movements:[f.reinstatement,f.withdrawal]},r=await planDisputeReconciliation({...f,facts},allocations);
 expect(r.state).toBe('ready');expect(r.additions.map(a=>a.kind)).toEqual(['dispute_withdrawal','dispute_reinstatement']);
 expect(r.additions[1]!.withdrawalAdjustmentId).toBe(r.additions[0]!.id);
 expect(r.balance).toMatchObject({paidMinor:85000,remainingMinor:45000,processorFeeMinor:1000});
 const replay=await planDisputeReconciliation({...f,history:r.additions,facts:{...facts,sourceEventId:'evt_ANOTHER_SIGNED_EVENT'}},allocations);
 expect(replay.state).toBe('ready');expect(replay.additions).toHaveLength(0);expect(replay.balance).toEqual(r.balance);
});
it('preserves overpayment after cash arrives during a dispute and actual principal is reinstated',async()=>{
 const f=scenario(),cash=syntheticReceipt('cash',10,65000,800),facts={...f.facts,status:'won' as const,movements:[f.withdrawal,f.reinstatement]};
 const r=await planDisputeReconciliation({...f,receipts:[...f.receipts,cash],facts},allocations);
 expect(r.state).toBe('ready');expect(r.balance).toMatchObject({paidMinor:150000,remainingMinor:45000,excessMinor:65000,financialState:'overpaid'});
});
it.each(['won','lost','needs_response'] as const)('never creates a money movement from %s status alone',async status=>{
 const f=scenario(),r=await planDisputeReconciliation({...f,facts:{...f.facts,status,movements:[]}},allocations);
 expect(r).toMatchObject({state:'review_required',reason:'dispute_movements_not_observed',additions:[]});expect(r.balance.paidMinor).toBe(85000);
});
it('keeps a no-movement closed inquiry separate from financial movements',async()=>{
 const f=scenario(),r=await planDisputeReconciliation({...f,facts:{...f.facts,status:'warning_closed',movements:[]}},null);
 expect(r).toMatchObject({state:'ready',additions:[]});expect(r.balance.paidMinor).toBe(85000);
});
it('holds missing native allocation or ambiguous principal/fees without partial additions',async()=>{
 const f=scenario();expect(await planDisputeReconciliation(f,null)).toMatchObject({state:'review_required',reason:'native_allocation_required',additions:[]});
 for(const change of [{principalMinor:null},{feeMinor:null},{netMinor:-999},{grossMinor:20000}]){
  const r=await planDisputeReconciliation({...f,facts:{...f.facts,movements:[{...f.withdrawal,...change}]}},allocations);
  expect(r).toMatchObject({state:'review_required',reason:'principal_fee_fact_unresolved',additions:[]});
 }
});
it('requires an actual linked withdrawal before reinstatement and rejects native cross-child allocations',async()=>{
 const f=scenario(),restored={...f.facts,status:'won' as const,movements:[f.reinstatement]};
 const missing:BillingDisputeAllocationAuthority={resolve:async({movement})=>({allocations:[{lineId:syntheticId(10),amountMinor:movement.principalMinor!}],evidence:f.allocationEvidence,withdrawalAdjustmentId:syntheticId(999)})};
 expect(await planDisputeReconciliation({...f,facts:restored},missing)).toMatchObject({state:'review_required',reason:'allocation_or_movement_conflict',additions:[]});
 const wrong:BillingDisputeAllocationAuthority={resolve:async()=>({allocations:[{lineId:syntheticId(11),amountMinor:20000}],evidence:f.allocationEvidence,withdrawalAdjustmentId:null})};
 expect(await planDisputeReconciliation(f,wrong)).toMatchObject({state:'review_required',reason:'allocation_or_movement_conflict',additions:[]});
});
it('holds conflicting movement identity, incomplete reads and disappearing provider history',async()=>{
 const f=scenario(),first=await planDisputeReconciliation(f,allocations);
 for(const change of [
  {movementCoverage:'unknown' as const},
  {movements:[]},
  {movements:[{...f.withdrawal,principalMinor:19000,grossMinor:-19000,netMinor:-20500}]},
 ]){
  const r=await planDisputeReconciliation({...f,history:first.additions,facts:{...f.facts,...change}},allocations);
  expect(r.state).toBe('review_required');expect(r.additions).toHaveLength(0);expect(r.balance.paidMinor).toBe(65000);
 }
});
it.each([
 ['account',{binding:{...scenario().facts.binding,accountId:'acct_OTHER'}}],
 ['binding',{binding:{...scenario().facts.binding,verifiedBindingId:'OTHER'}}],
 ['quote',{quoteId:syntheticId(998)}],['attempt',{attemptId:syntheticId(998)}],
 ['payment',{paymentIntentId:'pi_OTHER'}],['charge',{chargeId:'ch_OTHER'}],
] as const)('holds mismatched %s facts',async(_name,change)=>{
 const f=scenario(),r=await planDisputeReconciliation({...f,facts:{...f.facts,...change}},allocations);
 expect(r).toMatchObject({state:'review_required',reason:'payment_scope_mismatch',additions:[]});
});
it('rejects live/FX/wrong-currency facts at the additive boundary',()=>{
 const f=scenario();for(const change of [{binding:{...f.facts.binding,livemode:true}},{currency:'ILS'},{movements:[{...f.withdrawal,exchangeRate:1.2}]}])expect(disputeFactsSchema.safeParse({...f.facts,...change}).success).toBe(false);
});
it('rejects duplicate adjustments or duplicate underlying movement identity in stored projection',async()=>{
 const f=scenario(),r=await planDisputeReconciliation(f,allocations),a=r.additions[0]!;
 expect(()=>projectDisputeBalance(f.quote,f.receipts,[a,a])).toThrow('UNAVAILABLE');
 expect(()=>projectDisputeBalance(f.quote,f.receipts,[a,{...a,id:syntheticId(999)}])).toThrow('UNAVAILABLE');
});
it('holds amount, future, direction, orphan and duplicate-movement ambiguity',async()=>{
 const f=scenario();const changes:Partial<DisputeFacts>[]=[
  {disputedMinor:66000},{observedAt:'2035-01-07T15:00:00Z'},
  {movements:[{...f.withdrawal,occurredAt:'2035-01-07T15:00:00Z'}]},
  {movements:[{...f.withdrawal,sourceDisputeId:'du_OTHER'}]},
  {movements:[f.withdrawal,f.withdrawal]},
 ];
 for(const change of changes)expect(await planDisputeReconciliation({...f,facts:{...f.facts,...change}},allocations)).toMatchObject({state:'review_required',additions:[]});
});
it('conserves original principal across a refund and separate dispute without erasing either history',async()=>{
 const f=scenario(),original=f.receipts.find(r=>r.kind==='card')!;
 const refund={...syntheticReceipt('card',10,50000,801),kind:'refund' as const,originalReceiptId:original.id,reason:'SYNTHETIC verified refund',provider:{accountId:f.paymentBinding.binding.accountId,mode:'test' as const,transactionId:'re_SYNTHETIC'}};
 const r=await planDisputeReconciliation({...f,receipts:[...f.receipts,refund]},allocations);
 expect(r).toMatchObject({state:'review_required',reason:'allocation_or_movement_conflict',additions:[]});expect(r.balance.paidMinor).toBe(35000);
});
it('does not over-restore or redirect the original native withdrawal allocation',async()=>{
 const f=scenario(),r=await planDisputeReconciliation(f,allocations);
 const amount=21000,movement:DisputeMovement={...f.reinstatement,principalMinor:amount,grossMinor:amount,netMinor:amount-f.reinstatement.feeMinor!};
 expect(await planDisputeReconciliation({...f,history:r.additions,facts:{...f.facts,disputedMinor:amount,movements:[f.withdrawal,movement]}},allocations)).toMatchObject({state:'review_required',reason:'allocation_or_movement_conflict',additions:[]});
});
