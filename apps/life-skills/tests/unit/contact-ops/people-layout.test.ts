import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';

const css=readFileSync(new URL('../../../src/features/contact-ops/native-people.css',import.meta.url),'utf8');
const mobile=css.slice(css.indexOf('@media (max-width: 767px)'));

test('keeps all four filters in two readable mobile columns in the current live directory',()=>{
 expect(mobile).toContain('.lsw.lsu .lsu-clients-directory .lsu-people-toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
});
test('keeps the one search input full width in both live and native People',()=>{
 expect(mobile).toContain('.lsu-clients-directory .lsu-people-toolbar > label:first-child { grid-column: 1 / -1; }');
 expect(mobile).toContain('.lsu-native-people .lsu-people-toolbar > label:first-child { grid-column: 1 / -1; }');
});
test('allows long bilingual filter labels to wrap without widening the mobile grid',()=>{
 expect(css).toContain('.lsu-clients-directory .lsu-people-toolbar .lsw-field { min-width: 0; }');
});
test('loads this shared directory stylesheet through the actual live authority-selector route',()=>{
 const roster=readFileSync(new URL('../../../src/features/cases/clients-roster.tsx',import.meta.url),'utf8');
 const native=readFileSync(new URL('../../../src/features/contact-ops/native-people-workspace.tsx',import.meta.url),'utf8');
 expect(roster).toContain('../contact-ops/native-people-workspace.tsx');
 expect(roster).toContain('lsu-clients-directory');
 expect(native).toContain('import "./native-people.css"');
});

test('gives the mobile native count and compact actions separate full-width rows',()=>{
 expect(mobile).toContain('.lsw.lsu .lsu-native-people > .lsw-section-header { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }');
 expect(mobile).toContain('.lsw.lsu .lsu-native-people > .lsw-section-header > .lsw-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }');
});

test('wraps mobile native action captions at words without shrinking readable controls',()=>{
 expect(mobile).toContain('.lsw.lsu .lsu-native-people > .lsw-section-header > .lsw-actions > .lsw-button { min-width: 0; width: 100%; white-space: normal; overflow-wrap: normal; word-break: normal; }');
});
