import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {ordinaryFixtureSeries} from '../../database/fishing/academy-calendar-fixture-times.ts';
afterEach(()=>vi.restoreAllMocks());
const day=(s:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'}).format(new Date(s));
test('one teaching offset preserves all collision/control distances and durations across a weekend',()=>{
 const now=Date.parse('2026-10-22T12:00:00Z');vi.spyOn(Date,'now').mockReturnValue(now);
 const input=[48,72,96].map(h=>({startsAt:new Date(now+h*3600000).toISOString(),endsAt:new Date(now+(h+1)*3600000).toISOString()})),copy=structuredClone(input);
 const result=ordinaryFixtureSeries(input),shift=Date.parse(result[0]!.startsAt)-Date.parse(input[0]!.startsAt);
 expect(shift).toBe(2*86400000);expect(result.map(x=>day(x.startsAt))).toEqual(['Mon','Tue','Wed']);
 for(let n=0;n<input.length;n++){expect(Date.parse(result[n]!.startsAt)-Date.parse(input[n]!.startsAt)).toBe(shift);expect(Date.parse(result[n]!.endsAt)-Date.parse(input[n]!.endsAt)).toBe(shift);}
 expect(input).toEqual(copy);expect(Date.now()).toBe(now);
});
test('past physical intervals stay past and preserve relative spacing',()=>{
 vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-22T12:00:00Z'));
 const input=['2026-10-18','2026-10-19'].map(d=>({startsAt:d+'T12:00:00Z',endsAt:d+'T15:00:00Z'})),result=ordinaryFixtureSeries(input);
 const shift=Date.parse(result[0]!.startsAt)-Date.parse(input[0]!.startsAt);expect(shift).toBeLessThanOrEqual(0);
 for(let n=0;n<result.length;n++){expect(Date.parse(result[n]!.endsAt)).toBeLessThan(Date.now());expect(Date.parse(result[n]!.startsAt)-Date.parse(input[n]!.startsAt)).toBe(shift);expect(['Sat','Sun']).not.toContain(day(result[n]!.startsAt));}
});
test('invalid and mixed past/future physical series fail closed',()=>{
 vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-22T12:00:00Z'));
 expect(()=>ordinaryFixtureSeries([])).toThrow();
 expect(()=>ordinaryFixtureSeries([{startsAt:'invalid',endsAt:'invalid'}])).toThrow();
 expect(()=>ordinaryFixtureSeries([{startsAt:'2026-10-21T12:00:00Z',endsAt:'2026-10-21T13:00:00Z'},{startsAt:'2026-10-23T12:00:00Z',endsAt:'2026-10-23T13:00:00Z'}])).toThrow('SERIES_DIRECTION');
});
