import {expect,test} from 'vitest';
import {academyOperatorDays,academyOperatorDayViolations,type AcademyTeachingEvent} from '../../../src/features/fishing/academy-operator-day.ts';

const ordinary=(id:string,start:string,end:string):AcademyTeachingEvent=>({id,kind:'ordinary',startsAt:start,endsAt:end});
const monday=(id:string,start:string,end:string)=>ordinary(id,`2027-01-11T${start}:00-05:00`,`2027-01-11T${end}:00-05:00`);
test('two ordinary three-hour sessions use the exact daily allowance, not a third short catchup',()=>{
 const events=[monday('a','09:00','12:00'),monday('b','12:00','15:00')];expect(academyOperatorDayViolations(events)).toEqual([]);
 expect(academyOperatorDayViolations([...events,monday('catchup','16:00','16:30')])).toEqual([{date:'2027-01-11',reason:'ordinary_session_limit'},{date:'2027-01-11',reason:'ordinary_hours_limit'}]);
});
test('two short introductory classes exhaust the session count before six hours',()=>{
 expect(academyOperatorDayViolations([monday('a','09:00','11:00'),monday('b','12:00','14:00'),monday('c','15:00','16:00')])).toEqual([{date:'2027-01-11',reason:'ordinary_session_limit'}]);
});
test('six hours is exact; a millisecond over cannot be rounded into compliance',()=>{
 expect(academyOperatorDayViolations([monday('a','09:00','15:00')])).toEqual([]);
 expect(academyOperatorDayViolations([ordinary('a','2027-01-11T09:00:00-05:00','2027-01-11T15:00:00.001-05:00')])).toEqual([{date:'2027-01-11',reason:'ordinary_hours_limit'}]);
});
test('one physical Keys event can have many participation links, but its day is exclusive',()=>{
 const keys:AcademyTeachingEvent={id:'pooled-keys',kind:'keys',startsAt:'2027-01-31T07:00:00-05:00',endsAt:'2027-01-31T19:00:00-05:00'};
 expect(academyOperatorDays([keys,keys,keys])[0]).toMatchObject({keysEventIds:['pooled-keys'],ordinaryEventIds:[],ordinaryMilliseconds:0});expect(academyOperatorDayViolations([keys,keys])).toEqual([]);
 expect(academyOperatorDayViolations([keys,ordinary('intro','2027-01-31T20:00:00-05:00','2027-01-31T21:00:00-05:00')])).toEqual([{date:'2027-01-31',reason:'keys_day_exclusive'}]);
 expect(academyOperatorDayViolations([keys,{...keys,id:'second-trip'}])).toEqual([{date:'2027-01-31',reason:'keys_day_exclusive'}]);
});
test('a reused physical identity with different facts is rejected rather than silently deduplicated',()=>{
 const a=monday('same','09:00','12:00');expect(()=>academyOperatorDays([a,{...a,endsAt:'2027-01-11T13:00:00-05:00'}])).toThrow('ACADEMY_PHYSICAL_EVENT_ID_CONFLICT');
});
test('Florida midnight splits teaching exposure and excludes an exact midnight end',()=>{
 const events=[ordinary('overnight','2027-01-11T23:00:00-05:00','2027-01-12T01:00:00-05:00')];
 expect(academyOperatorDays(events)).toEqual([{date:'2027-01-11',ordinaryEventIds:['overnight'],keysEventIds:[],ordinaryMilliseconds:3600000},{date:'2027-01-12',ordinaryEventIds:['overnight'],keysEventIds:[],ordinaryMilliseconds:3600000}]);
 expect(academyOperatorDays([ordinary('end','2027-01-11T23:00:00-05:00','2027-01-12T00:00:00-05:00')])).toHaveLength(1);
});
test.each([
 ['spring','2027-03-14T00:00:00-05:00','2027-03-15T00:00:00-04:00',23],
 ['fall','2027-11-07T00:00:00-04:00','2027-11-08T00:00:00-05:00',25]
])('Florida %s day uses actual elapsed hours rather than a fixed24h partition',(_name,start,end,hours)=>{
 const day=academyOperatorDays([ordinary('dst',start,end)])[0]!;expect(day.ordinaryMilliseconds).toBe(Number(hours)*3600000);expect(academyOperatorDays([ordinary('dst',start,end)])).toHaveLength(1);
});
test('selected affected days do not relabel unrelated historical demand',()=>{
 const bad=[monday('a','09:00','12:00'),monday('b','12:00','15:00'),monday('c','15:00','16:00')];expect(academyOperatorDayViolations(bad,new Set(['2027-01-12']))).toEqual([]);
});
test('ordinary Saturday teaching is rejected; Sunday eligibility is a separate reviewed policy',()=>{
 expect(academyOperatorDayViolations([ordinary('sat','2027-01-09T09:00:00-05:00','2027-01-09T11:00:00-05:00')])).toEqual([{date:'2027-01-09',reason:'ordinary_saturday'}]);
 expect(academyOperatorDayViolations([ordinary('sun','2027-01-10T09:00:00-05:00','2027-01-10T11:00:00-05:00')])).toEqual([]);
});
test('invalid or unbounded intervals fail rather than producing an incomplete annual tally',()=>{
 expect(()=>academyOperatorDays([ordinary('bad','2027-01-11T09:00:00-05:00','2027-01-11T08:00:00-05:00')])).toThrow();
 expect(()=>academyOperatorDays([ordinary('huge','2027-01-11T09:00:00-05:00','2027-01-20T08:00:00-05:00')])).toThrow();
});
