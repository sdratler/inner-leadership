import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {academyBillingVersion,academyBillingCommandSchema,academyBillingQuerySchema} from '../../../src/features/fishing/academy-billing-contract.ts';
import {AcademyBillingControls} from '../../../src/features/fishing/academy-billing-controls.tsx';
test('billing commands carry only exact canonical references; prices, merchant, paid claims and parent issuance are not request authority',()=>{
 const command={version:academyBillingVersion,action:'issue',operationId:randomUUID(),binding:{applicationId:randomUUID(),personId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:1,expectedFieldsDigest:'1'.repeat(64),expectedFamilyDigest:'2'.repeat(64)},learnerIndex:0,stageId:randomUUID(),offerId:randomUUID(),expectedOfferRevision:1};expect(academyBillingCommandSchema.safeParse(command).success).toBe(true);
 for(const field of ['merchant','paid','amountCents','providerAccountId','parentAccountId','learnerId'])expect(academyBillingCommandSchema.safeParse({...command,[field]:field==='paid'?true:175000}).success).toBe(false);
 expect(academyBillingCommandSchema.safeParse({...command,expectedOfferRevision:2}).success).toBe(false);expect(academyBillingQuerySchema.safeParse({view:'parent',learnerId:randomUUID(),stageId:randomUUID(),applicationId:randomUUID()}).success).toBe(false);
});
test('both actual ENHE billing controls start with deliberate read, no inferred payment or external payment link',()=>{
 for(const locale of ['en','he'] as const){const html=renderToStaticMarkup(createElement(AcademyBillingControls,{locale,learnerId:randomUUID(),stageId:randomUUID(),onLockedChange:()=>{}}));expect(html).toContain(locale==='en'?'Read current stage payments':'קריאת תשלומי השלב העדכניים');expect(html).not.toContain('href=');expect(html).not.toContain('1750');expect(html).not.toContain('1950');expect(html).not.toContain('Issue this approved offer');}
});
