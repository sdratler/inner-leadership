import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyPolicyPreflightVersion,type AcademyTravelChangeWithRecordedMaximumInput} from '../../../src/features/fishing/academy-policy-preflight-contract.ts';
import {assessAcademyTravelChangeWithExactMaximum,assessAcademyTravelChangeWithRecordedMaximum,assessAcademyTravelChange} from '../../../src/features/fishing-stage/academy-session-policy-preflight.ts';
const anchor={workspaceId:randomUUID(),learnerId:randomUUID(),cohortId:randomUUID(),stageId:randomUUID(),occurrenceId:randomUUID(),ordinal:1,moduleId:'RM-101',moduleVersion:'source-v1',activityId:'source-approved-activity'};
const input=(limit:number):AcademyTravelChangeWithRecordedMaximumInput=>({version:academyPolicyPreflightVersion,original:anchor,obligation:{anchor,evidenceId:'verified-native-obligation',state:'purchased_undelivered'},existingCredit:null,sessionKind:'ordinary',change:{anchor,kind:'academy_schedule',evidenceId:'verified-native-change',weatherQualification:'unknown',recordedDriveLimit:limit,revisedOneWayMinutes:limit+1,familyCannotAttend:true}});
test('V3 compares all116 exact integer maxima without rounding; legacy and V2 retain their prior grammars',()=>{
 for(let n=5;n<=120;n++){
  expect(assessAcademyTravelChangeWithExactMaximum(input(n)).reason).toBe('academy_change_exceeds_limit');
  expect(assessAcademyTravelChangeWithExactMaximum({...input(n),change:{...input(n).change,revisedOneWayMinutes:n}}).reason).toBe('within_recorded_limit');
  expect(assessAcademyTravelChangeWithRecordedMaximum(input(n)).reason).toBe(n%5===0?'academy_change_exceeds_limit':'invalid_input');
  expect(assessAcademyTravelChange(input(n) as never).reason).toBe('invalid_input');
 }
});
test('unknown maxima, fractions and numeric strings do not silently become authority',()=>{
 for(const n of [4,121,37.5,'37',Infinity,NaN,null])expect(assessAcademyTravelChangeWithExactMaximum(input(n as number)).reason).toBe('invalid_input');
 const value=input(37);expect(assessAcademyTravelChangeWithExactMaximum({...value,change:{...value.change,recordedDriveLimit:'over_60'}}).reason).toBe('drive_limit_requires_facts');
 expect(assessAcademyTravelChangeWithExactMaximum({...value,change:{...value.change,familyCannotAttend:null}}).reason).toBe('attendance_requires_facts');
});
test('reservation preserves the original credit and never authorizes booking, delivery, cash or a new entitlement',()=>{
 const value=input(37),creditId=randomUUID(),result=assessAcademyTravelChangeWithExactMaximum({...value,existingCredit:{anchor,creditId,state:'replacement_reserved'},change:{...value.change,revisedOneWayMinutes:1,familyCannotAttend:false}});
 expect(result).toMatchObject({status:'retain_existing_credit',reason:'same_outstanding_credit',mayIssueCredit:false,mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false});
});
