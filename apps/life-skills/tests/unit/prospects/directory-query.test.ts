import {expect,it} from 'vitest';
import {directoryQuery,peopleFiltersFromQuery,peoplePageFromQuery} from '../../../src/features/prospects/directory-query.ts';
import {workflowDestination} from '../../../src/features/prospects/client.tsx';

it('uses the same bounded URL values for Sheet and native without translating keys or unknown text',()=>{
 const p=new URLSearchParams('search=עברית+English&stage=__proto__&language=he&due=today&page=3');
 expect(peopleFiltersFromQuery(p)).toEqual({query:'עברית English',stage:'__proto__',language:'he',due:'today'});
 expect(peoplePageFromQuery(p)).toBe(3);
});
it('retains an explicit Academy association/status without global stage or workflow mixing',()=>{
 const f=peopleFiltersFromQuery(new URLSearchParams('program=sunday_fishing_academy&leadStatus=callback_requested&stage=Israeli&due=today&search=Academy'));
 expect(f).toEqual({query:'Academy',stage:'',language:'',due:'today',program:'sunday_fishing_academy',leadStatus:'callback_requested'});
 const p=directoryQuery(new URLSearchParams('filter=payment&stage=Israeli&page=5'),f);expect(p.has('filter')).toBe(false);expect(p.has('stage')).toBe(false);expect(p.get('program')).toBe('sunday_fishing_academy');expect(p.get('leadStatus')).toBe('callback_requested');
 const cleared=directoryQuery(p,{query:'',stage:'',language:'',due:'any'});expect(cleared.has('program')).toBe(false);expect(cleared.has('leadStatus')).toBe(false);
 expect(p.get('section')).toBe('all');
 expect(peopleFiltersFromQuery(new URLSearchParams('program=sunday_fishing_academy&program=sunday_fishing_academy&leadStatus=new'))).not.toHaveProperty('program');
 expect(peopleFiltersFromQuery(new URLSearchParams('program=sunday_fishing_academy&leadStatus=paid'))).not.toHaveProperty('leadStatus');
});
it.each(['search','stage','language','due','page'])('rejects ambiguous repeated %s values even when identical',key=>{
 const value=key==='page'?'2':key==='due'?'today':key==='language'?'he':'value';
 const p=new URLSearchParams([[key,value],[key,value]]),f=peopleFiltersFromQuery(p);
 expect(peoplePageFromQuery(p)).toBe(1);expect(f).toEqual({query:'',stage:'',language:'',due:'any'});
});
it('keeps overlong/unrecognized input out of restored context',()=>{
 const p=new URLSearchParams({search:'x'.repeat(201),stage:'x'.repeat(121),language:'child',due:'tomorrow',page:'0'});
 expect(peopleFiltersFromQuery(p)).toEqual({query:'',stage:'',language:'',due:'any'});expect(peoplePageFromQuery(p)).toBe(1);
});
it('updates one toolbar while preserving section/selected lead and clearing stale page/duplicates',()=>{
 const current=new URLSearchParams('section=prospects&leadId=LS-LEAD-synthetic&search=old&search=old&page=4&language=he');
 const result=directoryQuery(current,{query:'Synthetic',stage:'constructor',language:'en',due:'any'});
 expect(result.getAll('search')).toEqual(['Synthetic']);expect(result.get('stage')).toBe('constructor');expect(result.has('page')).toBe(false);
 expect(result.get('section')).toBe('prospects');expect(result.get('leadId')).toBe('LS-LEAD-synthetic');expect(current.get('page')).toBe('4');
 expect(directoryQuery(result,peopleFiltersFromQuery(result),2).get('page')).toBe('2');
});
it('workflow destination retains only bounded filters, not old selected identity, page or redirects',()=>{
 const context=new URLSearchParams('search=Synthetic&stage=constructor&language=he&due=today&page=3&leadId=LS-LEAD-other&next=https://evil.invalid');
 const url=new URL(workflowDestination('he','booking',context),'https://synthetic.invalid');
 expect(url.pathname).toBe('/he/app/clients');expect(Object.fromEntries(url.searchParams)).toEqual({section:'paid',search:'Synthetic',stage:'constructor',language:'he',due:'today'});
});
