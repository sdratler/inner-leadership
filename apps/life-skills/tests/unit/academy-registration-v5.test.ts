import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {academyRegistrationSchema,ACADEMY_REGISTRATION_VERSION,ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION,ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION,ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
import {academyLegacyRegistrationNotice,academyPreviousFreeRegistrationNotice,academyRegistrationNotice,academyNoticeHashes} from '../../src/features/group-application/academy-registration-notice.ts';
import {floridaGroupApplicationFieldsSchema,groupApplicationFieldsSchema} from '../../src/features/group-application/contract.ts';
import {registrationAcknowledgments} from '../../src/features/group-application/academy-registration-acknowledgments.ts';
import {communicationPreferenceSelection} from '../../src/features/group-application/academy-communication-preferences.ts';

const historicalVersions=['JLFA-REGISTRATION-20261020-01-v1','JLFA-REGISTRATION-20261020-OWNER03-v2',ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION,ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION,ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION] as const;
function registration(version:Parameters<typeof registrationConsent>[1]=ACADEMY_REGISTRATION_VERSION){const learners=[{id:'b7faef3c-c13a-4af3-8a43-1947447fca43',fullName:'Synthetic Child One',ageYears:10,grade:'5',schooling:'school',experience:'experienced'},{id:'2f48492b-5919-4fa6-a4a5-b590304dbe85',fullName:'Synthetic Child Two',ageYears:13,grade:'8',schooling:'homeschool',experience:'some'}];return {version,learners,postalCode:'00123',preferredDays:['monday'],preferredTimes:['afternoon'],driveMinutes:37,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'he',stageInterest:'foundation',receiptEmail:'synthetic@example.invalid',intent:'information',...(version===ACADEMY_REGISTRATION_VERSION?{communicationPreferences:communicationPreferenceSelection('en',false,'en'),acknowledgments:registrationAcknowledgments('en',learners.map(child=>child.id))}:{}),consent:registrationConsent('en',version)};}
function fields(r=registration()){return {parentName:'Synthetic Parent',contact:r.receiptEmail,cityArea:'Synthetic Florida',language:'en',programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:r,permission:{confirmed:true,version:r.consent.version,language:'en'}};}
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');

describe('additive registration/notice binding through current v6',()=>{
 it('requires the current free/privacy notice and acknowledgments for fresh v6 writes, while preserving an email-only intake',()=>{
  expect(floridaGroupApplicationFieldsSchema.safeParse(fields()).success).toBe(true);
  const oldNotice={...registration(),consent:registrationConsent('en',ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION)};
  expect(floridaGroupApplicationFieldsSchema.safeParse(fields(oldNotice)).success).toBe(false);
  for(const stageInterest of ['advanced','independent','leadership','discuss'])expect(academyRegistrationSchema.safeParse({...registration(),stageInterest}).success).toBe(false);
  expect(academyRegistrationSchema.safeParse({...registration(),paymentSelection:{childId:registration().learners[0]!.id,plan:'prepay'}}).success).toBe(false);
 });
 it.each(historicalVersions)('reads %s byte-for-byte without migrating its notice, stage answers or two-child values',version=>{
  const old=registration(version);if(version!==ACADEMY_FOUNDATION_FREE_REGISTRATION_VERSION&&version!==ACADEMY_EXACT_COPY_FREE_REGISTRATION_VERSION)old.stageInterest='advanced';
  const wire=JSON.stringify(old),hash=sha(wire),parsed=academyRegistrationSchema.parse(JSON.parse(wire));
  expect(JSON.stringify(parsed)).toBe(wire);expect(sha(JSON.stringify(parsed))).toBe(hash);
  expect(parsed.postalCode).toBe('00123');expect(parsed.driveMinutes).toBe(37);expect(parsed.learners).toHaveLength(2);
  expect(groupApplicationFieldsSchema.safeParse(fields(old)).success).toBe(true);
  expect(floridaGroupApplicationFieldsSchema.safeParse(fields(old)).success).toBe(false);
  expect(academyRegistrationSchema.safeParse({...old,consent:registrationConsent('en')}).success).toBe(false);
 });
 it('retains both historically readable v1/v2 notice tuples, without admitting new05 into old protocols',()=>{
  for(const version of historicalVersions.slice(0,2))for(const notice of [academyLegacyRegistrationNotice,academyPreviousFreeRegistrationNotice])for(const language of ['en','he'] as const){
   const old={...registration(version),consent:{kind:'registration_contact',documentId:notice.id,version:notice.version,language,textSha256:academyNoticeHashes(notice.version)![language]}};
   expect(academyRegistrationSchema.parse(old)).toEqual(old);
  }
 });
 it('pins previous notice bytes and distinguishes read-only policy information from accepted free/privacy fragments',()=>{
  expect(sha(academyPreviousFreeRegistrationNotice.en)).toBe('b4ff8bb4a6860d719f20b3af14c4bfcd2680f13e4627db69cf63674c22e8a068');
  expect(sha(academyPreviousFreeRegistrationNotice.he)).toBe('83ac47d1387a523737716c9bf8d4bc0f63438bf4247a163ef7ab20ea1515359c');
  for(const language of ['en','he'] as const)expect(sha(academyRegistrationNotice[language])).toBe(academyNoticeHashes(academyRegistrationNotice.version)![language]);
  expect(academyRegistrationNotice.en).not.toMatch(/administration fee|witnessed|liability waiver|authorization to charge/i);
  for(const extra of [{acceptedDocuments:['safety']},{childAcknowledgments:[true,true]},{intent:'pay'}])expect(academyRegistrationSchema.safeParse({...registration(),...extra}).success).toBe(false);
 });
});
