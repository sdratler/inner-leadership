import { describe, expect, test } from 'vitest';
import { internalTaskPath, taskCreateSchema, taskCompleteSchema, taskListSchema } from '../../../src/features/calendar/validation.ts';

const valid={title:'Synthetic follow-up',dueDate:'2026-09-28',dueTime:null,note:null,sourcePath:'/he/app/clients?section=prospects',caseId:null};
describe('internal task boundary',()=>{
 test('mode is a strict live/demo selector, never a client-provided provenance claim',()=>{
  for(const mode of ['live','demo']){
   expect(taskCreateSchema.safeParse({...valid,mode}).success).toBe(true);
   expect(taskCompleteSchema.safeParse({expectedVersion:1,mode}).success).toBe(true);
   expect(taskListSchema.safeParse({from:'2026-10-05T00:00:00Z',to:'2026-10-06T00:00:00Z',caseId:null,mode}).success).toBe(true);
  }
  for(const mode of ['all','DEMO',true,{},['live','demo']]){
   expect(taskCreateSchema.safeParse({...valid,mode}).success).toBe(false);
   expect(taskCompleteSchema.safeParse({expectedVersion:1,mode}).success).toBe(false);
  }
  expect(taskCreateSchema.safeParse({...valid,isDemo:true}).success).toBe(false);
 });
 test('accepts real civil date and optional Jerusalem wall time',()=>{
  expect(taskCreateSchema.safeParse(valid).success).toBe(true);
  expect(taskCreateSchema.safeParse({...valid,dueTime:'09:30'}).success).toBe(true);
  expect(taskCreateSchema.safeParse({...valid,dueDate:'2026-02-30'}).success).toBe(false);
  expect(taskCreateSchema.safeParse({...valid,dueTime:'25:30'}).success).toBe(false);
 });
 test('accepts only private practitioner source links, not external or browser script URLs',()=>{
  expect(internalTaskPath('/en/app/calendar?date=2026-09-28')).toBe(true);
  for(const path of ['https://example.com','//example.com','javascript:alert(1)','/en/family/schedule','/en/app/../../login','/en/app/clients#unsafe'])expect(internalTaskPath(path)).toBe(false);
 });
 test('strict input rejects provider, payment, completion and ownership claims',()=>{
  for(const extra of [{send:true},{paid:true},{state:'done'},{actorId:'synthetic'},{workspaceId:'synthetic'}])expect(taskCreateSchema.safeParse({...valid,...extra}).success).toBe(false);
 });
});
