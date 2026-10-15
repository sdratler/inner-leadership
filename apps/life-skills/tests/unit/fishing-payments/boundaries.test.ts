import { createHmac } from 'node:crypto';
import { expect,test } from 'vitest';
import { approvedOffer,initialPayment,settled,withdrawalProposal,familyPayment,type SettlementFact } from '../../../src/features/fishing-payments/domain.ts';
import { verifySyntheticStripe } from '../../../src/features/fishing-payments/receipts.ts';
import { offerFixture,merchant } from './fixture.ts';

test('server snapshot rejects forged price, currency, stage discount and fourth due',()=>{
 const o=offerFixture(),l=o.lines[0]!;
 for(const bad of [{...o,currency:'ILS'},{...o,lines:[{...l,totalCents:165000}]},{...o,lines:[{...l,stage:2,discountBasis:'founder_initial_primary_prepay',eligibility:{...l.eligibility,kind:'verified_founder'},totalCents:165000}]},{...o,lines:[{...l,dues:[...l.dues,...l.dues,...l.dues,...l.dues]}]}])expect(()=>approvedOffer(bad)).toThrow();
});
test.each([['ordinary_primary_prepay',175000,'ordinary'],['ordinary_sibling_prepay',165000,'verified_sibling'],['founder_initial_primary_prepay',165000,'verified_founder'],['founder_initial_sibling_prepay',155000,'verified_founder']] as const)('approved price %s is exact', (discountBasis,totalCents,kind)=>{
 const o=offerFixture(),l=o.lines[0]!;expect(approvedOffer({...o,lines:[{...l,totalCents,discountBasis,eligibility:{...l.eligibility,kind},dues:[{...l.dues[0],amountCents:totalCents}]}]}).lines[0]!.totalCents).toBe(totalCents);
});
test('one child has exactly three agreed dues; caller mutation cannot alter validated snapshot',()=>{const o=offerFixture('installments'),copy=approvedOffer(o);expect(copy.lines[0]!.dues.map(d=>[d.index,d.amountCents])).toEqual([[1,65000],[2,65000],[3,65000]]);expect(copy.lines[0]!.totalCents).toBe(195000);expect(copy).not.toBe(o);});
test.each([[175000,125833],[165000,117500],[155000,109167]])('two actually attended, aggregate rounding at %s', (price,refund)=>{expect(withdrawalProposal(price,2,'prepay','voluntary',false)).toMatchObject({administrationCents:20000,refundCents:refund});expect(withdrawalProposal(price,1,'prepay','voluntary',false)).toMatchObject({administrationCents:0});});
test('unselected terms stay unavailable and operator nondelivery is distinct',()=>{expect(withdrawalProposal(175000,3,'prepay','voluntary',false).status).toBe('POLICY_REQUIRED');expect(withdrawalProposal(195000,1,'installments','voluntary',false).status).toBe('POLICY_REQUIRED');expect(withdrawalProposal(175000,0,'prepay','voluntary',true).status).toBe('POLICY_REQUIRED');expect(withdrawalProposal(175000,0,'prepay','operator',false).status).toBe('OPERATOR_REVIEW');});
test('signature binds exact bytes, timestamp, account, API version and test mode',()=>{
 const now=new Date(),time=Math.floor(now.getTime()/1000),secret='whsec_synthetic_fixture';const make=(overrides:object={})=>Buffer.from(JSON.stringify({id:'evt_synthetic',object:'event',type:'checkout.session.completed',account:merchant.accountId,livemode:false,api_version:merchant.apiVersion,created:time,data:{object:{id:'cs_synthetic'}},...overrides}));
 const sign=(raw:Buffer,t=time)=>`t=${t},v1=${createHmac('sha256',secret).update(`${t}.`).update(raw).digest('hex')}`;
 const raw=make();expect(verifySyntheticStripe(raw,sign(raw),secret,merchant,now).objectId).toBe('cs_synthetic');
 expect(()=>verifySyntheticStripe(Buffer.concat([raw,Buffer.from(' ')]),sign(raw),secret,merchant,now)).toThrow('INVALID_SIGNATURE');expect(()=>verifySyntheticStripe(raw,sign(raw,time-301),secret,merchant,now)).toThrow('SIGNATURE_TIME');
 for(const fields of [{livemode:true},{account:'acct_wrong'},{api_version:'wrong'}]){const body=make(fields);expect(()=>verifySyntheticStripe(body,sign(body),secret,merchant,now)).toThrow('EVENT_BINDING');}
 expect(()=>verifySyntheticStripe(raw,`${sign(raw)},t=${time}`,secret,merchant,now)).toThrow('INVALID_SIGNATURE');
});
test('settlements require exact purchase/merchant/due and cannot regress settled dues',()=>{
 const o=offerFixture('installments'),l=o.lines[0]!,p=initialPayment(o,l,'purchase-synthetic',merchant);
 const fact:SettlementFact={canonicalTransactionId:'pi_1',operationId:'op_1',providerReceiptId:'evt_1',relatedProviderObjectId:'in_1',purchaseId:p.purchaseId,purchaseLineId:l.id,dueId:l.dues[0]!.id,providerAccountId:merchant.accountId,livemode:false,currency:'USD',kind:'payment',cents:65000,feeCents:null,originalPaymentId:null,occurredAt:new Date().toISOString()};
 const next=settled(p,[fact],new Date().toISOString());expect(next.state).toBe('part_paid');expect(next.dues[0]!.state).toBe('paid');expect(next.feesCents).toBeNull();expect(()=>settled(next,[fact],new Date().toISOString())).toThrow('DUPLICATE_FACT');expect(()=>settled(p,[{...fact,providerAccountId:'wrong'}],new Date().toISOString())).toThrow('SETTLEMENT_BINDING');expect(()=>settled(p,[{...fact,kind:'refund',originalPaymentId:'pi_missing'}],new Date().toISOString())).toThrow('REFUND_REQUIRES_PAYMENT');
 const view=JSON.stringify(familyPayment(next));expect(view).not.toContain('acct_synthetic');expect(view).not.toContain('pi_1');expect(view).toContain('enrollmentGranted');
});
