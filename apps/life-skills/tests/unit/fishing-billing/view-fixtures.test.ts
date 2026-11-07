import {it,expect} from 'vitest';
import {balanceSchema,familyOfferSchema} from '../../../src/features/fishing-billing/contracts.ts';
import {serializedBillingViewFixtures,type SyntheticBillingView} from '../../../src/features/fishing-billing/view-fixtures.ts';
it('serializes complete truthful owner view states with runtime-valid money/quote snapshots',()=>{
 const fixture=JSON.parse(serializedBillingViewFixtures()) as {syntheticOnly:boolean;views:Record<string,SyntheticBillingView>};
 expect(fixture.syntheticOnly).toBe(true);
 for(const view of Object.values(fixture.views)){
  const data=view.state==='ready'?view.data:view.state==='conflict'?view.current:null;
  if(data){familyOfferSchema.parse(data.quote);balanceSchema.parse(data.balance);expect(data.quote.id).toBe(data.balance.quoteId);expect(data.quote.revision).toBe(data.balance.revision);}
 }
 expect(fixture.views.unknownOperation).toMatchObject({state:'unknown',nextAction:'read_operation_then_refresh_balance'});
 expect(fixture.views.failedCard).toMatchObject({cardState:'failed',data:{balance:{state:'unpaid',paidMinor:0}}});
 expect(fixture.views.reversal).toMatchObject({data:{balance:{paidMinor:10000,remainingMinor:120000}}});
 expect(fixture.views.paused).toMatchObject({data:{balance:{paused:true}}});
 expect(fixture.views.cancelled).toMatchObject({data:{balance:{cancelled:true,dueMinor:130000}}});
});
