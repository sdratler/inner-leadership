import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {ServiceOwnerBillingPanelV4} from '../../src/features/fishing-billing-ui/service-owner-panel-v4.tsx';
import {ServiceOwnerPanelStateV4} from '../../src/features/fishing-billing-ui/service-owner-panel-state-v4.ts';
import {createFishingBillingOwnerClientV4,prepareServiceOwnerOperationV4} from '../../src/lib/fishing-billing-owner-client-v4.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {prepareServiceOwnerReversalV4} from '../../src/features/fishing-billing-ui/service-owner-model-v4.ts';
import {serviceOwnerUiFixtureV4,serviceOwnerConfirmedFixtureV4,serviceUiIdV4} from '../fixtures/fishing-service-owner-ui-v4.ts';
const network=vi.fn(()=>{throw Error('NO_REAL_NETWORK');});
beforeEach(()=>vi.stubGlobal('fetch',network));
afterEach(()=>{try{expect(network).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}});
const render=(store:ServiceOwnerPanelStateV4,locale:'en'|'he'='en')=>renderToStaticMarkup(createElement(ServiceOwnerBillingPanelV4,{store,locale}));
function setup(){
 const f=serviceOwnerUiFixtureV4(),subject={familyId:f.scope.familyId,label:'SYNTHETIC family',children:f.current.quote.lines.map((l,i)=>({id:l.childId,name:i?'ילד שני סינתטי':'SYNTHETIC child one'}))};
 const source={state:'ready' as const,data:f.current,subject},transport=vi.fn(async(request:Request)=>Response.json({ok:true,data:serviceOwnerConfirmedFixtureV4((await request.clone().json()).operation,f.current),requestId:serviceUiIdV4(999)}));
 const client=createFishingBillingOwnerClientV4({origin:'https://synthetic-render.invalid',scope:f.scope,csrf:async()=>'a'.repeat(43),transport});
 const nextOperationId=vi.fn(()=>serviceUiIdV4(750));return {...f,subject,source,transport,client,nextOperationId};
}
it.each(['en','he'] as const)('renders exact %s sibling periods, amounts and original acceptance without enabling absent capabilities',locale=>{
 const s=setup(),store=new ServiceOwnerPanelStateV4({scope:s.scope,client:null,source:s.source}),html=render(store,locale);
 expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);expect(html).toContain(s.subject.label);
 for(const child of s.subject.children)expect(html).toContain(child.name);
 for(const line of s.current.quote.lines){expect(html).toContain(line.period.startsAt);expect(html).toContain(line.period.endsAt);expect(html).toContain(line.period.id);}
 const acceptance=s.current.quote.acceptance!;
 for(const original of [acceptance.id,acceptance.operationId,acceptance.action,acceptance.version,acceptance.grantId,acceptance.assuranceEvidenceId,acceptance.offer.sha256,acceptance.displayed.id,acceptance.displayed.sha256,
  acceptance.displayed.financialTerms.source.id,acceptance.displayed.financialTerms.source.sha256,acceptance.displayed.financialTerms.displayedTextSha256,
  acceptance.displayed.financialTerms.releaseEvidenceId,acceptance.parent.submittedName,acceptance.parent.privateEvidenceId,acceptance.acceptedAt])expect(html).toContain(original);
 expect(html).toContain('650.00');expect(html.match(/<button\b/g)??[]).toHaveLength(0);expect(html).not.toContain('JLFA-FISHING-BILLING-GUEST-v3');expect(s.transport).not.toHaveBeenCalled();
});
it('shows original cash date separately from recorded time and links corrections to the original retained receipt',()=>{
 const s=setup(),saved=serviceOwnerConfirmedFixtureV4(s.cash,s.current);if(saved.state!=='confirmed')throw Error('FIXTURE');
 if(!('result' in saved.receipt))throw Error('FIXTURE');const originalReceiptId=saved.receipt.result.receipt.id;
 const correction=prepareServiceOwnerReversalV4(saved.current,serviceUiIdV4(760),originalReceiptId,{amount:'50',allocations:{[serviceUiIdV4(10)]:'50'},reason:'SYNTHETIC correction'});
 const corrected=serviceOwnerConfirmedFixtureV4(correction.operation,saved.current);if(corrected.state!=='confirmed')throw Error('FIXTURE');
 const store=new ServiceOwnerPanelStateV4({scope:s.scope,client:null,source:{...s.source,data:corrected.current}}),html=render(store);
 expect(html).toContain('2035-01-05');expect(html).toContain('2035-01-06T15:00:00Z');expect(html).toContain('receipt time not recorded');expect(html).toContain('Cash received');expect(html).toContain('200.00');
 expect(html).toContain('Original receipt');expect(html).toContain(originalReceiptId);expect(html).toContain('50.00');expect(html).toContain('SYNTHETIC correction');
 expect(html).not.toContain('Check operation status');expect(html).not.toContain('Confirm entry');
});
it('shows recorded unallocated money separately from each child balance and from receipt allocations',()=>{
 const s=setup(),operation={...s.cash,command:{...s.cash.command,allocations:[{lineId:serviceUiIdV4(10),amountMinor:15000}]}};
 const saved=serviceOwnerConfirmedFixtureV4(operation,s.current);if(saved.state!=='confirmed')throw Error('FIXTURE');
 const store=new ServiceOwnerPanelStateV4({scope:s.scope,client:null,source:{...s.source,data:saved.current}}),html=render(store);
 expect(html).toContain('Unallocated money');expect(html).toContain('Unallocated amount');expect(html).toContain('50.00');expect(store.getSnapshot().data?.balance.paidMinor).toBe(15000);
});
it('shows the exact recorded recurring choice without creating an active card capability',()=>{
 const s=setup(),data=structuredClone(s.current),a=data.quote.acceptance!;
 a.recurring={kind:'separate_affirmative_card_authorization',statementSha256:'8'.repeat(64),amountTimingCancellationAffirmed:true,lines:data.quote.lines.map(l=>({lineId:l.id,childId:l.childId,periodId:l.period.id,amountMinor:l.amountMinor,currency:'USD',firstPeriodStartsAt:l.period.startsAt,nextRenewalAt:l.period.endsAt}))};
 a.recurringPrivateEvidenceId=serviceUiIdV4(761);const store=new ServiceOwnerPanelStateV4({scope:s.scope,client:null,source:{...s.source,data}}),html=render(store);
 expect(html).toContain('Separate recurring authorization recorded');expect(html).toContain('8'.repeat(64));expect(html).toContain('Card payments, provider refunds and sending messages are not available here.');
 expect(html).toContain(a.recurringPrivateEvidenceId);
 expect(html.match(/<button\b/g)??[]).toHaveLength(0);expect(s.transport).not.toHaveBeenCalled();
});
it.each(['en','he'] as const)('keeps %s UNKNOWN private and offers only same-original recovery',locale=>{
 const s=setup(),pending=prepareServiceOwnerOperationV4(s.cash),store=new ServiceOwnerPanelStateV4({scope:s.scope,client:s.client,source:s.source,resumeOriginal:pending,
  nextOperationId:s.nextOperationId,capabilities:{cash:true,reversal:true,state:true}}),html=render(store,locale);
 expect(html).toContain(s.cash.command.operationId);expect(html).toContain(locale==='he'?'בדיקת מצב הפעולה':'Check operation status');
 for(const privateText of [s.subject.label,...s.subject.children.map(c=>c.name),s.current.quote.acceptance!.parent.submittedName,'650.00','200.00',s.current.quote.offer.sha256])expect(html).not.toContain(privateText);
 expect(html).not.toContain('<dialog');expect(s.nextOperationId).not.toHaveBeenCalled();expect(s.transport).not.toHaveBeenCalled();
});
it('shows a missing recovery capability honestly without a dead recovery button',()=>{
 const s=setup(),store=new ServiceOwnerPanelStateV4({scope:s.scope,client:null,source:s.source,resumeOriginal:prepareServiceOwnerOperationV4(s.cash)}),html=render(store);
 expect(html.match(/<button\b/g)??[]).toHaveLength(0);expect(html).toContain('Status checking is unavailable.');expect(html).not.toContain(s.subject.label);
});
it('renders unavailable or invalid context without zero balances, names, consent or fake action buttons',()=>{
 const s=setup();for(const source of [{state:'unavailable' as const},{...s.source,subject:{...s.subject,children:[]}}]){
  const store=new ServiceOwnerPanelStateV4({scope:s.scope,client:s.client,source,capabilities:{cash:true},nextOperationId:s.nextOperationId}),html=render(store);
  expect(html).toContain('Billing details are unavailable');expect(html).not.toContain(s.subject.label);expect(html).not.toContain('0.00');expect(html.match(/<button\b/g)??[]).toHaveLength(0);
 }expect(s.nextOperationId).not.toHaveBeenCalled();expect(s.transport).not.toHaveBeenCalled();
});
it('renders labeled retained form/review markup without generating IDs or dispatching during render/remount',()=>{
 const s=setup(),store=new ServiceOwnerPanelStateV4({scope:s.scope,client:s.client,source:s.source,capabilities:{cash:true},nextOperationId:s.nextOperationId});store.openCash();
 store.updateDraft({amount:'200.00',date:'2035-01-05',allocations:{[serviceUiIdV4(10)]:'200',[serviceUiIdV4(11)]:''}});const html=render(store);
 expect(html).toContain('<dialog');expect(html).toContain('type="date"');expect(html).toContain('value="2035-01-05"');expect(html).toContain('value="200.00"');
 for(const match of html.matchAll(/<label[^>]*for="([^"]+)"/g))expect(html).toContain(`id="${match[1]}"`);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(ids.length);
 expect(s.nextOperationId).not.toHaveBeenCalled();expect(store.review()).toBe(true);const reviewed=render(store);expect(reviewed).toContain('Confirm entry');expect(reviewed).not.toContain('type="date"');
 store.closeForm();store.openCash();expect(render(store)).toContain('Confirm entry');expect(s.nextOperationId).toHaveBeenCalledOnce();expect(s.transport).not.toHaveBeenCalled();
});
it('does not present a rejected recovery as a resolved original outcome',async()=>{
 const s=setup(),pending=prepareServiceOwnerOperationV4(s.cash),store=new ServiceOwnerPanelStateV4({scope:s.scope,client:s.client,source:s.source,resumeOriginal:pending});
 s.transport.mockResolvedValueOnce(Response.json({ok:true,data:{version:BILLING_SERVICE_V4,state:'rejected_current_attempt',operation:s.cash,code:'CONFLICT'},requestId:serviceUiIdV4(999)}));
 await store.recover();const html=render(store);expect(html).toContain('original operation remains unresolved');expect(html).toContain('Check operation status');expect(html).not.toContain('Original operation confirmed');expect(html).not.toContain(s.subject.label);
});
