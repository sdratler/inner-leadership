import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const workspace=readFileSync(new URL('../../../src/features/calendar/workspace.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../../../src/features/calendar/calendar.css',import.meta.url),'utf8');

describe('operational Calendar composition',()=>{
 it('keeps the same-context practice workspace mounted through ordinary reloads while authorization failures remove it',()=>{
  const layer=workspace.split('\n').find(line=>line.includes('<PracticeOccurrenceWorkspace '))!;
  expect(layer).not.toContain('!loading');expect(layer).not.toContain('!caseError');
   expect(layer).toContain("readEnabled={showPractice&&error!=='auth'&&error!=='forbidden'}");
   expect(layer).toContain('renderCalendar=');
 });
 it('places the functioning Calendar before practitioner summary cards and attendance totals',()=>{
  const grid=workspace.indexOf('<CalendarShell ');
  expect(grid).toBeGreaterThan(0);
  expect(workspace.indexOf('<div className="ls-cal-operational">')).toBeGreaterThan(grid);
  expect(workspace.indexOf('<aside className="ls-cal-count">')).toBeGreaterThan(grid);
  expect(workspace.match(/<IntakeSummaryCard /g)).toHaveLength(1);
  expect(workspace.match(/<CalendarAttentionSummary /g)).toHaveLength(1);
 });
 it('preserves visible real partial failures, role-specific grid and draft guards',()=>{
  for(const failure of ['taskFailed&&','followupFailed&&','taskSyncFailed&&','error===\'auth\'','error===\'forbidden\'','caseError&&','countError&&']){
   expect(workspace.indexOf(failure)).toBeLessThan(workspace.indexOf('<CalendarShell '));
  }
  expect(workspace).toContain('<UnsavedChangesGuard dirty={dirty||taskDirty||mutation.uncertain}');
  expect(workspace).toContain('livePractitioner&&<div className="ls-cal-operational">');
  expect(workspace.match(/if\(!livePractitioner\)return;/g)).toHaveLength(2);
  expect(workspace).toContain("const tasks=livePractitioner&&showTasks");
  expect(workspace).toContain("const followups=livePractitioner&&showFollowups");
  expect(workspace).toContain('Return to live calendar');
  expect(workspace).toContain('calendarCasesForMode(value,mode!)');
  expect(workspace).not.toContain('<details className="ls-cal-operational');
 });
 it('reduces unused spacing rather than clipping content or shrinking readable controls',()=>{
  expect(css).toContain('grid-template-columns:minmax(180px,.8fr) minmax(220px,1fr) auto');
  expect(css).toContain('.ls-cal-period>.lsw-field {flex:1;min-inline-size:0}');
  expect(css).toContain('.ls-cal-toolbar>.lsw-field {min-inline-size:0}');
  expect(css).toContain('@media(max-width:1279px)');
  expect(css).toContain('@media(max-width:600px)');
  expect(css).not.toMatch(/\.ls-cal-toolbar[^{}]*\{[^}]*overflow\s*:\s*hidden/);
  expect(css).not.toMatch(/\.ls-cal-toolbar[^{}]*\{[^}]*font-size\s*:/);
 });
 it('keeps mobile mode, actions and date navigation compact without hiding controls or smaller text',()=>{
  expect(css).toContain('.lsw.lsu .ls-cal .ls-cal-layers>.lsw-field{grid-template-columns:minmax(7rem,.8fr) minmax(0,1fr)');
  expect(css).toContain('.lsw.lsu .ls-cal .ls-cal-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))');
  expect(css).toContain('.lsw.lsu .ls-cal .lsw-calendar-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto');
  expect(css).toContain('.lsw.lsu .ls-cal .lsw-calendar-toolbar>nav{grid-column:1/-1');
   expect(workspace).toContain("title={locale==='he'?'יומן':'Calendar'}");
  });
  it('puts the optional practice layer before the dated Calendar and counts actual practice in the mobile empty-grid decision',()=>{
   expect(workspace.indexOf('checked={showPractice}')).toBeLessThan(workspace.indexOf('<CalendarShell '));
   expect(workspace).toContain('data-has-entries={items.length+followups.length+tasks.length+practice.length>0}');
   expect(workspace.match(/practice=\{practice\}/g)).toHaveLength(2);
   expect(workspace).not.toContain('calendar-practice-title');
   expect(css).toContain('.ls-cal-schedule[data-has-entries="false"]');
   expect(css).not.toContain('min-block-size:330px');
   expect(css).not.toContain('max-inline-size:880px');
   expect(css).toContain('font-family:inherit');
  });
 it('offers one practitioner booking action beside the title and reduces unused agenda spacing',()=>{
  expect(workspace).toContain("action={practitioner?<Button disabled={mutation.locked||!cases.length} onClick={e=>openBook(e)}>");
  expect(workspace).toContain("{livePractitioner&&<div className=\"ls-cal-actions\">");
  expect(workspace.match(/onClick=\{e=>openBook\(e\)\}/g)).toHaveLength(1);
  expect(css).toContain('.lsw.lsu.lsu--practitioner .ls-cal>.lsw-page-header{display:grid;grid-template-columns:minmax(0,1fr) auto');
  expect(css).toContain('.lsw.lsu .ls-cal>.lsw-page-header>.lsw-button{font-size:inherit}');
  expect(css).toContain('.lsw.lsu .ls-cal .lsw-calendar-agenda{padding-block-start:.5rem}');
  expect(css).toContain('.lsw.lsu .ls-cal .lsw-calendar-agenda>h3{margin-block:.5rem}');
  expect(css).not.toContain('.ls-cal-actions>:first-child{');
 });
 it('compacts only Calendar filters and places the actual timezone span beside the period',()=>{
  expect(css).toContain('.lsw.lsu .ls-cal :is(.ls-cal-layers>.lsw-field,.ls-cal-toolbar>.lsw-field,.ls-cal-period>.lsw-field){margin-block-end:0}');
  expect(css).toContain('.lsw.lsu .ls-cal .ls-cal-toolbar>.lsw-field{grid-template-columns:minmax(7rem,.8fr) minmax(0,1fr)');
  expect(css).toContain('.lsw.lsu .ls-cal .lsw-calendar-toolbar>.lsw-help{grid-column:2;grid-row:1;justify-self:end}');
  expect(css).not.toContain('.lsw-calendar-toolbar>small{');
 });
 it('removes duplicated mobile Calendar container padding while keeping visible synthetic provenance',()=>{
  expect(css).toContain('.lsw.lsu .lsu-page:has(>main.ls-cal){padding-block-start:0;');
  expect(css).toContain('.lsw.lsu .lsu-content:has(>.lsu-page>main.ls-cal)>.lsu-breadcrumbs{margin-block-end:.5rem}');
  expect(workspace).toContain('DEMO — synthetic data; external effects disabled.');
  expect(workspace).toContain('DEMO — נתונים סינתטיים, ללא השפעות חיצוניות.');
  expect(workspace).toContain('Return to live calendar');
 });
 it('uses the available narrow-screen width without clipping or reducing typography',()=>{
  expect(css).toContain('.lsw.lsu .lsu-page:has(>main.ls-cal){padding-block-start:0;padding-inline:0}');
  expect(css).toContain('.lsw.lsu .ls-cal .lsw-calendar-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.5rem;align-items:center;padding:.5rem}');
  expect(css).not.toMatch(/\.ls-cal[^{}]*\{[^}]*overflow\s*:\s*hidden/);
 });
});
