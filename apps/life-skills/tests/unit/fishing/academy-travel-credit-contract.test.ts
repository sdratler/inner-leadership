import {randomUUID} from 'node:crypto';
import {expect,test} from 'vitest';
import {travelChangeCommandSchema,travelDeclarationCommandSchema,travelCreditFrameSchema} from '../../../src/features/fishing/academy-travel-credit-contract.ts';
const selection={selectedEnrollmentId:randomUUID(),originalOccurrenceId:randomUUID()},declaration={operationId:randomUUID(),selection,changeId:randomUUID(),changeSha256:'a'.repeat(64),familyCannotAttend:true};
test('guardian statement accepts only selected original and saved change references, never browser payment/source/guardian proof',()=>{
 expect(travelDeclarationCommandSchema.parse(declaration)).toEqual(declaration);
 for(const [key,value]of Object.entries({paid:true,sourceApproved:true,guardianVerified:true,activityId:'guessed',maximumOneWayMinutes:37,mayIssueCredit:true,creditId:randomUUID(),booked:true}))expect(travelDeclarationCommandSchema.safeParse({...declaration,[key]:value}).success).toBe(false);
 expect(travelDeclarationCommandSchema.safeParse({...declaration,familyCannotAttend:'true'}).success).toBe(false);
});
test('operator statement supplies an estimate but cannot replace the native before/current history or impersonate the family response',()=>{
 const command={operationId:randomUUID(),selection,beforeStageRevision:2,changedStageRevision:3,expectedStageRevision:3,revisedOneWayMinutes:45,estimateReference:'Recorded family-specific estimate'};
 expect(travelChangeCommandSchema.parse(command)).toEqual(command);for(const key of ['familyCannotAttend','parentAccountId','recordedDriveLimit','approvedActivity','changeProven'])expect(travelChangeCommandSchema.safeParse({...command,[key]:true}).success).toBe(false);
 for(const revisedOneWayMinutes of [-1,1.5,1441,'45',NaN])expect(travelChangeCommandSchema.safeParse({...command,revisedOneWayMinutes}).success).toBe(false);
});
test('the browser frame cannot contain the private evidence, purchase, invitation or signature objects',()=>{
 const frame={version:'JLFA-TRAVEL-CREDIT-20261021-01',selection,stageRevision:3,availability:'ready',originalOrdinal:1,current:{stageRevision:3,occurrenceRevision:2,state:'published',time:{kind:'scheduled',startsAt:'2026-11-01T14:00:00Z',endsAt:'2026-11-01T16:00:00Z',timeZone:'America/New_York'},location:'Published venue',sha256:'b'.repeat(64)},candidateChange:null,change:null,recordedMaximumOneWayMinutes:37,declaration:null,responseOutcome:null,credit:{id:randomUUID(),state:'replacement_reserved'},replacement:null,mayRecordChange:false,mayRespond:false,specificDateOrSeatGuaranteed:false};
 expect(travelCreditFrameSchema.safeParse(frame).success).toBe(true);
 for(const key of ['purchaseId','householdId','guardianSha256','learnerArtifact','parentSignature','invitation','settlements','privateEvidence'])expect(travelCreditFrameSchema.safeParse({...frame,[key]:{private:true}}).success).toBe(false);
 expect(travelCreditFrameSchema.safeParse({...frame,credit:{...frame.credit,replacementReservationId:randomUUID()}}).success).toBe(false);
});
