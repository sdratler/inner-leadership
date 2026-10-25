import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {academyCommunicationNotice,academyCommunicationNoticeHashes,communicationPreferenceSelection} from '../../src/features/group-application/academy-communication-preferences.ts';
import {AcademyRegistrationForm,registrationErrorTarget} from '../../src/features/group-application/academy-registration-form.tsx';

describe('Academy registration error destinations',()=>{
 it('links sibling errors to stable child IDs with localized ordinal labels',()=>{
  const children=[{id:'first-stable-id'},{id:'second-stable-id'}];
  expect(registrationErrorTarget('child-second-stable-id-age',children,'en')).toEqual({id:'registration-child-second-stable-id-age',label:'Child 2 — Age'});
  expect(registrationErrorTarget('child-second-stable-id-grade',children,'he')).toEqual({id:'registration-child-second-stable-id-grade',label:'ילד 2 — כיתה'});
  expect(registrationErrorTarget('child-first-stable-id-name',children.slice(1),'en')).toBeNull();
  expect(registrationErrorTarget('child-second-stable-id-unknown',children,'en')).toBeNull();
 });
 it('maps nested consent to its control and does not invent destinations for contract-only errors',()=>{
  expect(registrationErrorTarget('permission.confirmed',[],'en')?.id).toBe('registration-permission');
  expect(registrationErrorTarget('permission.version',[],'he')?.id).toBe('registration-permission');
  expect(registrationErrorTarget('operationId',[],'en')).toBeNull();
  expect(registrationErrorTarget('academyRegistration.learners',[],'en')).toBeNull();
 });
 it.each(['en','he'] as const)('renders matching accessible controls and first-meeting instruction in %s',locale=>{
  const html=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'}));
  for(const field of ['parentName','contact','postalCode','receiptEmail','preferredDays','preferredTimes','driveMinutes','schoolHoursAvailability','preferredGroupLanguage','optionalNotes','permission']){
   const target=registrationErrorTarget(field,[],locale);expect(target).not.toBeNull();expect(html).toContain('id="'+target!.id+'"');
  }
  expect(html).toContain(locale==='en'?'Bring any fishing equipment you already own':'הביאו ציוד דיג שכבר יש לכם');
  expect(html).not.toMatch(/name="(?:equipment|gearOwnership|dropOff|stageInterest)"/);
  expect(registrationErrorTarget('stageInterest',[],locale)).toBeNull();
  expect(html).not.toContain('role="alert"');
 });
});

it.each(['en','he'] as const)('%s short form retains separate language and optional consent controls',locale=>{
 const html=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'}));
 for(const name of ['parentLanguage','preferredGroupLanguage','nurtureEmail','privateWapi','permission','contact','receiptEmail'])expect(html).toContain('name="'+name+'"');
 for(const name of ['nurtureEmail','privateWapi','permission'])expect(html.match(new RegExp('<input[^>]*name="'+name+'"[^>]*>'))?.[0]).not.toContain('checked=""');
 expect(html).toContain('type="tel"');expect(html).toContain('data-academy-program-terms');expect(html).toContain(locale==='he'?'אני מסכים/ה לתנאי ההרשמה ולהודעת הפרטיות.':'I agree to the registration terms and privacy notice.');
 expect(html).toContain(locale==='he'?'עדכונים (לא חובה)':'Updates (optional)');expect(html).not.toContain('name="stageInterest"');
});

it.each(['en','he'] as const)('%s optional choices expose the exact versioned notice recorded by the command',locale=>{
 const html=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'})),selection=communicationPreferenceSelection(locale,false,false,locale);
 const disclosure=html.match(/<details[^>]*><summary>(?:Updates \(optional\)|עדכונים \(לא חובה\))<\/summary>([\s\S]*?)<\/details>/)?.[1];expect(disclosure).toBeDefined();
 expect(disclosure).toContain(renderToStaticMarkup(createElement('p',null,academyCommunicationNotice[locale])));
 for(const [attribute,value] of [['id',selection.notice.documentId],['version',selection.notice.version],['language',selection.notice.language],['sha256',selection.notice.textSha256]])expect(disclosure).toContain('data-document-'+attribute+'="'+value+'"');
 expect(disclosure).toContain(academyCommunicationNoticeHashes[locale]);expect(disclosure).toContain('<bdi dir="ltr">'+academyCommunicationNotice.version+'</bdi>');
 for(const name of ['nurtureEmail','privateWapi'])expect(disclosure?.match(new RegExp('<input[^>]*name="'+name+'"[^>]*>'))?.[0]).not.toMatch(/checked=""|required=""/);
 expect(html).not.toMatch(/<details[^>]*open=[^>]*><summary>(?:Updates|עדכונים)/);
});
