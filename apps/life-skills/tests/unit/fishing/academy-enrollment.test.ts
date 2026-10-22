import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyEnrollmentCommandSchema,academyEnrollmentVersion} from '../../../src/features/fishing/academy-enrollment-contract.ts';
import {programTermsSchema,fitCommandSchema,termsCommandSchema} from '../../../src/features/fishing/native-program-contract.ts';
import {agreementAcceptanceFixture} from '../../fixtures/academy-agreements.ts';
test('registration commands bind reviewed inquiry/family and exact parent terms without accepting caller authority or consent defaults',()=>{
 const terms={version:academyEnrollmentVersion,action:'terms',operationId:randomUUID(),learnerId:randomUUID(),stageId:randomUUID(),sourceApprovalId:randomUUID(),sourceSha256:'a'.repeat(64),termsVersion:'reviewed-v1',accepted:true,agreementAcceptance:agreementAcceptanceFixture()};expect(academyEnrollmentCommandSchema.safeParse(terms).success).toBe(true);
 for(const patch of [{accepted:false},{role:'parent'},{householdId:randomUUID()},{sourceSha256:'unverified'},{merchant:'test'},{accepted:undefined}])expect(academyEnrollmentCommandSchema.safeParse({...terms,...patch}).success).toBe(false);
});

test('each four-lesson signature fixes its block, price, scope and renewed acknowledgments without future charges',()=>{
 const c={version:academyEnrollmentVersion,action:'block_terms',operationId:randomUUID(),blockId:randomUUID(),learnerId:randomUUID(),stageId:randomUUID(),sourceApprovalId:randomUUID(),sourceSha256:'a'.repeat(64),termsVersion:'reviewed-v1',accepted:true,agreementAcceptance:agreementAcceptanceFixture(),expectedPlanRevision:1,occurrenceIds:Array.from({length:4},()=>randomUUID()),currency:'USD',priceCents:65000,purchasedLessons:4,automaticFutureCharges:false};expect(academyEnrollmentCommandSchema.safeParse(c).success).toBe(true);
 for(const patch of [{priceCents:195000},{purchasedLessons:12},{automaticFutureCharges:true},{blockId:undefined},{agreementAcceptance:undefined},{occurrenceIds:c.occurrenceIds.slice(0,3)},{occurrenceIds:Array(4).fill(c.occurrenceIds[0])},{merchant:'admitted'}])expect(academyEnrollmentCommandSchema.safeParse({...c,...patch}).success).toBe(false);
});
test('historical metadata remains readable; optional new document and request bindings do not add absent keys or allow HTML execution metadata',()=>{
 const old={program:'sunday_fishing_academy',termsVersion:'v1',policyVersion:'p1',sourceVersion:'s1',contentSha256:'b'.repeat(64)};expect(programTermsSchema.parse(old)).toEqual(old);
 expect(programTermsSchema.parse({...old,document:{format:'plain_text',body:'Synthetic terms\nתנאי בדיקה'}}).document?.body).toContain('תנאי בדיקה');expect(programTermsSchema.safeParse({...old,document:{format:'html',body:'<script>bad</script>'}}).success).toBe(false);
 const commandId=randomUUID(),id=randomUUID(),stageId=randomUUID(),learnerId=randomUUID(),fit={commandId,id,stageId,learnerId,purpose:'enrollment',decision:'approved',targetOccurrenceId:null,targetRevision:null,note:'Private reviewed fit'};expect(fitCommandSchema.parse(fit)).toEqual(fit);
 const terms={commandId,id,stageId,learnerId,householdId:randomUUID(),sourceApprovalId:randomUUID(),sourceSha256:'a'.repeat(64)};expect(termsCommandSchema.parse(terms)).toEqual(terms);expect(termsCommandSchema.parse({...terms,sourceBindingSha256:'c'.repeat(64)}).sourceBindingSha256).toBe('c'.repeat(64));
});
