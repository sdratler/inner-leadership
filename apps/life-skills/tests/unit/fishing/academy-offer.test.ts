import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyOfferCommandSchema,academyOfferVersion} from '../../../src/features/fishing/academy-offer-contract.ts';
const command=()=>({version:academyOfferVersion,action:'prepare',operationId:randomUUID(),holdCommandId:randomUUID(),approvalCommandId:randomUUID(),binding:{applicationId:randomUUID(),personId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:1,expectedFieldsDigest:'a'.repeat(64),expectedFamilyDigest:'b'.repeat(64)},learnerIndex:0,stageId:randomUUID(),expectedPreparationSha256:'c'.repeat(64),mode:'installments',expiresAt:'2026-12-01T17:00:00Z',dueAt:['2026-11-01T17:00:00Z','2026-12-01T17:00:00Z','2027-01-01T17:00:00Z']});
test('owner offer commands require deliberate mode/dates/current bindings and accept no caller payment authority',()=>{
 const c=command();expect(academyOfferCommandSchema.safeParse(c).success).toBe(true);
 for(const patch of [{mode:undefined},{mode:'founder'},{merchant:{verified:true}},{totalCents:165000},{paid:true},{enrollmentId:randomUUID()},{expectedPreparationSha256:'unknown'},{holdCommandId:c.operationId}])expect(academyOfferCommandSchema.safeParse({...c,...patch}).success).toBe(false);
});
test('exact three increasing dues or one prepay due are required and withdrawal has a bounded private reason',()=>{
 const c=command();for(const dueAt of [c.dueAt.slice(0,2),[...c.dueAt].reverse(),[c.dueAt[0],c.dueAt[0],c.dueAt[2]]])expect(academyOfferCommandSchema.safeParse({...c,dueAt}).success).toBe(false);
 expect(academyOfferCommandSchema.safeParse({...c,mode:'prepay',dueAt:c.dueAt.slice(0,1)}).success).toBe(true);
 const {holdCommandId:_,approvalCommandId:__,expectedPreparationSha256:___,mode:____,expiresAt:_____,dueAt:______,...base}=c;void _;void __;void ___;void ____;void _____;void ______;
 expect(academyOfferCommandSchema.safeParse({...base,action:'withdraw',offerId:randomUUID(),reason:'Private reviewed withdrawal'}).success).toBe(true);expect(academyOfferCommandSchema.safeParse({...base,action:'withdraw',offerId:randomUUID(),reason:' '}).success).toBe(false);
});
