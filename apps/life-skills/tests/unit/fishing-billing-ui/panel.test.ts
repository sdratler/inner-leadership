import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OwnerBillingPanel,type OwnerBillingPanelProps} from '../../../src/features/fishing-billing-ui/owner-billing-panel.tsx';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {serializedBillingViewFixtures} from '../../../src/features/fishing-billing/view-fixtures.ts';
import {syntheticId} from '../../../src/features/fishing-billing/fixtures.ts';
import type {BillingView} from '../../../src/features/fishing-billing-ui/model.ts';
const views=(JSON.parse(serializedBillingViewFixtures()) as {views:Record<string,BillingView>}).views;
const subject={familyId:syntheticId(4),label:'SYNTHETIC family',children:[{id:syntheticId(20),name:'SYNTHETIC Ari'},{id:syntheticId(21),name:'SYNTHETIC Noam'}]};
function render(view:BillingView,extra:Partial<OwnerBillingPanelProps>={}){return renderToStaticMarkup(createElement(OwnerBillingPanel,{locale:'en',view,subject,workflow:new BillingWorkflow(null),...extra}));}
it('renders both children/periods and server balances with inactive money controls by default',()=>{
 const html=render(views.twoChildPartial!);expect(html).toContain('SYNTHETIC Ari');expect(html).toContain('SYNTHETIC Noam');expect(html).toContain('450.00');expect(html).toContain('disabled=""');expect(html).toContain('Test environment');
});
it('uses the current authenticated receipt list and denies mismatched history',()=>{
 expect(render(views.twoChildPartial!)).toContain('Correct cash entry');
 const bad=structuredClone(views.twoChildPartial!) as Extract<BillingView,{state:'ready'}>;
 bad.data.balance.receipts[0]!.familyId=syntheticId(999);
 const html=render(bad);expect(html).toContain('Authenticated receipt history is unavailable');expect(html).not.toContain('Correct cash entry');
});
it('shows no debt and missing-policy reasons without inventing a due date',()=>{
 const html=render(views.policyNotReady!);expect(html).toContain('No payment obligation');expect(html).toContain('Renewal policy');expect(html).toContain('Payment date not approved');
});
it('does not render private amounts/family labels on forbidden, unknown or malformed input',()=>{
 for(const v of [views.forbiddenCrossFamily!,views.unknownOperation!,{state:'ready',data:null} as unknown as BillingView]){
  const html=render(v);expect(html).not.toContain('SYNTHETIC family');expect(html).not.toContain('650.00');expect(html).not.toContain('Children &amp; service periods');
 }
});
it('rejects a mismatched family presentation before rendering another family snapshot',()=>{
 const html=render(views.twoChildPartial!,{subject:{...subject,familyId:syntheticId(999)}});expect(html).toContain('Billing data unavailable');expect(html).not.toContain('SYNTHETIC Ari');
});
it('retains truthful cancelled, failed-card and conflict presentation',()=>{
 expect(render(views.cancelled!)).toContain('no refund or debt write-off');expect(render(views.failedCard!)).toContain('no payment confirmed');expect(render(views.stale!)).toContain('Balance changed');
});
it('renders Hebrew direction and labels without changing the saved parent data',()=>{
 const html=render(views.twoChildPartial!,{locale:'he'});expect(html).toContain('dir="rtl"');expect(html).toContain('תשלומי המשפחה');expect(html).toContain('SYNTHETIC Noam');expect(html).toContain('<bdi>');
});
