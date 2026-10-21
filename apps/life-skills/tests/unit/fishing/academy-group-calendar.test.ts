import {expect,test} from 'vitest';
import {academyCalendarRange,academyCalendarReadWindows,academyCalendarShiftMonth,readAcademyCalendarTimeline} from '../../../src/features/fishing/academy-group-calendar-core.ts';

test('full year follows the selected month, retaining all twelve months and leap days',()=>{
 const first=academyCalendarRange('2026-11-15','year');expect(first.from).toBe('2026-11-01');expect(first.to).toBe('2027-10-31');expect(first.months).toHaveLength(12);expect(first.dates).toHaveLength(365);
 const leap=academyCalendarRange('2027-03-15','year');expect(leap.to).toBe('2028-02-29');expect(leap.dates).toHaveLength(366);expect(new Set(leap.dates).size).toBe(366);
});
test('four weeks has exactly28 civil days and month preserves its42 day grid',()=>{
 const range=academyCalendarRange('2027-01-14','four_weeks');expect(range.from).toBe('2027-01-10');expect(range.to).toBe('2027-02-06');expect(range.dates).toHaveLength(28);expect(academyCalendarRange('2027-01-14','month').dates).toHaveLength(42);
 expect(academyCalendarShiftMonth('2028-01-31',1)).toBe('2028-02-29');expect(academyCalendarShiftMonth('2027-01-31',1)).toBe('2027-02-28');
});
test('annual reads cover every date exactly once using the existing bounded endpoint',()=>{
 const r=academyCalendarRange('2027-03-01','year'),windows=academyCalendarReadWindows(r.from,r.to);expect(windows).toHaveLength(6);const covered:string[]=[];
 for(const w of windows){const span=(Date.parse(w.to+'T12:00Z')-Date.parse(w.from+'T12:00Z'))/86400000;expect(span).toBeLessThan(62);for(let n=0;n<=span;n++)covered.push(new Date(Date.parse(w.from+'T12:00Z')+n*86400000).toISOString().slice(0,10));}
 expect(covered).toEqual(r.dates);expect(new Set(covered).size).toBe(366);
});
test('invalid, reversed or over-year requests are rejected without issuing reads',async()=>{
 expect(()=>academyCalendarReadWindows('2027-02-30','2027-03-01')).toThrow();expect(()=>academyCalendarReadWindows('2027-02-03','2027-02-02')).toThrow();expect(()=>academyCalendarReadWindows('2027-01-01','2028-01-02')).toThrow();
 let calls=0;await expect(readAcademyCalendarTimeline('2027-02-30','2027-03-01',[],async()=>{calls++;return {};})).rejects.toThrow();expect(calls).toBe(0);
});
test('annual read preserves the exact selected-child filter on every bounded native request',async()=>{
 const calls:string[]=[],items=await readAcademyCalendarTimeline('2026-11-01','2027-10-31',['selected-child'],async path=>{calls.push(path);return {availability:'ready',items:[]};});
 expect(items).toEqual([]);expect(calls).toHaveLength(6);for(const path of calls){const query=new URL(path,'https://synthetic.invalid').searchParams;expect(query.getAll('learnerId')).toEqual(['selected-child']);expect((Date.parse(query.get('to')!)-Date.parse(query.get('from')!))/86400000).toBeLessThan(62);}
});
test('one failed or malformed annual slice denies the whole result instead of showing a partial calendar',async()=>{
 let n=0;await expect(readAcademyCalendarTimeline('2026-11-01','2027-10-31',[],async()=>{if(n++===3)throw Error('synthetic unavailable');return {availability:'ready',items:[]};})).rejects.toThrow('ACADEMY_CALENDAR_INCOMPLETE_READ');expect(n).toBe(6);
 n=0;await expect(readAcademyCalendarTimeline('2026-11-01','2027-10-31',[],async()=>n++===3?{items:[]}:{availability:'ready',items:[]})).rejects.toThrow();
});
test('mixed runtime admission across slices cannot silently create an incomplete year',async()=>{
 let n=0;await expect(readAcademyCalendarTimeline('2026-11-01','2027-10-31',[],async()=>({availability:n++===0?'not_configured':'ready',items:[]}))).rejects.toThrow('ACADEMY_CALENDAR_CONFIGURATION_CHANGED');
});
