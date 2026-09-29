import { expect, it } from 'vitest';
import { practitionerDetailReturnPath, practitionerReturnPath } from '../../../src/features/identity/login-return.ts';

it('preserves only a bounded legacy lead ID on a practitioner People return link', () => {
  expect(practitionerReturnPath('he', 'clients', { section: 'prospects', leadId: 'LS-LEAD-synthetic-one' }))
    .toBe('/he/app/clients?section=prospects&leadId=LS-LEAD-synthetic-one');
  expect(practitionerReturnPath('en', 'clients', { leadId: 'javascript:alert(1)' }))
    .toBe('/en/app/clients');
});
const caseId='123e4567-e89b-42d3-a456-426614174000',sessionId='223e4567-e89b-42d3-a456-426614174000';
it('preserves only bounded report and session context on a same-locale practitioner login return',()=>{
 const context={mode:'demo',date:'2026-09-22',view:'day',role:'parent',secret:'not-forwarded'};
 for(const path of [`/he/app/cases/${caseId}/sessions`,`/he/app/cases/${caseId}/sessions/${sessionId}`]){
  const url=new URL(practitionerDetailReturnPath('he',path,{...context,caseId:sessionId}),'https://private.invalid');
  expect(url.pathname).toBe(path);expect(Object.fromEntries(url.searchParams)).toEqual({mode:'demo',date:'2026-09-22',view:'day'});
 }
 expect(practitionerDetailReturnPath('he','/he/app/reports',{...context,caseId,audienceId:sessionId,context:'client'})).toBe(`/he/app/reports?mode=demo&date=2026-09-22&view=day&caseId=${caseId}&audienceId=${sessionId}&context=client`);
 for(const path of ['/en/app/reports','/he/family/reports','//untrusted.invalid/app/reports',`/he/app/cases/${caseId}/sessions/../../private`])expect(practitionerDetailReturnPath('he',path,context)).toBe('/he/app/calendar');
 expect(practitionerDetailReturnPath('he','/he/app/reports',{mode:['demo','live'],date:'2026-02-30',view:'private',caseId:'not-a-case'})).toBe('/he/app/reports');
});
it('preserves an exact practitioner demo Calendar destination, not repeated or invalid mode',()=>{
 expect(practitionerReturnPath('he','calendar',{date:'2026-09-28',view:'month',mode:'demo'})).toBe('/he/app/calendar?date=2026-09-28&view=month&mode=demo');
 expect(practitionerReturnPath('en','calendar',{mode:['demo','live']})).toBe('/en/app/calendar');
 expect(practitionerReturnPath('en','calendar',{mode:'all'})).toBe('/en/app/calendar');
});
