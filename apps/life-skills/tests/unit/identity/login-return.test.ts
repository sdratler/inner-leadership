import { expect, it } from 'vitest';
import { clientReturnPath, loginReturnDestination, practitionerDetailReturnPath, practitionerReturnPath } from '../../../src/features/identity/login-return.ts';

it('preserves only a bounded legacy lead ID on a practitioner People return link', () => {
  expect(practitionerReturnPath('he', 'clients', { section: 'prospects', leadId: 'LS-LEAD-synthetic-one' }))
    .toBe('/he/app/clients?section=prospects&leadId=LS-LEAD-synthetic-one');
  expect(practitionerReturnPath('en', 'clients', { leadId: 'javascript:alert(1)' }))
    .toBe('/en/app/clients');
});
const caseId='123e4567-e89b-42d3-a456-426614174000',sessionId='223e4567-e89b-42d3-a456-426614174000';
it.each(['he','en'] as const)('preserves exact bounded %s practitioner check-in login context',locale=>{
 const path=practitionerReturnPath(locale,'practice',{caseId,audienceId:sessionId,assignmentId:caseId,section:'checkins',secret:'not-forwarded',mode:'demo'});
 expect(path).toBe(`/${locale}/app/practice?caseId=${caseId}&audienceId=${sessionId}&assignmentId=${caseId}&section=checkins`);
 expect(loginReturnDestination(locale,'practitioner',path)).toBe(path);
 expect(practitionerReturnPath(locale,'practice',{caseId:['valid','repeated'],audienceId:'malformed',section:'private'})).toBe(`/${locale}/app/practice`);
});
it('retains exact client check-in context for both real subject roles',()=>{
 for(const locale of ['he','en'] as const){
  const path=clientReturnPath(locale,`/${locale}/client/practice`,{caseId,audienceId:sessionId,section:'checkins',secret:'not-forwarded'});
  expect(path).toBe(`/${locale}/client/practice?caseId=${caseId}&audienceId=${sessionId}&section=checkins`);
  for(const role of ['child','adult_client'] as const)expect(loginReturnDestination(locale,role,path)).toBe(path);
 }
});
it('rejects foreign paths and malformed client context rather than reflecting caller input',()=>{
 for(const path of ['/he/client/practice','/en/family/practice','//untrusted.invalid/en/client','/en/client/unknown'])expect(clientReturnPath('en',path,{section:'checkins'})).toBe('/en/client');
 expect(clientReturnPath('en','/en/client/practice',{caseId:'not-a-case',audienceId:'bad',section:'role-switch'})).toBe('/en/client/practice');
 expect(clientReturnPath('he','/he/client/calendar',{caseId,date:'2026-09-29',view:'day',role:'practitioner'})).toBe(`/he/client/calendar?caseId=${caseId}&date=2026-09-29&view=day`);
});
it('preserves only bounded report and session context on a same-locale practitioner login return',()=>{
 const context={mode:'demo',date:'2026-09-22',view:'day',role:'parent',secret:'not-forwarded'};
 for(const path of [`/he/app/cases/${caseId}/sessions`,`/he/app/cases/${caseId}/sessions/${sessionId}`]){
  const url=new URL(practitionerDetailReturnPath('he',path,{...context,caseId:sessionId}),'https://private.invalid');
  expect(url.pathname).toBe(path);expect(Object.fromEntries(url.searchParams)).toEqual({mode:'demo',date:'2026-09-22',view:'day'});
 }
 const report=new URL(practitionerDetailReturnPath('he','/he/app/reports',{...context,caseId,audienceId:sessionId,context:'client'}),'https://private.invalid');expect(report.pathname).toBe('/he/app/reports');expect(Object.fromEntries(report.searchParams)).toEqual({mode:'demo',date:'2026-09-22',view:'day',caseId,audienceId:sessionId,context:'client'});
 for(const path of ['/en/app/reports','/he/family/reports','//untrusted.invalid/app/reports',`/he/app/cases/${caseId}/sessions/../../private`])expect(practitionerDetailReturnPath('he',path,context)).toBe('/he/app/calendar');
 expect(practitionerDetailReturnPath('he','/he/app/reports',{mode:['demo','live'],date:'2026-02-30',view:'private',caseId:'not-a-case'})).toBe('/he/app/reports');
});
it('preserves an exact practitioner demo Calendar destination, not repeated or invalid mode',()=>{
 expect(practitionerReturnPath('he','calendar',{date:'2026-09-28',view:'month',mode:'demo'})).toBe('/he/app/calendar?date=2026-09-28&view=month&mode=demo');
 expect(practitionerReturnPath('en','calendar',{mode:['demo','live']})).toBe('/en/app/calendar');
 expect(practitionerReturnPath('en','calendar',{mode:'all'})).toBe('/en/app/calendar');
});
it('keeps only the validated selected-client marker on a private session login return',()=>{
 const path=`/he/app/cases/${caseId}/sessions/${sessionId}`;
 const result=new URL(practitionerDetailReturnPath('he',path,{context:'client',mode:'demo',role:'parent'}),'https://private.invalid');expect(Object.fromEntries(result.searchParams)).toEqual({mode:'demo',context:'client'});
 for(const context of ['owner',['client','client']])expect(practitionerDetailReturnPath('he',path,{context})).toBe(path);
});
