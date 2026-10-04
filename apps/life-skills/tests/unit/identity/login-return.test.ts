import { expect, it } from 'vitest';
import { clientReturnPath, loginReturnDestination, practitionerDetailReturnPath, practitionerReturnPath } from '../../../src/features/identity/login-return.ts';
import {settingsItems} from '../../../src/ui/workspace/navigation-model.ts';

it('preserves only a bounded legacy lead ID on a practitioner People return link', () => {
  expect(practitionerReturnPath('he', 'clients', { section: 'prospects', leadId: 'LS-LEAD-synthetic-one' }))
    .toBe('/he/app/clients?section=prospects&leadId=LS-LEAD-synthetic-one');
  expect(practitionerReturnPath('en', 'clients', { leadId: 'javascript:alert(1)' }))
    .toBe('/en/app/clients');
});
const caseId='123e4567-e89b-42d3-a456-426614174000',sessionId='223e4567-e89b-42d3-a456-426614174000';
it.each(['he','en'] as const)('preserves a validated %s Calendar task query through ordinary login without granting another role access',locale=>{
 const path=practitionerReturnPath(locale,'calendar',{date:'2026-10-02',view:'agenda',taskId:caseId});
 expect(path).toBe(`/${locale}/app/calendar?date=2026-10-02&view=agenda&taskId=${caseId}`);
 expect(loginReturnDestination(locale,'practitioner',path)).toBe(path);
 for(const role of ['parent','child','adult_client'] as const)expect(loginReturnDestination(locale,role,path)).not.toBe(path);
 for(const taskId of ['constructor','../private',[caseId,caseId]])expect(practitionerReturnPath(locale,'calendar',{taskId})).toBe(`/${locale}/app/calendar`);
});
it.each(['he','en']as const)('keeps only a bounded %s Community thread link through ordinary login',locale=>{
 const path=`/${locale}/app/marketing`,result=practitionerDetailReturnPath(locale,path,{section:'community',threadId:caseId,ownerId:sessionId});expect(result).toBe(path+'?section=community&threadId='+caseId);expect(loginReturnDestination(locale,'practitioner',result)).toBe(result);
 for(const role of ['parent','child','adult_client']as const)expect(loginReturnDestination(locale,role,result)).not.toBe(result);
 for(const threadId of ['constructor','../private',[caseId,caseId]])expect(practitionerDetailReturnPath(locale,path,{section:'community',threadId})).toBe(path+'?section=community');
 expect(practitionerDetailReturnPath(locale,path,{section:'ads',threadId:caseId})).toBe(path+'?section=ads');
});
it.each(['he','en'] as const)('retains bounded %s creative filters through login, without inherited, repeated or control values',locale=>{
 const path=`/${locale}/app/marketing`,query={section:'creatives',language:'he',placement:'whatsapp_status',approval:'needs_approval',search:'שלום new topic',page:'2'};
 expect(Object.fromEntries(new URL(practitionerDetailReturnPath(locale,path,query),'https://private.invalid').searchParams)).toEqual(query);
 for(const value of ['constructor','__proto__',['he','he']])expect(practitionerDetailReturnPath(locale,path,{language:value,placement:value,approval:value,search:['one','two']})).toBe(path);
 expect(practitionerDetailReturnPath(locale,path,{search:'a'.repeat(201)})).toBe(path);expect(practitionerDetailReturnPath(locale,path,{search:'bad\ntext'})).toBe(path);
});
it.each(['he','en'] as const)('retains only a bounded %s gallery page selector through both ordinary login stages',locale=>{
 const path=`/${locale}/app/marketing`;
 for(const section of ['creatives','needs_approval'])for(const page of ['1','2','9999']){
  const next=practitionerDetailReturnPath(locale,path,{section,page});expect(next).toBe(path+'?section='+section+'&page='+page);expect(loginReturnDestination(locale,'practitioner',next)).toBe(next);
 }
 for(const page of ['0','01','-1','1.5','10000','constructor','2\n',['2','2']])expect(practitionerDetailReturnPath(locale,path,{section:'creatives',page})).toBe(path+'?section=creatives');
 for(const section of ['overview','content_calendar','community','ads'])expect(practitionerDetailReturnPath(locale,path,{section,page:'2'})).toBe(path+'?section='+section);
});
it.each(['he','en'] as const)('preserves exact bounded %s Marketing context through ordinary login, never another role or arbitrary query',locale=>{
 const path=`/${locale}/app/marketing`,query={section:'content_calendar',filter:'queued',month:'2026-10',layout:'week',date:'2026-10-02',channel:'whatsapp_status',state:'scheduled',from:'2026-10-01',to:'2026-10-09',publication:'DEMO-status-123'};
 const next=practitionerDetailReturnPath(locale,path,{...query,role:'parent',secret:'not-forwarded',caseId});expect(Object.fromEntries(new URL(next,'https://private.invalid').searchParams)).toEqual(query);expect(loginReturnDestination(locale,'practitioner',next)).toBe(next);
 for(const role of ['parent','child','adult_client'] as const)expect(loginReturnDestination(locale,role,next)).not.toBe(next);
 for(const value of ['constructor','__proto__','private',['queued','queued']])expect(practitionerDetailReturnPath(locale,path,{filter:value,channel:value,state:value,layout:value,publication:'https://untrusted.invalid',from:'2026-02-30'})).toBe(path);
 for(const other of [path+'/unknown',`/${locale==='he'?'en':'he'}/app/marketing`,`//untrusted.invalid${path}`])expect(practitionerDetailReturnPath(locale,other,query)).toBe(`/${locale}/app/calendar`);
});
it.each(['he','en'] as const)('preserves the existing %s Communications destination and bounded selected case through normal login',locale=>{
 const path=`/${locale}/app/feedback`;
 for(const section of ['app_updates','whatsapp']){
  const next=practitionerDetailReturnPath(locale,path,{caseId,audienceId:sessionId,section,context:'client',mode:'demo',role:'parent',secret:'not-forwarded'});
  expect(new URL(next,'https://private.invalid').pathname).toBe(path);
  expect(Object.fromEntries(new URL(next,'https://private.invalid').searchParams)).toEqual({mode:'demo',context:'client',caseId,section});
  expect(loginReturnDestination(locale,'practitioner',next)).toBe(next);
  for(const role of ['parent','child','adult_client'] as const)expect(loginReturnDestination(locale,role,next)).not.toBe(next);
 }
 expect(practitionerDetailReturnPath(locale,path,{caseId:[caseId,caseId],section:['whatsapp','app_updates'],context:['client','client']})).toBe(path);
 expect(practitionerDetailReturnPath(locale,path,{caseId:'malformed',section:'private',secret:'not-forwarded'})).toBe(path);
 for(const other of [path+'/unknown',`/${locale==='he'?'en':'he'}/app/feedback`, `//untrusted.invalid${path}`])expect(practitionerDetailReturnPath(locale,other,{})).toBe(`/${locale}/app/calendar`);
});
for(const locale of ['he','en'] as const)for(const page of ['forms','resources'])it(`${locale}: preserves named ${page} through ordinary adult and practitioner login without arbitrary query data`,()=>{
 const client=clientReturnPath(locale,`/${locale}/client/${page}`,{caseId,role:'practitioner',secret:'not-forwarded'});
 expect(client).toBe(`/${locale}/client/${page}?caseId=${caseId}`);expect(loginReturnDestination(locale,'adult_client',client)).toBe(client);
 expect(loginReturnDestination(locale,'parent',client)).toBe(`/${locale}/family/schedule`);
 const staff=practitionerDetailReturnPath(locale,`/${locale}/app/${page}`,{caseId,context:'client',mode:'demo',role:'parent',secret:'not-forwarded'});
 expect(new URL(staff,'https://private.invalid').searchParams.get('caseId')).toBe(caseId);expect(staff).toContain('/'+page+'?');expect(staff).not.toContain('secret');
 expect(practitionerDetailReturnPath(locale,`/${locale}/app/${page}`,{caseId:[caseId,caseId],context:['client','client']})).toBe(`/${locale}/app/${page}`);
});
for(const locale of ['he','en'] as const)for(const section of ['due','drafts','published','history'])it(`${locale}: preserves exact report ${section} through the bounded practitioner login return`,()=>{
 const result=new URL(practitionerDetailReturnPath(locale,`/${locale}/app/reports`,{caseId,audienceId:sessionId,section,mode:'demo',context:'client',date:'2026-09-22',view:'agenda',secret:'not-forwarded',role:'parent'}),'https://private.invalid');
 expect(Object.fromEntries(result.searchParams)).toEqual({mode:'demo',date:'2026-09-22',view:'agenda',caseId,audienceId:sessionId,context:'client',section});
 expect(loginReturnDestination(locale,'practitioner',result.pathname+result.search)).toBe(result.pathname+result.search);
 expect(loginReturnDestination(locale,'parent',result.pathname+result.search)).toBe(`/${locale}/family/schedule`);
});
it('drops invalid/repeated report sections and never forwards them to a private session',()=>{
 for(const section of ['checkins','all','private',['history','history']])expect(practitionerDetailReturnPath('en','/en/app/reports',{section})).toBe('/en/app/reports');
 expect(practitionerDetailReturnPath('he',`/he/app/cases/${caseId}/sessions/${sessionId}`,{section:'history'})).toBe(`/he/app/cases/${caseId}/sessions/${sessionId}`);
});
it.each(['he','en'] as const)('preserves exact bounded %s practitioner check-in login context',locale=>{
 const path=practitionerReturnPath(locale,'practice',{caseId,audienceId:sessionId,assignmentId:caseId,section:'checkins',secret:'not-forwarded',mode:'demo'});
 expect(path).toBe(`/${locale}/app/practice?caseId=${caseId}&audienceId=${sessionId}&assignmentId=${caseId}&section=checkins`);
 expect(loginReturnDestination(locale,'practitioner',path)).toBe(path);
 expect(practitionerReturnPath(locale,'practice',{caseId:['valid','repeated'],audienceId:'malformed',section:'private'})).toBe(`/${locale}/app/practice`);
});
for(const locale of ['he','en'] as const)for(const section of ['goals','commitments'])it(`${locale}: preserves the authorized practitioner practice ${section} view through normal login`,()=>{
 const path=practitionerReturnPath(locale,'practice',{caseId,audienceId:sessionId,section,role:'parent',secret:'not-forwarded'});
 expect(path).toBe(`/${locale}/app/practice?caseId=${caseId}&audienceId=${sessionId}&section=${section}`);
 expect(loginReturnDestination(locale,'practitioner',path)).toBe(path);
 expect(loginReturnDestination(locale,'child',path)).toBe(`/${locale}/client`);
 expect(practitionerReturnPath(locale,'practice',{section:[section,section]})).toBe(`/${locale}/app/practice`);
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
it.each(['he','en'] as const)('preserves only the exact %s practitioner Settings templates login destination',locale=>{
 const path=`/${locale}/app/settings/templates`;
 expect(practitionerDetailReturnPath(locale,path,{caseId,role:'parent',secret:'not-forwarded',mode:'demo'})).toBe(path);
 expect(loginReturnDestination(locale,'practitioner',path)).toBe(path);
 for(const role of ['parent','adult_client','child'] as const)expect(loginReturnDestination(locale,role,path)).not.toBe(path);
 for(const other of ['/he/app/settings/templates/other','//external.invalid/en/app/settings/templates','/en/family/settings/templates'])expect(practitionerDetailReturnPath(locale,other,{})).toBe(`/${locale}/app/calendar`);
});
it.each(['he','en'] as const)('preserves the current %s practitioner Settings destinations without reflecting private context or unknown routes',locale=>{
 const paths=[`/${locale}/app/settings`,...settingsItems('practitioner').map(item=>`/${locale}/${item.path}`)];
 for(const path of paths){
  expect(practitionerDetailReturnPath(locale,path,{caseId,role:'parent',secret:'not-forwarded',mode:'demo',section:['private','all']})).toBe(path);
  expect(loginReturnDestination(locale,'practitioner',path)).toBe(path);
  for(const role of ['parent','adult_client','child'] as const)expect(loginReturnDestination(locale,role,path)).not.toBe(path);
  expect(practitionerDetailReturnPath(locale,path+'/other',{})).toBe(`/${locale}/app/calendar`);
 }
 for(const path of [`/${locale}/app/settings/unknown`,`/${locale}/app/settings/../private-notes`,`/${locale==='en'?'he':'en'}/app/settings/notifications`,`//untrusted.invalid/${locale}/app/settings/notifications`])expect(practitionerDetailReturnPath(locale,path,{})).toBe(`/${locale}/app/calendar`);
});
