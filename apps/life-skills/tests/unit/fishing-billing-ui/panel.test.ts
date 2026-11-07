import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OwnerBillingPanel,WorkflowNotice,type OwnerBillingPanelProps} from '../../../src/features/fishing-billing-ui/owner-billing-panel.tsx';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {serializedBillingViewFixtures} from '../../../src/features/fishing-billing/view-fixtures.ts';
import {syntheticId} from '../../../src/features/fishing-billing/fixtures.ts';
import {BILLING_DTO_V2} from '../../../src/features/fishing-billing/contracts-v2.ts';
import {syntheticDateCashFixtures} from '../../../src/features/fishing-billing/fixtures-v2.ts';
import {dataScope,sameScope,type BillingView,type BillingUiPorts} from '../../../src/features/fishing-billing-ui/model.ts';
const views=(JSON.parse(serializedBillingViewFixtures()) as {views:Record<string,BillingView>}).views;
for(const v of Object.values(views)){if(v.state==='ready')v.data.balance.version=BILLING_DTO_V2;else if(v.state==='conflict')v.current.balance.version=BILLING_DTO_V2;}
const mixed=syntheticDateCashFixtures();views.twoChildPartial={state:'ready',data:{quote:mixed.quote,balance:mixed.balance}};
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
it('renders mixed date-only and legacy instant history without a fabricated receipt time',()=>{
 for(const locale of ['en','he'] as const){
  const html=render(views.twoChildPartial!,{locale});
  expect(html).toContain('<time dateTime="2035-01-05">2035-01-05</time>');
  expect(html).toContain('dateTime="2035-01-06T15:00:00Z"');
  expect(html).toContain('dateTime="2035-01-02T15:00:00.000Z"');
  expect(html).not.toContain('2035-01-05T');
  expect(html).toContain(locale==='he'?'שעת הקבלה לא נרשמה':'receipt time not recorded');
 }
});
it('fails closed for an unupgraded V1 balance rather than mixing command versions',()=>{
 const old=(JSON.parse(serializedBillingViewFixtures()) as {views:Record<string,BillingView>}).views.twoChildPartial!;
 expect(render(old)).toContain('Billing data unavailable');expect(render(old)).not.toContain('Correct cash entry');
});
it('suppresses settled/conflict feedback outside the full family and workspace scope',()=>{
 const data=(views.twoChildPartial! as Extract<BillingView,{state:'ready'}>).data;
 const scope=dataScope(data),command={version:BILLING_DTO_V2,receivedPrecision:'date' as const,receivedDate:'2035-01-02',timeZone:'America/New_York' as const,operationId:syntheticId(800),quoteId:data.quote.id,expectedVersion:data.balance.revision,amountMinor:100,currency:'USD' as const,allocations:[{lineId:data.quote.lines[0]!.id,amountMinor:100}]};
 const receipt={version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_V2,operationId:command.operationId,entityId:data.quote.id,entityVersion:4,replayed:false,result:{...data,receiptId:syntheticId(850)}};
 for(const other of [{...scope,familyId:syntheticId(998)},{...scope,workspaceId:syntheticId(999)}])for(const phase of ['confirmed','conflict'] as const){
  const html=renderToStaticMarkup(createElement(WorkflowNotice,{flow:{scope,kind:'cash',command,phase,data,receipt},workflow:new BillingWorkflow(null),locale:'en',showDetails:sameScope(scope,other)}));
  expect(html).toBe('');
 }
});
it('uses neutral cross-context unknown feedback without receipt or family details',async()=>{
 const data=(views.twoChildPartial! as Extract<BillingView,{state:'ready'}>).data;
 const p:BillingUiPorts={recordCashDate:async()=>({kind:'unknown'}),reverseCash:async()=>({kind:'unknown'}),readOperation:async()=>null,readBalance:async()=>data,nextOperationId:()=>syntheticId(800)};
 const w=new BillingWorkflow(p),command={version:BILLING_DTO_V2,receivedPrecision:'date' as const,receivedDate:'2035-01-02',timeZone:'America/New_York' as const,operationId:syntheticId(800),quoteId:data.quote.id,expectedVersion:data.balance.revision,amountMinor:100,currency:'USD' as const,allocations:[{lineId:data.quote.lines[0]!.id,amountMinor:100}]};
 await w.submit('cash',command,data);
 const html=renderToStaticMarkup(createElement(WorkflowNotice,{flow:w.getSnapshot(),workflow:w,locale:'en',showDetails:false}));
 expect(html).toContain('Earlier operation needs verification');expect(html).not.toContain(command.operationId);expect(html).not.toContain('Recorded');
});
