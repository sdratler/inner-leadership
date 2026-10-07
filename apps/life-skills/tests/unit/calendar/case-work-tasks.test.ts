import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {caseTaskKinds,caseTaskTitle,isCaseTaskKind,localizedCaseTaskTitle} from '../../../src/features/calendar/case-work-copy.ts';
import {caseTaskSourcePath,readCaseWorkSources,type CaseWorkSource} from '../../../src/features/calendar/case-work-tasks.ts';
import type {TransactionContext} from '../../../src/features/calendar/store.ts';
import {CalendarAgenda,CalendarBoard} from '../../../src/features/calendar/views.tsx';
import {internalTaskPath} from '../../../src/features/calendar/validation.ts';
import {MAX_CALENDAR_TASKS} from '../../../src/features/contact-ops/core/limits.ts';
import type {InternalTask} from '../../../src/features/calendar/tasks.ts';
import {asId} from '../../../src/lib/ids.ts';

const source:CaseWorkSource={kind:'report_review',id:randomUUID(),caseId:randomUUID(),audienceId:randomUUID(),linkId:null,linkDate:null,dueDate:'2026-10-05',active:true,batchId:null};
function context(rows:CaseWorkSource[]){const query=vi.fn().mockResolvedValue(rows);return {c:{workspace:randomUUID(),actor:{id:randomUUID()},tx:{query}} as unknown as TransactionContext,query};}
it.each(caseTaskKinds)('keeps %s tasks on functioning internal routes with exact case, audience and demo context',kind=>{
 const row={...source,kind,linkId:randomUUID(),linkDate:'2026-10-12',batchId:'ls-owner-20260925'};
 const path=caseTaskSourcePath(row,'demo'),url=new URL(path,'https://local.invalid');
 expect(internalTaskPath(path)).toBe(true);expect(url.searchParams.get('mode')).toBe('demo');expect(path).toContain(row.caseId);
 if(kind==='calendar_notice')expect(url.searchParams.get('date')).toBe(row.linkDate);
 if(kind==='session_observations')expect(url.pathname).toBe(`/en/app/cases/${row.caseId}/sessions/${row.id}`);
 else expect(url.searchParams.get('caseId')).toBe(row.caseId);
});
it.each(['constructor','__proto__','toString','Unknown',' report_review '])('preserves unknown kind and custom text: %s',kind=>{
 expect(isCaseTaskKind(kind)).toBe(false);expect(localizedCaseTaskTitle('Untouched text',kind,'he')).toBe('Untouched text');
});
it.each(caseTaskKinds)('localizes only complete %s labels, without rewriting stored or custom text',kind=>{
 const title=caseTaskTitle(kind,'en');expect(localizedCaseTaskTitle(title,kind,'he')).toBe(caseTaskTitle(kind,'he'));
 expect(localizedCaseTaskTitle(title,kind,'en')).toBe(title);
 expect(localizedCaseTaskTitle(`${title} — owner wording`,kind,'he')).toBe(`${title} — owner wording`);
});
it.each(['he','en'] as const)('shows authorized case identity and escaped app-owned %s task labels in board/agenda',locale=>{
 const task:InternalTask={id:asId(source.id,'task'),caseId:asId(source.caseId,'case'),sourceKind:'report_review',title:caseTaskTitle('report_review','en'),note:null,sourcePath:caseTaskSourcePath(source,'live'),dueDate:source.dueDate,dueTime:null,state:'open',version:1,createdAt:'2026-10-05T00:00:00Z',updatedAt:'2026-10-05T00:00:00Z'};
 const common={items:[],tasks:[task],locale,names:{[source.caseId]:'DEMO <safe> client'},onOpen:vi.fn(),onCompleteTask:vi.fn()};
 for(const html of [renderToStaticMarkup(createElement(CalendarAgenda,common)),renderToStaticMarkup(createElement(CalendarBoard,{...common,dates:[source.dueDate],view:'week'}))]){
  expect(html).toContain('DEMO &lt;safe&gt; client');expect(html).toContain(caseTaskTitle('report_review',locale));expect(html).not.toContain('<safe>');
 }
 expect(task.title).toBe(caseTaskTitle('report_review','en'));expect(common.onCompleteTask).not.toHaveBeenCalled();
});
it('reads only current practitioner/workspace metadata in a complete bounded set',async()=>{
 const {c,query}=context([source]);expect(await readCaseWorkSources(c,'live')).toEqual([source]);
 expect(query).toHaveBeenCalledTimes(1);const [sql,args]=query.mock.calls[0]!;
 expect(sql).toContain('cl.practitioner_account_id=$2');expect(sql).toContain('d.case_id IS NOT NULL');
 expect(sql).toContain('JOIN ls_forms.form_submissions');expect(sql).not.toMatch(/body_ciphertext|narrative_ciphertext|values_ciphertext|notes_ciphertext|answers_ciphertext/);
 expect(args).toEqual([c.workspace,c.actor.id,false,MAX_CALENDAR_TASKS+1]);
});
it.each([
 {...source,dueDate:'2026-02-30'}, {...source,linkDate:'not a date'}, {...source,id:'constructor'},
 {...source,kind:'toString' as CaseWorkSource['kind']}, {...source,active:null as unknown as boolean},
 {...source,batchId:'ls-owner-20260925'}, {...source,audienceId:'not an audience'},
])('rejects malformed, unverified or cross-mode metadata before any task mutation: %j',async row=>{
 const {c,query}=context([row]);await expect(readCaseWorkSources(c,'live')).rejects.toMatchObject({code:'UNAVAILABLE'});expect(query).toHaveBeenCalledTimes(1);
});
it('rejects duplicates and an oversized source result without truncating success',async()=>{
 for(const rows of [[source,source],Array.from({length:MAX_CALENDAR_TASKS+1},()=>source)]){
  const {c,query}=context(rows);await expect(readCaseWorkSources(c,'live')).rejects.toMatchObject({code:'UNAVAILABLE'});expect(query).toHaveBeenCalledTimes(1);
 }
});
it.each(['https://external.invalid','/en/app/cases/constructor/sessions/constructor','/en/app/cases/'+source.caseId+'/sessions/'+source.id+'?role=practitioner','/en/app/cases/'+source.caseId+'/sessions/'+source.id+'/../settings'])('does not admit unsafe session task routes: %s',path=>expect(internalTaskPath(path)).toBe(false));
