import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect,test } from 'vitest';
import { FishingFamilyPayments } from '../../../src/features/fishing-payments/workspace.tsx';
import { familyPayment,initialPayment } from '../../../src/features/fishing-payments/domain.ts';
import { merchant,offerFixture } from './fixture.ts';
test('EN/HE family markup shows three dues, safe hosted action and separate enrollment',()=>{const o=offerFixture('installments'),p=familyPayment(initialPayment(o,o.lines[0]!,'synthetic-purchase',merchant));for(const locale of ['en','he'] as const){const html=renderToStaticMarkup(createElement(FishingFamilyPayments,{payments:[p],locale,actions:[{purchaseId:p.purchaseId,dueIndex:1,state:'ready',url:'https://invoice.stripe.com/i/synthetic'}]}));expect((html.match(/<li>/g)??[]).length).toBe(3);expect(html).toContain(locale==='he'?'dir="rtl"':'dir="ltr"');expect(html).toContain('https://invoice.stripe.com/i/synthetic');expect(html).not.toContain(merchant.accountId);expect(html).not.toContain('Payment 4');}});
