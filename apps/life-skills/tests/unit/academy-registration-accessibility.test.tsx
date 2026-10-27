import {academyExactCopy} from '../../src/features/group-application/academy-exact-copy.ts';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {academyCommunicationNotice,academyCommunicationNoticeHashes,communicationPreferenceSelection} from '../../src/features/group-application/academy-communication-preferences.ts';
import {academyConductAttestation,academyProgramInformationAcceptance} from '../../src/features/group-application/academy-registration-acknowledgments.ts';
import {AcademyRegistrationForm,registrationErrorTarget} from '../../src/features/group-application/academy-registration-form.tsx';

describe('Academy registration error destinations',()=>{
 it('links sibling errors to stable child IDs with localized ordinal labels',()=>{
  const children=[{id:'first-stable-id'},{id:'second-stable-id'}];
  expect(registrationErrorTarget('child-second-stable-id-age',children,'en')).toEqual({id:'registration-child-second-stable-id-age',label:'Child 2 — Age'});
  expect(registrationErrorTarget('child-second-stable-id-grade',children,'he')).toEqual({id:'registration-child-second-stable-id-grade',label:'ילד 2 — '+academyExactCopy.he.form.labels.grade});
  expect(registrationErrorTarget('child-first-stable-id-name',children.slice(1),'en')).toBeNull();
  expect(registrationErrorTarget('child-second-stable-id-unknown',children,'en')).toBeNull();
 });
 it('maps nested consent to its control and does not invent destinations for contract-only errors',()=>{
  expect(registrationErrorTarget('permission.confirmed',[],'en')?.id).toBe('registration-permission');
  expect(registrationErrorTarget('permission.version',[],'he')?.id).toBe('registration-permission');
  expect(registrationErrorTarget('acknowledgments.conduct.childIds',[],'en')?.id).toBe('registration-conductExplained');
  expect(registrationErrorTarget('acknowledgments.programInformation',[],'he')?.id).toBe('registration-permission');
  expect(registrationErrorTarget('operationId',[],'en')).toBeNull();
  expect(registrationErrorTarget('academyRegistration.learners',[],'en')).toBeNull();
 });
 it.each(['en','he'] as const)('renders matching accessible controls and first-meeting instruction in %s',locale=>{
  const html=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'}));
  for(const field of ['parentName','contact','postalCode','receiptEmail','preferredDays','preferredTimes','driveMinutes','schoolHoursAvailability','preferredGroupLanguage','optionalNotes','permission']){
   const target=registrationErrorTarget(field,[],locale);expect(target).not.toBeNull();expect(html).toContain('id="'+target!.id+'"');
  }
  expect(html).toContain(academyExactCopy[locale].form.equipmentLine);
  expect(html).not.toMatch(/name="(?:equipment|gearOwnership|dropOff|stageInterest)"/);
  expect(registrationErrorTarget('stageInterest',[],locale)).toBeNull();
  expect(html).not.toContain('role="alert"');
 });
});

it.each(['en','he'] as const)('%s short form retains separate language and optional consent controls',locale=>{
 const html=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'}));
 for(const name of ['parentLanguage','preferredGroupLanguage','conductExplained','privateWapi','permission','contact','receiptEmail'])expect(html).toContain('name="'+name+'"');
 expect(html).not.toContain('name="nurtureEmail"');
 for(const name of ['conductExplained','privateWapi','permission'])expect(html.match(new RegExp('<input[^>]*name="'+name+'"[^>]*>'))?.[0]).not.toContain('checked=""');
 for(const name of ['conductExplained','permission'])expect(html.match(new RegExp('<input[^>]*name="'+name+'"[^>]*>'))?.[0]).toContain('required=""');
 expect(html).toContain(renderToStaticMarkup(createElement('span',null,academyExactCopy[locale].form.conductCheckbox)));
 expect(academyExactCopy[locale].form.conductCheckbox).toBe(academyConductAttestation[locale]);
 expect(academyExactCopy[locale].form.requiredCheckbox).toBe(academyProgramInformationAcceptance[locale]);
 expect(academyExactCopy[locale].form.whatsappUpdates).toBe(academyCommunicationNotice[locale]);
 expect(html).toContain('type="tel"');expect(html).toContain('data-academy-program-terms');expect(html).toContain(renderToStaticMarkup(createElement('span',null,academyExactCopy[locale].form.requiredCheckbox)));
 expect(html).toContain(locale==='he'?'עדכונים (לבחירה)':'Updates (optional)');expect(html).not.toContain('name="stageInterest"');
});

it.each(['en','he'] as const)('%s optional choices expose the exact versioned notice recorded by the command',locale=>{
 const html=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'})),selection=communicationPreferenceSelection(locale,false,locale);
 const disclosure=html.match(/<details[^>]*><summary id="academy-optional-updates-notice">(?:Updates \(optional\)|עדכונים \(לבחירה\))<\/summary>([\s\S]*?)<\/details>/)?.[1];expect(disclosure).toBeDefined();
 expect(disclosure).toContain(renderToStaticMarkup(createElement('p',null,academyCommunicationNotice[locale])));
 for(const [attribute,value] of [['id',selection.notice.documentId],['version',selection.notice.version],['language',selection.notice.language],['sha256',selection.notice.textSha256]])expect(disclosure).toContain('data-document-'+attribute+'="'+value+'"');
 expect(disclosure).toContain(academyCommunicationNoticeHashes[locale]);expect(disclosure).toContain('<bdi dir="ltr">'+academyCommunicationNotice.version+'</bdi>');
 expect(disclosure).not.toMatch(/<input/);
 const whatsapp=html.match(/<input[^>]*name="privateWapi"[^>]*>/)?.[0];expect(whatsapp).toBeDefined();expect(whatsapp).not.toMatch(/checked=""|required=""/);
 expect(html.match(/name="academy-program-information"/g)).toHaveLength(7);
 expect(html).not.toMatch(/<details[^>]*open=[^>]*><summary>(?:Updates|עדכונים)/);
});

it.each(['en','he'] as const)('%s exact form labels preserve independent language choices, numeric inputs and empty grade',locale=>{
 const html=renderToStaticMarkup(createElement(AcademyRegistrationForm,{locale,mode:'sample'})),c=academyExactCopy[locale].form;
 for(const label of Object.values(c.labels))expect(html).toContain(renderToStaticMarkup(createElement('span',null,label)).slice(6,-7));
 expect(html.match(/<input[^>]*name="contact"[^>]*>/)?.[0]).not.toContain('required=""');expect(html.match(/<input[^>]*name="receiptEmail"[^>]*>/)?.[0]).toContain('required=""');
 expect(html).toMatch(/<input[^>]*type="text"[^>]*name="postalCode"/);expect(html).toContain('min="5" max="120" step="1"');
 for(const grade of Object.keys(c.options.grades))expect(html).toContain('value="'+grade+'"');
 expect(html).toContain('<option value="" selected="">'+c.gradePlaceholder+'</option>');
 for(const value of ['en','he','either'])expect([...html.matchAll(/<input[^>]*name="preferredGroupLanguage"[^>]*>/g)].some(match=>match[0].includes('value="'+value+'"'))).toBe(true);
});
