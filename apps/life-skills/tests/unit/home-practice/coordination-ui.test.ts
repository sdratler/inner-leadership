import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {asId} from '../../../src/lib/ids.ts';
import {CoordinationForm,PracticeCoordinationWorkspace} from '../../../src/features/home-practice/coordination-workspace.tsx';
const own=asId('123e4567-e89b-12d3-a456-426614174000','account'),other=asId('123e4567-e89b-12d3-a456-426614174001','account');
const handlers={onChange:()=>{},onSave:()=>{},onCancel:()=>{}};
test.each(['en','he'] as const)('%s adult self-coordination has no parent selector, preserves routing semantics and locks uncertain input',locale=>{
 const page={ownAccountId:own,role:'adult_client' as const,eligibleAccountIds:[own],versions:[],hasMore:false};
 const html=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[own],reminders:[],mode:'any_assignee',locked:false}));
 expect(html).not.toContain('<select');expect(html).not.toContain(locale==='he'?'הורה מורשה':'Authorized parent');expect(html).toContain(locale==='he'?'אני':'Me');expect(html).toContain(locale==='he'?'אינה מפעילה משלוח':'does not enable delivery');expect(html).toContain(locale==='he'?'הפעולה אינה קובעת תרגול':'does not schedule practice');
 const locked=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[own],reminders:[own],mode:'any_assignee',locked:true}));expect(locked).toContain('disabled=""');expect(locked).toContain('checked=""');
 const collapsed=renderToStaticMarkup(createElement(PracticeCoordinationWorkspace,{locale,role:'adult_client',caseId:'case',audienceId:'audience',assignmentId:'assignment'}));expect(collapsed).toContain('<details');expect(collapsed).not.toContain('open=""');
});
test.each(['en','he'] as const)('%s authorized shared parents can choose explicit any/each completion independently of reminders',locale=>{
 const page={ownAccountId:own,role:'parent' as const,eligibleAccountIds:[own,other],versions:[],hasMore:false};
 const html=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[own,other],reminders:[own],mode:'each_assignee',locked:false}));
 expect(html).toContain('value="each_assignee" selected=""');expect(html).toContain('value="any_assignee"');expect(html).toContain('<legend');expect(html).toContain(locale==='he'?'הורה מורשה 2':'Authorized parent 2');
 const empty=renderToStaticMarkup(createElement(CoordinationForm,{...handlers,locale,page,assignees:[],reminders:[],mode:'any_assignee',locked:false}));expect(empty).toContain('type="submit" disabled=""');
});
