import {describe,expect,it} from 'vitest';
import {calendarMode,calendarCasesForMode} from '../../../src/features/calendar/mode.ts';
describe('practitioner Calendar mode is context, not a role or authorization shortcut',()=>{
 it('defaults only absent mode to live',()=>{expect(calendarMode(undefined)).toBe('live');expect(calendarMode('live')).toBe('live');expect(calendarMode('demo')).toBe('demo');});
 for(const value of [null,'all','',[],['demo'],true])it(`rejects malformed mode ${JSON.stringify(value)}`,()=>expect(()=>calendarMode(value)).toThrow());
 it('accepts only current real server provenance in a bounded authorized case list',()=>{const rows=[{id:'case-a',kind:'minor',state:'active',displayName:'DEMO — synthetic',mode:'live'}];expect(calendarCasesForMode(rows,'live')).toEqual(rows);expect(calendarCasesForMode([],'demo')).toEqual([]);});
 for(const rows of [[{id:'case-a',kind:'minor',state:'active',displayName:'Name'}],[{id:'case-a',kind:'minor',state:'active',displayName:'Name',mode:'demo'}],{},null,Array.from({length:101},()=>({id:'case-a',kind:'minor',state:'active',displayName:'Name',mode:'live'}))])it('does not infer live from names, omit mixed data or disguise corrupt data as empty',()=>expect(()=>calendarCasesForMode(rows,'live')).toThrow());
});
