import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import type {GroupApplicationRecord} from '../../src/features/group-application/contract.ts';
import type {AcademyRegistration} from '../../src/features/group-application/academy-registration.ts';
import {ACADEMY_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
import {emptyAcademyInquiryFilters,matchesAcademyInquiryFilters} from '../../src/features/group-application/academy-inquiry-filters.ts';
import type {AcademyInquiryFiltersValue} from '../../src/features/group-application/academy-inquiry-filters.ts';
import {AcademyInquiryFilters} from '../../src/features/group-application/academy-inquiry-filters.tsx';

function fixture(overrides:Partial<AcademyRegistration>={}):GroupApplicationRecord{return {id:'synthetic-application',source:'public_group_application',state:'owner_review',receivedAt:'2026-10-25T12:00:00Z',fields:{parentName:'Synthetic Parent',contact:'synthetic@example.test',language:'en',cityArea:'Synthetic area',programId:'sunday_fishing_academy',schedulePreference:[],permission:{confirmed:true,version:registrationConsent('en').version,language:'en'},academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners:[{id:'11111111-1111-4111-8111-111111111111',fullName:'Synthetic Older',ageYears:12,grade:'7',schooling:'school',experience:'new'},{id:'22222222-2222-4222-8222-222222222222',fullName:'Synthetic Younger',ageYears:9,grade:'4',schooling:'school',experience:'new'}],postalCode:'33021',preferredDays:['sunday','tuesday'],preferredTimes:['afternoon'],driveMinutes:30,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'en',stageInterest:'foundation',intent:'information',receiptEmail:'synthetic@example.test',consent:registrationConsent('en'),...overrides}}};}
const filters=(overrides:Partial<AcademyInquiryFiltersValue>={}):AcademyInquiryFiltersValue=>({...emptyAcademyInquiryFilters,...overrides});
describe('Academy inquiry preference filters',()=>{
 it('keeps one whole application with both siblings and does not mutate data or filters',()=>{
  const record=fixture(),before=JSON.stringify(record),value=filters({ageYears:'9'}),beforeFilters=JSON.stringify(value);
  expect(matchesAcademyInquiryFilters(record,value)).toBe(true);expect(JSON.stringify(record)).toBe(before);expect(JSON.stringify(value)).toBe(beforeFilters);expect([record].filter(r=>matchesAcademyInquiryFilters(r,value))).toEqual([record]);
  expect(matchesAcademyInquiryFilters(record,filters({ageYears:'10'}))).toBe(false);
 });
 it('shows loaded Academy records without filters but never other programs or Israel',()=>{
  const record=fixture();expect(matchesAcademyInquiryFilters(record,filters())).toBe(true);
  const legacy={...record,fields:{...record.fields,academyRegistration:undefined}} as GroupApplicationRecord;
  expect(matchesAcademyInquiryFilters(legacy,filters())).toBe(true);
  for(const criterion of [{ageYears:'12'},{stageInterest:'foundation'},{day:'sunday'},{time:'afternoon'},{groupLanguage:'en'},{tripMinutes:'5'}] as Partial<AcademyInquiryFiltersValue>[])expect(matchesAcademyInquiryFilters(legacy,filters(criterion))).toBe(false);
  for(const programId of ['private_fishing_life_skills','morning_torah_learning'])expect(matchesAcademyInquiryFilters({...record,fields:{...record.fields,programId}} as GroupApplicationRecord,filters())).toBe(false);
  const israel={...record,fields:{parentName:'Synthetic Israel'}} as GroupApplicationRecord;expect(matchesAcademyInquiryFilters(israel,filters())).toBe(false);
 });
 it('requires all active saved preferences and does not translate discuss into a stage',()=>{
  const record=fixture();expect(matchesAcademyInquiryFilters(record,filters({stageInterest:'foundation',day:'tuesday',time:'afternoon',groupLanguage:'en',ageYears:'12',tripMinutes:'30'}))).toBe(true);
  for(const criterion of [{stageInterest:'advanced'},{day:'monday'},{time:'morning'},{groupLanguage:'he'},{ageYears:'10'},{tripMinutes:'31'}] as Partial<AcademyInquiryFiltersValue>[])expect(matchesAcademyInquiryFilters(record,filters(criterion))).toBe(false);
  expect(matchesAcademyInquiryFilters(fixture({stageInterest:'discuss'}),filters({stageInterest:'foundation'}))).toBe(false);
  expect(matchesAcademyInquiryFilters(fixture({stageInterest:'discuss'}),filters({stageInterest:'discuss'}))).toBe(true);
 });
 it('matches saved flexible/either to a specific request; flexible/either selection is exact',()=>{
  const record=fixture({preferredDays:['flexible'],preferredTimes:['flexible'],preferredGroupLanguage:'either'});
  for(const day of ['sunday','friday','flexible'] as const)for(const time of ['morning','evening','flexible'] as const)for(const groupLanguage of ['en','he','either'] as const)expect(matchesAcademyInquiryFilters(record,filters({day,time,groupLanguage}))).toBe(true);
  for(const criterion of [{day:'flexible'},{time:'flexible'},{groupLanguage:'either'}] as Partial<AcademyInquiryFiltersValue>[])expect(matchesAcademyInquiryFilters(fixture(),filters(criterion))).toBe(false);
  expect(matchesAcademyInquiryFilters(record,filters({day:'saturday' as AcademyInquiryFiltersValue['day']}))).toBe(false);
 });
 it.each(['-1','18','1.5','NaN','Infinity',' ','1e1','+9'])('rejects invalid age %s without rounding or broadening',ageYears=>expect(matchesAcademyInquiryFilters(fixture(),filters({ageYears}))).toBe(false));
 it('accepts actual whole ages zero and seventeen',()=>{
  const record=fixture();if('academyRegistration' in record.fields&&record.fields.academyRegistration){record.fields.academyRegistration.learners[0]!.ageYears=0;record.fields.academyRegistration.learners[1]!.ageYears=17;}
  expect(matchesAcademyInquiryFilters(record,filters({ageYears:'0'}))).toBe(true);expect(matchesAcademyInquiryFilters(record,filters({ageYears:'17'}))).toBe(true);
 });
 it.each(['4','121','5.1','-5','Infinity',' ','1e2'])('rejects invalid trip minutes %s',tripMinutes=>expect(matchesAcademyInquiryFilters(fixture(),filters({tripMinutes}))).toBe(false));
 it('compares saved willingness >= requested trip, including exact limits',()=>{
  expect(matchesAcademyInquiryFilters(fixture({driveMinutes:5}),filters({tripMinutes:'5'}))).toBe(true);expect(matchesAcademyInquiryFilters(fixture({driveMinutes:5}),filters({tripMinutes:'6'}))).toBe(false);expect(matchesAcademyInquiryFilters(fixture({driveMinutes:120}),filters({tripMinutes:'120'}))).toBe(true);expect(matchesAcademyInquiryFilters(fixture({driveMinutes:121}),filters({tripMinutes:'120'}))).toBe(false);
 });
 it('does not invent missing values from a partially readable registration',()=>{
  expect(matchesAcademyInquiryFilters(fixture({preferredDays:undefined} as unknown as Partial<AcademyRegistration>),filters({day:'sunday'}))).toBe(false);expect(matchesAcademyInquiryFilters(fixture({preferredTimes:undefined} as unknown as Partial<AcademyRegistration>),filters({time:'morning'}))).toBe(false);expect(matchesAcademyInquiryFilters(fixture({preferredGroupLanguage:undefined} as unknown as Partial<AcademyRegistration>),filters({groupLanguage:'en'}))).toBe(false);expect(matchesAcademyInquiryFilters(fixture({learners:undefined} as unknown as Partial<AcademyRegistration>),filters({ageYears:'12'}))).toBe(false);expect(matchesAcademyInquiryFilters(fixture({driveMinutes:undefined} as unknown as Partial<AcademyRegistration>),filters({tripMinutes:'5'}))).toBe(false);
 });
 it.each(['en','he'] as const)('renders controlled scope, counts, labels and invalid values in %s without actions or fetch',locale=>{
  const fetchSpy=vi.spyOn(globalThis,'fetch'),onChange=vi.fn();const html=renderToStaticMarkup(createElement(AcademyInquiryFilters,{locale,value:filters({ageYears:'1.5',tripMinutes:'121'}),onChange,loadedCount:4,visibleCount:0}));
  expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);expect(html.match(/<select/g)).toHaveLength(4);expect(html.match(/<input/g)).toHaveLength(2);expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);expect(html).toContain(locale==='en'?'0 of 4 loaded Academy inquiries shown':'מוצגות 0 מתוך 4 פניות אקדמיה שנטענו');expect(html).toContain(locale==='en'?'every sibling':'כל האחים');expect(html).toContain(locale==='en'?'not a verified journey or venue':'לא נסיעה או מקום שאומתו');expect(html).not.toMatch(/<form|<a\s/);expect(onChange).not.toHaveBeenCalled();expect(fetchSpy).not.toHaveBeenCalled();fetchSpy.mockRestore();
 });
 it('fails safely for malformed preference arrays and learner data',()=>{
  for(const preferredDays of ['flexible',null,['saturday'],['flexible','sunday']])expect(matchesAcademyInquiryFilters(fixture({preferredDays} as unknown as Partial<AcademyRegistration>),filters({day:'sunday'}))).toBe(false);
  for(const preferredTimes of ['flexible',null,['night'],['flexible','evening']])expect(matchesAcademyInquiryFilters(fixture({preferredTimes} as unknown as Partial<AcademyRegistration>),filters({time:'evening'}))).toBe(false);
  for(const learners of ['12',null,[null],[]])expect(matchesAcademyInquiryFilters(fixture({learners} as unknown as Partial<AcademyRegistration>),filters({ageYears:'12'}))).toBe(false);
 });
});
