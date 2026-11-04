import {createHash,randomUUID} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
vi.mock('server-only',()=>({}));
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {historicalTrip390V2Fields} from '../fixtures/trip390-v2.ts';
import {trip390V2InterestSchema} from '../../src/features/group-application/academy-trip390-v2.ts';
import {trip390ReservationNotice} from '../../src/features/group-application/academy-trip390-reservation-notice.ts';
import {trip390StudentConduct} from '../../src/features/group-application/academy-trip390-student-conduct.ts';
import {trip390ReservationCollectionEnabled} from '../../src/features/group-application/academy-trip390-reservation-admission.ts';
import {trip390CurrentInterestSchema,trip390InterestSchema,TRIP390_NOTICE_VERSION} from '../../src/features/group-application/academy-trip390-contract.ts';
import {trip390ProgramTerms} from '../../src/features/group-application/academy-trip390-program-terms.ts';
import {AcademyTrip390Page} from '../../src/features/group-application/academy-trip390-page.tsx';
import {trip390StudentAgreement} from '../../src/features/group-application/academy-trip390-student-agreement.ts';
import {AcademyTrip390Readback} from '../../src/features/group-application/academy-trip390-readback.tsx';
import {trip390V1Notice,TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER} from '../../src/features/group-application/academy-trip390-v1.ts';
import {publicGroupApplicationHttp} from '../../src/features/group-application/http.ts';
import {TRIP390_MEDIA_TYPE,TRIP390_V1_MEDIA_TYPE,TRIP390_V2_MEDIA_TYPE} from '../../src/features/group-application/academy-trip390-transport.ts';

describe('immutable historical and current inquiry contracts',()=>{
 it('admits only an explicitly enabled current reservation notice, never an old financial gate',()=>{
  expect(trip390ReservationCollectionEnabled({})).toBe(false);
  expect(trip390ReservationCollectionEnabled({LS_ACADEMY_TRIP390_RESERVATION_ENABLED:'true'})).toBe(false);
  expect(trip390ReservationCollectionEnabled({LS_ACADEMY_TRIP390_RESERVATION_ENABLED:'true',LS_ACADEMY_TRIP390_RESERVATION_NOTICE_VERSION:'old'})).toBe(false);
  expect(trip390ReservationCollectionEnabled({LS_ACADEMY_TRIP390_RESERVATION_ENABLED:'true',LS_ACADEMY_TRIP390_RESERVATION_NOTICE_VERSION:TRIP390_NOTICE_VERSION})).toBe(true);
 });
 it.each(['en','he'] as const)('binds current nonbinding %s snapshots without collecting held signatures or changing message language',locale=>{
  const fields=currentTrip390Fields(),notice=trip390ReservationNotice(locale),conduct=trip390StudentConduct(locale);
  fields.acknowledgment.language=locale;fields.acknowledgment.reservationNotice={version:notice.version,language:locale,text:notice.text,textDigest:notice.textDigest};fields.acknowledgment.studentConduct={version:conduct.version,language:locale,text:conduct.text,textDigest:conduct.textDigest};
  expect(trip390CurrentInterestSchema.parse(fields)).toEqual(fields);expect(fields.messageLanguage).toBe('he');expect(fields.postalCode).toBe('01234-5678');expect(fields.acknowledgment.whatsapp).toBe(false);
  for(const change of [{interestPrivacySafety:false},{conductExplained:false},{guardianTypedName:'Synthetic name'},{programTerms:historicalTrip390V2Fields().acknowledgment.programTerms},{studentAgreement:historicalTrip390V2Fields().acknowledgment.studentAgreement}])expect(trip390CurrentInterestSchema.safeParse({...fields,acknowledgment:{...fields.acknowledgment,...change}}).success).toBe(false);
  expect(JSON.stringify(fields.acknowledgment)).not.toContain('guardianTypedName');
 });
 it.each(['en','he'] as const)('preserves the complete historical V2 %s agreement without accepting it as a new reservation',locale=>{
  const agreement=trip390StudentAgreement(locale);
  expect(createHash('sha256').update(agreement.text).digest('hex')).toBe(agreement.textDigest);
  const fields=historicalTrip390V2Fields();fields.acknowledgment.language=locale;
  const terms=trip390ProgramTerms(locale);fields.acknowledgment.programTerms={version:terms.version,language:locale,text:terms.text,textDigest:terms.textDigest};
  fields.acknowledgment.studentAgreement={version:agreement.version,language:locale,text:agreement.text,textDigest:agreement.textDigest,guardianTypedName:'Synthetic Guardian'};
  expect(trip390V2InterestSchema.safeParse(fields).success).toBe(true);expect(trip390InterestSchema.parse(fields)).toEqual(fields);expect(trip390CurrentInterestSchema.safeParse(fields).success).toBe(false);
  for(const change of [{text:agreement.text+'changed'},{textDigest:'0'.repeat(64)},{language:locale==='en'?'he':'en'},{guardianTypedName:''},{version:'old'}]){
   expect(trip390V2InterestSchema.safeParse({...fields,acknowledgment:{...fields.acknowledgment,studentAgreement:{...fields.acknowledgment.studentAgreement,...change}}}).success).toBe(false);
  }
  for(const change of [{text:terms.text+'not displayed'},{textDigest:'0'.repeat(64)},{language:locale==='en'?'he':'en'},{version:'old'}])expect(trip390V2InterestSchema.safeParse({...fields,acknowledgment:{...fields.acknowledgment,programTerms:{...fields.acknowledgment.programTerms,...change}}}).success).toBe(false);
 });
 it('preserves v1 optional phone, adult-age answer and historical notes without accepting it as a new write',()=>{
  const current=currentTrip390Fields();const {phone:_,lessonDayDriving:__,...rest}=current;void _;void __;
  const prior={...rest,version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,children:[{...current.children[0],ageYears:22}],notes:'Historical answer',acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false}};
  expect(trip390InterestSchema.parse(prior)).toEqual(prior);expect(trip390CurrentInterestSchema.safeParse(prior).success).toBe(false);
  expect(trip390V1Notice.en.conduct).toBe('I have read and explained the Fishing Academy conduct rules to each child listed.');
 });
 it('keeps total-day driving, leading-zero ZIP, siblings, parent language and guardian evidence in owner readback',()=>{
  const fields=currentTrip390Fields();fields.children.push({...fields.children[0]!,id:randomUUID(),name:'Synthetic Sibling',ageYears:9});
  const html=renderToStaticMarkup(createElement(AcademyTrip390Readback,{fields,reference:randomUUID(),receivedAt:'2026-11-04T12:00:00Z',locale:'en'}));
  for(const value of ['01234-5678','Synthetic Sibling','60 minutes total','Hebrew',fields.acknowledgment.studentConduct.textDigest,'No child signature'])expect(html).toContain(value);
 });
});

it.each([TRIP390_MEDIA_TYPE,TRIP390_V1_MEDIA_TYPE,TRIP390_V2_MEDIA_TYPE])('can resolve an exact saved receipt with new writes closed (%s)',async media=>{
 const key='synthetic-versioning-key-at-least-32chars',origin='https://unit.example.invalid';let now=Date.now();
 const fields=currentTrip390Fields();
 const {lessonDayDriving:_,...historicalBase}=fields;void _;
 const prior=media===TRIP390_V1_MEDIA_TYPE?{...historicalBase,version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false}}:media===TRIP390_V2_MEDIA_TYPE?historicalTrip390V2Fields():fields;
 const command={operationId:randomUUID(),fields:prior},reference=randomUUID();
 const submit=vi.fn(),replaySaved=vi.fn().mockResolvedValue({saved:true,replayed:true,duplicate:true,item:{id:reference}});
 const deps={enabled:true,environment:{NODE_ENV:'test',LS_APP_ORIGIN:origin,LS_ACADEMY_PUBLIC_OFFER:'JLFA-KEYS390-v2'},challengeKey:key,now:()=>now,limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:1000}))},store:{submit,replaySaved}};
 const url=origin+'/api/public/group-applications?program=sunday_fishing_academy',headers={host:'unit.example.invalid',accept:media};
 const get=await publicGroupApplicationHttp(new Request(url,{headers}),async()=>deps);expect(get.status).toBe(200);
 const issued=(await get.json()).data,cookie=get.headers.get('set-cookie')!.split(';')[0]!;now+=1600;
 const post=()=>publicGroupApplicationHttp(new Request(url,{method:'POST',headers:{...headers,origin,cookie,'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({...command,challenge:issued.challenge,website:''})}),async()=>deps);
 expect((await post()).status).toBe(200);expect(replaySaved).toHaveBeenCalledOnce();expect(submit).not.toHaveBeenCalled();
 replaySaved.mockResolvedValue(null);expect((await post()).status).toBe(media===TRIP390_MEDIA_TYPE?403:400);expect(submit).not.toHaveBeenCalled();
});

it.each(['en','he'] as const)('binds the nonbinding -07 notice and exactly three ordered controls (%s)',locale=>{
 const terms=trip390ProgramTerms(locale);expect(createHash('sha256').update(terms.text).digest('hex')).toBe(terms.textDigest);
 const html=renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale:locale}));
 const names=[...html.matchAll(/<input[^>]+type="checkbox"[^>]+name="([^"]+)"/g)].map(match=>match[1]);expect(names).toEqual(['interest','conduct','whatsapp']);
 const notice=trip390ReservationNotice(locale);expect(createHash('sha256').update(notice.text).digest('hex')).toBe(notice.textDigest);
 expect(html).toContain(notice.version);expect(html).toContain(notice.textDigest);expect(html).not.toContain('name="guardianTypedName"');
 for(const paragraph of notice.paragraphs)expect(html).toContain(paragraph.replaceAll('&','&amp;'));
 expect(html).not.toMatch(/name="whatsapp"[^>]*(?:checked|disabled="false")/);
 const f=currentTrip390Fields();for(const bad of [{text:notice.text+'not displayed'},{textDigest:'0'.repeat(64)},{language:'he'},{version:'old'}])expect(trip390CurrentInterestSchema.safeParse({...f,acknowledgment:{...f.acknowledgment,reservationNotice:{...f.acknowledgment.reservationNotice,...bad}}}).success).toBe(false);
 const conduct=trip390StudentConduct(locale);expect(createHash('sha256').update(conduct.text).digest('hex')).toBe(conduct.textDigest);
});
