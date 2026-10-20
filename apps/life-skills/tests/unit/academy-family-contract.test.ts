import {it,expect} from 'vitest';
import {academyFamilySavedSchema,academyFamilyCommandSchema,academyFamilyVersion} from '../../src/features/fishing/academy-family-contract.ts';
const id='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222';
it('preserves historical family receipts without invented registration child IDs and accepts explicit new IDs',()=>{
 const old={version:academyFamilyVersion,applicationId:id,personId:id,parentAccountId:id,householdId:id,parentState:'active',invitation:'existing_account',children:[{learnerIndex:0,learnerId:id,displayName:'Synthetic Child'}],enrollmentCreated:false};
 expect(academyFamilySavedSchema.parse(old)).toEqual(old);
 expect(academyFamilySavedSchema.parse({...old,children:[{...old.children[0],registrationChildId:child}]}).children[0]!.registrationChildId).toBe(child);
 const command={version:academyFamilyVersion,operationId:id,applicationId:id,expectedFieldsDigest:'a'.repeat(64),personId:id,expectedEpoch:1,expectedAssociationVersion:1,parentEmail:'synthetic@example.invalid',locale:'en',householdId:null,guardianVerified:true,verificationReference:'Synthetic owner verification',children:[{learnerIndex:0,displayName:'Synthetic Child',existingLearnerId:null,registrationChildId:child}]};
 expect(academyFamilyCommandSchema.safeParse(command).success).toBe(true);expect(academyFamilyCommandSchema.safeParse({...command,guardianVerified:false}).success).toBe(false);
});
