import {expect,it} from 'vitest';
import {keysInterestSchema,keysOwnerUpdateSchema,normalizeKeysPhone} from '../../src/features/keys-trip/contract.ts';
import {keysFixture} from '../fixtures/keys-trip.ts';
import {groupApplicationFieldsSchema,floridaGroupApplicationSubmissionSchema} from '../../src/features/group-application/contract.ts';
it('accepts the distinct day-trip request and exact notices without importing monthly terms',()=>{
 const {fields}=keysFixture();expect(keysInterestSchema.parse(fields)).toEqual(fields);expect(groupApplicationFieldsSchema.parse(fields)).toEqual(fields);
 expect(floridaGroupApplicationSubmissionSchema.safeParse({operationId:keysFixture().operationId,fields,challenge:'a'.repeat(90),website:''}).success).toBe(false);
 for(const field of ['price','offerVersion','programId','acceptedTerms','paymentAuthorized'])expect(keysInterestSchema.safeParse({...fields,[field]:true}).success).toBe(false);
});
it('requires guardian contact, ages10–17, unique child identifiers and exact separate consent',()=>{
 const {fields}=keysFixture();
 for(const ageYears of [9,18,10.5])expect(keysInterestSchema.safeParse({...fields,children:[{...fields.children[0]!,ageYears}]}).success).toBe(false);
 expect(keysInterestSchema.safeParse({...fields,children:[fields.children[0],fields.children[0]]}).success).toBe(false);
 for(const change of [{contact:false},{noticeText:'Different notice'},{whatsapp:true,whatsappText:'Join a group'},{version:'old'}])expect(keysInterestSchema.safeParse({...fields,consent:{...fields.consent,...change}}).success).toBe(false);
 expect(keysInterestSchema.parse(fields).consent).toMatchObject({whatsapp:false,futureEmail:false});
 expect(keysInterestSchema.safeParse({...fields,pickupPreferences:['boca_raton','boca_raton']}).success).toBe(false);
 expect(keysInterestSchema.safeParse({...fields,phone:'3055550123'}).success).toBe(false);
 expect(normalizeKeysPhone('(305) 555-0123')).toBe('+13055550123');
});
it('cannot edit the original child identity or consent through owner contact corrections',()=>{
 const field=keysFixture().fields,input={operationId:keysFixture().operationId,applicationId:keysFixture().operationId,expectedVersion:0,status:'contacted',note:'Synthetic parent called.',nextAction:null,dueDate:null,waitingCondition:'Await family reply',contactCorrection:{version:'JLFA-KEYS-CONTACT-CORRECTION-v1',guardianName:field.guardianName,email:field.email,phone:field.phone,city:field.city,postalCode:field.postalCode,availability:field.availability,pickupPreferences:field.pickupPreferences,reason:'Parent supplied updated contact.'}};
 expect(keysOwnerUpdateSchema.safeParse(input).success).toBe(true);
 expect(keysOwnerUpdateSchema.safeParse({...input,contactCorrection:{...input.contactCorrection,consent:{futureEmail:true}}}).success).toBe(false);
 expect(keysOwnerUpdateSchema.safeParse({...input,contactCorrection:{...input.contactCorrection,children:[]}}).success).toBe(false);
 expect(keysOwnerUpdateSchema.safeParse({...input,expectedVersion:-1}).success).toBe(false);
});
