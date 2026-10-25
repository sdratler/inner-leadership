import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
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
  for(const field of ['parentName','contact','postalCode','receiptEmail','preferredDays','preferredTimes','driveMinutes','schoolHoursAvailability','preferredGroupLanguage','stageInterest','optionalNotes','permission']){
   const target=registrationErrorTarget(field,[],locale);expect(target).not.toBeNull();expect(html).toContain('id="'+target!.id+'"');
  }
  expect(html).toContain(locale==='en'?'bring any fishing equipment you already have':'הביאו ציוד דיג שכבר יש לכם');
  expect(html).not.toMatch(/name="(?:equipment|gearOwnership|dropOff)"/);
  expect(html).not.toContain('role="alert"');
 });
});
