import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {asId} from '../../../src/lib/ids.ts';
import {readFileSync} from 'node:fs';
import {CoordinationForm,PracticeCoordinationWorkspace} from '../../../src/features/home-practice/coordination-workspace.tsx';
import {coordinationDefaults} from '../../../src/features/home-practice/coordination-client.ts';
const own=asId('123e4567-e89b-12d3-a456-426614174000','account'),other=asId('123e4567-e89b-12d3-a456-426614174001','account');
const handlers={onChange:()=>{},onSave:()=>{},onCancel:()=>{}};
test.each(['en','he'] as const)('%s retained legacy child coordination is read-only with no parent-only save control',locale=>{
 const page={ownAccountId:own,role:'parent' as const,eligibleAccountIds:[],readOnlyReason:'legacy_child_assignment' as const,asOf:'2026-10-01T12:00:00Z',currentVersion:null,versions:[],hasMore:false};
 const html=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[own,other],reminders:[other],mode:'each_assignee',locked:false}));
 expect(html).toContain(locale==='he'?'לא הוסרה אחריות':'No responsibility or reminder routing has been removed');expect(html).not.toContain('<form');expect(html).not.toContain('<input');expect(html).not.toContain('<button');
});

test.each(['en','he'] as const)('%s form explains and renders effective defaults while a newer recorded change is pending',locale=>{
 const assignmentId=asId('123e4567-e89b-12d3-a456-426614174002','practice_assignment'),caseId=asId('123e4567-e89b-12d3-a456-426614174003','case'),audienceId=asId('123e4567-e89b-12d3-a456-426614174004','audience');
 const current={versionId:asId('123e4567-e89b-12d3-a456-426614174005','coordination_version'),assignmentId,caseId,audienceId,assigneeAccountIds:[own,other],completionMode:'each_assignee' as const,reminderCandidateAccountIds:[other],effectiveFrom:'2026-10-01T11:00:00Z',changedByAccountId:own};
 const page={ownAccountId:own,role:'parent' as const,eligibleAccountIds:[own,other],asOf:'2026-10-01T12:00:00Z',currentVersion:current,versions:[{...current,effectiveFrom:'2026-10-02T11:00:00Z',completionMode:'any_assignee' as const}],hasMore:false};
 const html=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,...coordinationDefaults(page),locked:false}));
 expect(html).toContain(locale==='he'?'העריכה מתחילה מהתיאום שחל כעת':'Editing starts from the currently effective coordination');expect(html).toContain('value="each_assignee" selected=""');
});
test.each(['en','he'] as const)('%s adult self-coordination has no parent selector, preserves routing semantics and locks uncertain input',locale=>{
 const page={ownAccountId:own,role:'adult_client' as const,eligibleAccountIds:[own],asOf:'2026-10-01T12:00:00Z',currentVersion:null,versions:[],hasMore:false};
 const html=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[own],reminders:[],mode:'any_assignee',locked:false}));
 expect(html).not.toContain('<select');expect(html).not.toContain(locale==='he'?'הורה מורשה':'Authorized parent');expect(html).toContain(locale==='he'?'אני':'Me');expect(html).toContain(locale==='he'?'אינה מפעילה משלוח':'does not enable delivery');expect(html).toContain(locale==='he'?'הפעולה אינה קובעת תרגול':'does not schedule practice');
 const locked=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[own],reminders:[own],mode:'any_assignee',locked:true}));expect(locked).toContain('disabled=""');expect(locked).toContain('checked=""');
 const collapsed=renderToStaticMarkup(createElement(PracticeCoordinationWorkspace,{locale,role:'adult_client',caseId:'case',audienceId:'audience',assignmentId:'assignment'}));expect(collapsed).toContain('<details');expect(collapsed).not.toContain('open=""');
});
test.each(['en','he'] as const)('%s authorized shared parents can choose explicit any/each completion independently of reminders',locale=>{
 const page={ownAccountId:own,role:'parent' as const,eligibleAccountIds:[own,other],asOf:'2026-10-01T12:00:00Z',currentVersion:null,versions:[],hasMore:false};
 const html=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[own,other],reminders:[own],mode:'each_assignee',locked:false}));
 expect(html).toContain('value="each_assignee" selected=""');expect(html).toContain('value="any_assignee"');expect(html).toContain('<legend');expect(html).toContain(locale==='he'?'הורה מורשה 2':'Authorized parent 2');
 const empty=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[],reminders:[],mode:'any_assignee',locked:false}));expect(empty).toContain('type="submit" disabled=""');
});
test('participant labels stay consistent when selection order differs, and phone actions wrap as complete readable buttons',()=>{
 const page={ownAccountId:own,role:'parent' as const,eligibleAccountIds:[other,own],asOf:'2026-10-01T12:00:00Z',currentVersion:null,versions:[],hasMore:false};
 const html=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale:'en',page,assignees:[own,other],reminders:[],mode:'each_assignee',locked:false}));
 expect(html.match(/Authorized parent 1/g)).toHaveLength(2);expect(html).not.toContain('Authorized parent 2');
 const css=readFileSync(new URL('../../../src/features/home-practice/coordination.css',import.meta.url),'utf8');
 expect(css).toContain('flex-wrap: wrap');expect(css).toContain('min-inline-size: 0');expect(css).toContain('word-break: normal');expect(css).toContain('(max-width: 520px)');
});
