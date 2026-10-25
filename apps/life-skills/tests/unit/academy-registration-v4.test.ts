import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('server-only',()=>({}));
import {academyRegistrationSchema,ACADEMY_REGISTRATION_VERSION,ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
import {communicationPreferenceSelection} from '../../src/features/group-application/academy-communication-preferences.ts';
import {floridaGroupApplicationFieldsSchema,groupApplicationFieldsSchema} from '../../src/features/group-application/contract.ts';
import {isFreeFounderRegistration} from '../../src/features/group-application/academy-founder-store.ts';
import {AcademyRegistrationReadback} from '../../src/features/group-application/academy-registration-readback.tsx';
import {AcademyProgramTerms} from '../../src/features/group-application/academy-program-terms.tsx';
import {academyRegistrationNotice,academyRegistrationNoticeHashes} from '../../src/features/group-application/academy-registration-notice.ts';

function registration(version:string=ACADEMY_REGISTRATION_VERSION,stageInterest='foundation'){
 return {version,learners:[{id:'b7faef3c-c13a-4af3-8a43-1947447fca43',fullName:'Synthetic Child One',ageYears:10,grade:'5',schooling:'school',experience:'experienced'},{id:'2f48492b-5919-4fa6-a4a5-b590304dbe85',fullName:'Synthetic Child Two',ageYears:13,grade:'8',schooling:'homeschool',experience:'some'}],postalCode:'00123',preferredDays:['monday'],preferredTimes:['afternoon'],driveMinutes:37,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'he',stageInterest,receiptEmail:'synthetic@example.invalid',intent:'information',consent:registrationConsent('en')};
}
function fields(r=registration()){
 return {parentName:'Synthetic Parent',contact:'+15555550124',cityArea:'Synthetic Florida',language:'en',programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:r,permission:{confirmed:true,version:r.consent.version,language:'en'}};
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
describe('Website03 proposed Foundation entry and historical registration compatibility',()=>{
 it('renders the actual released localized notice inside one collapsed terms disclosure with immutable identity',()=>{
  for(const locale of ['en','he']as const){
   const html=renderToStaticMarkup(createElement(AcademyProgramTerms,{locale}));
   expect(html).toContain('<details data-academy-program-terms="true" id="academy-program-terms">');
   expect(html).toContain('<summary>');expect(html).toContain(academyRegistrationNotice.version);
   expect(html).toContain(academyRegistrationNoticeHashes[locale]);expect(html).toContain('data-document-status="released_registration_only"');
   expect(html).toContain(academyRegistrationNotice[locale]);expect(html).not.toContain('type="checkbox"');expect(html).not.toContain('final_owner_approved');
  }
 });
 it('accepts explicit Foundation despite general experience; rejects stage overrides and omission',()=>{
  expect(floridaGroupApplicationFieldsSchema.safeParse(fields()).success).toBe(true);
  for(const stage of ['independent','advanced','leadership','discuss'])expect(floridaGroupApplicationFieldsSchema.safeParse(fields(registration(ACADEMY_REGISTRATION_VERSION,stage))).success).toBe(false);
  const missing=registration();Reflect.deleteProperty(missing,'stageInterest');expect(academyRegistrationSchema.safeParse(missing).success).toBe(false);
 });
 it.each(['JLFA-REGISTRATION-20261020-01-v1','JLFA-REGISTRATION-20261020-OWNER03-v2',ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION])('preserves historical %s stage answers and serialized digest without defaults',version=>{
  const old=registration(version,'advanced'),parsed=academyRegistrationSchema.parse(old);
  expect(parsed).toEqual(old);expect(JSON.stringify(parsed)).toBe(JSON.stringify(old));expect(digest(parsed)).toBe(digest(old));expect(parsed).not.toHaveProperty('communicationPreferences');
  expect(groupApplicationFieldsSchema.safeParse(fields(old)).success).toBe(true);
  expect(floridaGroupApplicationFieldsSchema.safeParse(fields(old)).success).toBe(false);
 });
 it('keeps v3 optional preferences and free-family attribution semantics after v4',()=>{
  const old={...registration(ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION,'discuss'),communicationPreferences:communicationPreferenceSelection('he',false,true,'en')};
  const parsed=academyRegistrationSchema.parse(old);
  expect(parsed.communicationPreferences).toEqual(old.communicationPreferences);expect(parsed.stageInterest).toBe('discuss');
  expect(isFreeFounderRegistration(groupApplicationFieldsSchema.parse({...fields(),academyRegistration:parsed}))).toBe(true);
  expect(isFreeFounderRegistration(groupApplicationFieldsSchema.parse(fields()))).toBe(true);
 });
 it('keeps free-only terms, rejects draft acceptance and fabricated child acknowledgments',()=>{
  for(const extra of [{intent:'pay'},{acceptedDocuments:['draft-safety']},{childAcknowledgments:[true,true]},{consent:{...registrationConsent('en'),version:'draft-safety'}},{consent:{...registrationConsent('en'),textSha256:'0'.repeat(64)}}])expect(academyRegistrationSchema.safeParse({...registration(),...extra}).success).toBe(false);
 });
 it('labels new placement as proposed while retaining historical stage-interest labels',()=>{
  for(const locale of ['en','he']as const){
   const current=renderToStaticMarkup(createElement(AcademyRegistrationReadback,{registration:academyRegistrationSchema.parse(registration()),locale}));
   const historical=renderToStaticMarkup(createElement(AcademyRegistrationReadback,{registration:academyRegistrationSchema.parse(registration(ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION,'advanced')),locale}));
   expect(current).toContain(locale==='en'?'Proposed entry stage (instructor review required)':'שלב כניסה מוצע (נדרש אישור מדריך)');
   expect(historical).toContain(locale==='en'?'Stage interest':'עניין בשלב');
   for(const value of ['00123','37','Synthetic Child One','Synthetic Child Two']){expect(current).toContain(value);expect(historical).toContain(value);}
  }
 });
});
