import {describe,it,expect} from 'vitest';
import {calendarMonthlyChildPeriodV3,createChildAnchoredFamilyOfferV3} from '../../src/features/fishing-billing/service-periods-v3.ts';
import {syntheticId as id,syntheticDefinition,syntheticNow,syntheticOwner,syntheticWorkspace,syntheticFamily} from '../../src/features/fishing-billing/fixtures.ts';

const period=(startsAt:string,cycle=0)=>calendarMonthlyChildPeriodV3({
 childId:id(20),periodId:id(30),firstEligibleLesson:{id:id(40),startsAt},cycle,
});
describe('prospective child-specific calendar months',()=>{
 it('uses the first eligible lesson and preserves its exact instant',()=>{
  const p=period('2035-01-31T16:30:12.125-05:00');
  expect(p.period).toEqual({id:id(30),startsAt:'2035-01-31T21:30:12.125Z',endsAt:'2035-02-28T21:30:12.125Z',timeZone:'America/New_York'});
  expect(p.firstEligibleLesson).toEqual({id:id(40),startsAt:'2035-01-31T16:30:12.125-05:00'});
 });
 it('returns to the original 31st after a short month without anniversary drift',()=>{
  const first=period('2035-01-31T21:30:00Z'),next=period('2035-01-31T21:30:00Z',1);
  expect(first.period.endsAt).toBe(next.period.startsAt);
  expect(next.period.endsAt).toBe('2035-03-31T20:30:00.000Z');
 });
 it('handles leap years and returns to the original anniversary',()=>{
  expect(period('2036-01-31T21:30:00Z').period.endsAt).toBe('2036-02-29T21:30:00.000Z');
  const p=period('2036-02-29T21:30:00Z',12);
  expect(p.period.startsAt).toBe('2037-02-28T21:30:00.000Z');
  expect(p.period.endsAt).toBe('2037-03-29T20:30:00.000Z');
 });
 it('preserves Florida lesson time across the spring transition',()=>{
  expect(period('2035-02-15T21:00:00Z').period.endsAt).toBe('2035-03-15T20:00:00.000Z');
 });
 it('preserves Florida lesson time across the autumn transition and year rollover',()=>{
  expect(period('2035-10-15T20:00:00Z').period.endsAt).toBe('2035-11-15T21:00:00.000Z');
  expect(period('2035-12-31T21:00:00Z').period.endsAt).toBe('2036-01-31T21:00:00.000Z');
 });
 it('derives the local anniversary from Florida date rather than UTC date',()=>{
  expect(period('2035-02-01T01:30:00Z').period.endsAt).toBe('2035-03-01T01:30:00.000Z');
 });
 it('holds nonexistent spring anniversary times for explicit resolution',()=>{
  expect(()=>period('2026-02-08T07:30:00Z')).toThrowError(expect.objectContaining({code:'UNAVAILABLE'}));
 });
 it('holds ambiguous autumn anniversary times for explicit resolution',()=>{
  expect(()=>period('2026-10-01T05:30:00Z')).toThrowError(expect.objectContaining({code:'UNAVAILABLE'}));
 });
 it('accepts an explicitly scheduled first lesson during a repeated hour',()=>{
  expect(period('2026-11-01T06:30:00Z').period.startsAt).toBe('2026-11-01T06:30:00.000Z');
 });
 it('rejects malformed dates, negative cycles and unknown inputs',()=>{
  expect(()=>period('2035-02-30T12:00:00Z')).toThrow();
  expect(()=>period('2035-02-01T12:00:00Z',-1)).toThrow();
  expect(()=>calendarMonthlyChildPeriodV3({...period('2035-02-01T12:00:00Z'),periodId:id(30),cycle:0})).toThrow();
 });
});

describe('first eligible lesson in the existing family-offer draft',()=>{
 function command(){return {
  operationId:id(6),id:id(7),familyId:syntheticFamily,definitionId:id(5),override:null,
  children:[{lineId:id(10),childId:id(20),periodId:id(30),firstEligibleLesson:{id:id(40),startsAt:'2035-01-31T21:30:00Z'},groupId:null,dueAt:null},
   {lineId:id(11),childId:id(21),periodId:id(31),firstEligibleLesson:{id:id(41),startsAt:'2035-02-15T21:00:00Z'},groupId:null,dueAt:null}],
 };}
 const context={workspaceId:syntheticWorkspace,actorId:syntheticOwner,now:syntheticNow};
 it('keeps advance purchase time separate from both siblings first paid periods',()=>{
  const input=command(),copy=structuredClone(input);
  const result=createChildAnchoredFamilyOfferV3(syntheticDefinition(),input,context);
  expect(result.quote.createdAt).toBe(syntheticNow);
  expect(result.quote.lines.map(l=>l.period.startsAt)).toEqual(['2035-01-31T21:30:00.000Z','2035-02-15T21:00:00.000Z']);
  expect(result.quote.lines.map(l=>l.period.endsAt)).toEqual(['2035-02-28T21:30:00.000Z','2035-03-15T20:00:00.000Z']);
  expect(result.quote.lines.map(l=>l.amountMinor)).toEqual([65000,65000]);
  expect(result.quote.state).toBe('draft');expect(result.quote.acceptance).toBeNull();
  expect(result.periods.map(p=>p.childId)).toEqual([id(20),id(21)]);
  expect(input).toEqual(copy);
 });
 it('allows siblings with the same lesson instant and separate period identities',()=>{
  const input=command();input.children[1]!.firstEligibleLesson.startsAt=input.children[0]!.firstEligibleLesson.startsAt;
  const {quote}=createChildAnchoredFamilyOfferV3(syntheticDefinition(),input,context);
  expect(quote.lines[0]!.period.startsAt).toBe(quote.lines[1]!.period.startsAt);
  expect(quote.lines[0]!.period.id).not.toBe(quote.lines[1]!.period.id);
 });
 it('preserves the existing explicit custom-offer override for each line',()=>{
  const input={...command(),override:{reason:'SYNTHETIC custom agreement',amounts:[{lineId:id(10),amountMinor:50000},{lineId:id(11),amountMinor:65000}]}};
  const {quote}=createChildAnchoredFamilyOfferV3(syntheticDefinition(),input,context);
  expect(quote.lines.map(l=>l.amountMinor)).toEqual([50000,65000]);
  expect(quote.override?.actorId).toBe(syntheticOwner);
 });
 it('rejects duplicate children and period identities without a partial offer',()=>{
  const input=command();input.children[1]!.childId=input.children[0]!.childId;
  expect(()=>createChildAnchoredFamilyOfferV3(syntheticDefinition(),input,context)).toThrow();
  const other=command();other.children[1]!.periodId=other.children[0]!.periodId;
  expect(()=>createChildAnchoredFamilyOfferV3(syntheticDefinition(),other,context)).toThrow();
 });
});
