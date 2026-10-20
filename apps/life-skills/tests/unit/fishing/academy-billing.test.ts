import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {academyBillingVersion,academyBillingCommandSchema,academyBillingQuerySchema} from '../../../src/features/fishing/academy-billing-contract.ts';
import {AcademyBillingControls} from '../../../src/features/fishing/academy-billing-controls.tsx';
import {AcademyHostedControls} from '../../../src/features/fishing/academy-hosted-controls.tsx';
import type {FamilyPaymentView} from '../../../src/features/fishing-payments/domain.ts';
test('billing commands carry only exact canonical references; prices, merchant, paid claims and parent issuance are not request authority',()=>{
 const command={version:academyBillingVersion,action:'issue',operationId:randomUUID(),binding:{applicationId:randomUUID(),personId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:1,expectedFieldsDigest:'1'.repeat(64),expectedFamilyDigest:'2'.repeat(64)},learnerIndex:0,stageId:randomUUID(),offerId:randomUUID(),expectedOfferRevision:1};expect(academyBillingCommandSchema.safeParse(command).success).toBe(true);
 for(const field of ['merchant','paid','amountCents','providerAccountId','parentAccountId','learnerId'])expect(academyBillingCommandSchema.safeParse({...command,[field]:field==='paid'?true:175000}).success).toBe(false);
 expect(academyBillingCommandSchema.safeParse({...command,expectedOfferRevision:2}).success).toBe(false);expect(academyBillingQuerySchema.safeParse({view:'parent',learnerId:randomUUID(),stageId:randomUUID(),applicationId:randomUUID()}).success).toBe(false);
});
test('both actual ENHE billing controls start with deliberate read, no inferred payment or external payment link',()=>{
 for(const locale of ['en','he'] as const){const html=renderToStaticMarkup(createElement(AcademyBillingControls,{locale,learnerId:randomUUID(),onLockedChange:()=>{}}));expect(html).toContain(locale==='en'?'Read current stage payments':'קריאת תשלומי השלב העדכניים');expect(html).not.toContain('href=');expect(html).not.toContain('1750');expect(html).not.toContain('1950');expect(html).not.toContain('Issue this approved offer');}
});

test('ENHE secure payment control offers only the first wholly unpaid due, with no URL or automatic request on render',()=>{
 const payment:FamilyPaymentView={purchaseId:randomUUID(),currency:'USD',totalCents:195000,paidCents:65000,refundedCents:0,state:'part_paid',enrollmentGranted:false,dues:[{index:1,amountCents:65000,paidCents:65000,dueAt:'2026-11-01T15:00:00Z',state:'paid'},{index:2,amountCents:65000,paidCents:0,dueAt:'2026-12-01T15:00:00Z',state:'pending'},{index:3,amountCents:65000,paidCents:0,dueAt:'2027-01-01T15:00:00Z',state:'pending'}]};
 for(const locale of ['en','he'] as const){const render=(payments:FamilyPaymentView[])=>renderToStaticMarkup(createElement(AcademyHostedControls,{locale,learnerId:randomUUID(),stageId:randomUUID(),payments,onLockedChange:()=>{},onBack:()=>{},onAccessDenied:()=>{}})),html=render([payment]);expect(html).toContain(locale==='en'?'Pay payment 2':'לתשלום 2');expect(html).not.toContain(locale==='en'?'Pay payment 3':'לתשלום 3');expect(html).not.toContain('href=');expect(render([{...payment,dues:[{...payment.dues[1]!,paidCents:1,state:'part_paid'}]}])).toBe('');expect(render([])).toBe('');}
});
