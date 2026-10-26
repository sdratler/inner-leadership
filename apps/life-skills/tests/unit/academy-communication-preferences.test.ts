import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AcademyFounderReadback} from '../../src/features/group-application/academy-founder-readback.tsx';
import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {academyCommunicationNotice,academyCommunicationNoticeHashes,academyCommunicationPreferencesSchema,communicationPreferenceSelection,captureCommunicationPreferences,communicationPreferenceReadback,communicationPreferenceStatusLabel} from '../../src/features/group-application/academy-communication-preferences.ts';
import {academyRegistrationSchema,ACADEMY_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
const id='6d346aba-184b-4ab3-af25-a51bac7ef375';
describe('explicit parent communication preferences',()=>{
 it('pins exact localized notice bytes',()=>{for(const locale of ['en','he'] as const)expect(createHash('sha256').update(academyCommunicationNotice[locale]).digest('hex')).toBe(academyCommunicationNoticeHashes[locale]);});
 it('keeps selected parent language independent from notice/UI language and both optional channels separate',()=>{for(const language of ['en','he'] as const)for(const nurture of [true,false])for(const wapi of [true,false]){const value=communicationPreferenceSelection(language,nurture,wapi,language==='en'?'he':'en');expect(academyCommunicationPreferencesSchema.parse(value)).toEqual(value);expect(value.parentLanguage).toBe(language);}});
 it.each([undefined,null,{}, {locale:'he'}, {parentLanguage:'en',nurtureEmail:true}])('legacy or malformed evidence remains unknown/unconsented %#',value=>{expect(communicationPreferenceReadback(value)).toMatchObject({parentLanguage:null,nurtureEmail:'unknown',privateWapi:'unknown'});});
 it('captures explicit refusals without inventing unknown approval',()=>{const result=captureCommunicationPreferences(communicationPreferenceSelection('he',false,false,'en'),id,new Date('2030-01-01T00:00:00Z'));expect(communicationPreferenceReadback(result)).toMatchObject({parentLanguage:'he',nurtureEmail:'not_requested',privateWapi:'not_requested'});});
 it('server provenance advances additively without mutating previous or input records',()=>{const input=communicationPreferenceSelection('he',true,false,'en'),first=captureCommunicationPreferences(input,id,new Date('2030-01-01T00:00:00Z')),before=structuredClone(first);const next=captureCommunicationPreferences(communicationPreferenceSelection('en',false,true,'he'),id,new Date('2030-01-02T00:00:00Z'),first);expect(first).toEqual(before);expect(next.revision).toBe(2);expect(input.parentLanguage).toBe('he');});
 it('rejects forged digest, stale version, implied/string consent and extra private fields',()=>{const value=communicationPreferenceSelection('en',false,false,'en');for(const bad of [{...value,nurtureEmail:'true'},{...value,privateWapi:undefined},{...value,version:'old'},{...value,childMedicalNotes:'private'},{...value,notice:{...value.notice,textSha256:'0'.repeat(64)}}])expect(academyCommunicationPreferencesSchema.safeParse(bad).success).toBe(false);});
 it('preserves omitted field absence for immutable legacy digests',()=>{const value={version:ACADEMY_REGISTRATION_VERSION,learners:[{id,fullName:'Synthetic Child',ageYears:12,grade:'6',schooling:'school',experience:'new'}],postalCode:'33020',preferredDays:['monday'],preferredTimes:['afternoon'],driveMinutes:30,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'he',stageInterest:'foundation',receiptEmail:'synthetic@example.invalid',intent:'information',consent:registrationConsent('en')};const old=academyRegistrationSchema.parse(value);expect(old).not.toHaveProperty('communicationPreferences');expect(academyRegistrationSchema.parse({...value,communicationPreferences:communicationPreferenceSelection('en',false,false,'en')})).toHaveProperty('communicationPreferences.parentLanguage','en');expect(academyRegistrationSchema.safeParse({...value,communicationPreferences:communicationPreferenceSelection('en',false,false,'he')}).success).toBe(false);});
});


it.each([['requested','Requested','התבקש'],['not_requested','Not requested','לא התבקש'],['unknown','Not recorded — optional permission not established','לא תועד — הרשאה אופציונלית לא אומתה']])('localizes captured choice %s without provider claims',(status,en,he)=>{expect(communicationPreferenceStatusLabel(status,'en')).toBe(en);expect(communicationPreferenceStatusLabel(status,'he')).toBe(he);});
it('unknown status fails to localized unverified wording',()=>{expect(communicationPreferenceStatusLabel('provider_connected','he')).toBe('לא תועד — הרשאה אופציונלית לא אומתה');});


it.each(['en','he'] as const)('renders actual owner choice labels in %s without raw enum leakage',locale=>{
 const recorded=captureCommunicationPreferences(communicationPreferenceSelection('en',true,false,'en'),id,new Date('2030-01-01T00:00:00Z'));
 const window={generation:1,sentAt:null,deadline:null,exception:false,confirmedAt:null};
 const family={id,reference:'SYNTHETIC-REFERENCE',parentName:'Synthetic Parent',email:'synthetic@example.invalid',revision:1,submittedAt:'2030-01-01T00:00:00Z',locale:'en' as const,status:'provisional' as const,allocated:true,children:[],identityApproved:true,interest:window,payment:window,paused:false,offer:null,tokenHash:null,redeemedChildIds:[],enrolledChildIds:[],collectedCents:0,communicationPreferences:recorded};
 const metrics={completedRegistrations:1,uniqueFamilies:1,unresolvedIdentityRecords:0,children:0,activeFounderReservations:1,confirmedInterest:0,waitingForSuitableGroup:0,offersSent:0,paidFamilies:0,paidChildren:0,collectedCents:0,confirmedEnrollment:0};
 const empty=renderToStaticMarkup(createElement(AcademyFounderReadback,{locale,data:{families:[],metrics,messages:[]}}));expect(empty).not.toContain(locale==='en'?'Recorded parent communication choices':'בחירות תקשורת מתועדות להורה');
 const known=renderToStaticMarkup(createElement(AcademyFounderReadback,{locale,data:{families:[family],metrics,messages:[]}}));
 expect(known).toContain(locale==='en'?'Requested':'התבקש');expect(known).toContain(locale==='en'?'Not requested':'לא התבקש');expect(known).not.toMatch(/not_requested|>requested<|>unknown</);
 const legacy={...family};Reflect.deleteProperty(legacy,'communicationPreferences');const unknown=renderToStaticMarkup(createElement(AcademyFounderReadback,{locale,data:{families:[legacy],metrics,messages:[]}}));
 expect(unknown).toContain(locale==='en'?'Not recorded — optional permission not established':'לא תועד — הרשאה אופציונלית לא אומתה');expect(unknown).not.toMatch(/not_requested|>requested<|>unknown</);
});

it('keeps short parent-facing labels free of implementation provider names and the full notice readable',()=>{for(const locale of ['en','he'] as const)expect(academyCommunicationNotice[locale]).not.toMatch(/WAPI/i);const form=readFileSync(new URL('../../src/features/group-application/academy-registration-form.tsx',import.meta.url),'utf8');expect(form).not.toContain('through WAPI');expect(form).not.toContain('דרך WAPI');expect(form).toContain("t('WhatsApp updates','עדכונים בוואטסאפ')");expect(form).toContain('academyCommunicationNotice[locale]');expect(form).toContain('academyCommunicationNoticeHashes[locale]');});
