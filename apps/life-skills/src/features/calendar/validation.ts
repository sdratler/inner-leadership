import { z } from 'zod';
import { asId } from '../../lib/ids.ts';
import { iso, shiftDay } from './time.ts';
const uuid=z.string().uuid();
const timestamp=z.string().max(40).refine(v=>{try{iso(v);return true;}catch{return false;}},'Offset-qualified valid timestamp required').transform(iso);
const caseId=uuid.transform(v=>asId(v,'case'));
const appointmentId=uuid.transform(v=>asId(v,'appointment'));
const accountId=uuid.transform(v=>asId(v,'account'));
const clean=(max:number)=>z.string().max(max).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));
export const bookingSchema=z.strictObject({
 caseId,audienceId:uuid.transform(v=>asId(v,'audience')),kind:z.enum(['individual','parent_guidance']),startsAt:timestamp,
 parentForId:appointmentId.nullable(),parentIds:z.array(accountId).max(2),bufferBefore:z.number().int().min(0).max(120),bufferAfter:z.number().int().min(0).max(120),
 location:clean(280),checkinExceptionReason:clean(500).nullable()
});
export const noticeSchema=z.strictObject({kind:z.enum(['cancel','reschedule']),proposedWindows:z.array(z.strictObject({startsAt:timestamp,endsAt:timestamp})).max(3)});
export const manualNoticeSchema=noticeSchema.extend({source:z.enum(['phone','whatsapp_manual']),receivedAt:timestamp,requestedBy:accountId});
export const attendanceSchema=z.strictObject({state:z.enum(['present','late','no_show','canceled']),arrivedAt:timestamp.nullable(),expectedVersion:z.number().int().min(0),correctionReason:clean(500).nullable()});
export const exceptionSchema=z.strictObject({expectedVersion:z.number().int().min(1),reason:clean(500).refine(v=>v.trim().length>0)});
export const versionSchema=z.strictObject({expectedVersion:z.number().int().min(1)});
export const logisticsSchema=z.strictObject({expectedVersion:z.number().int().min(1),location:clean(280)});
export const replacementSchema=z.strictObject({expectedVersion:z.number().int().min(1),booking:bookingSchema});
export const availabilitySchema=z.strictObject({startsAt:timestamp,endsAt:timestamp,kind:z.enum(['open','blocked'])});
export const listSchema=z.strictObject({from:timestamp,to:timestamp,caseId:caseId.nullable(),cursor:z.string().max(180).nullable(),mode:z.enum(['live','demo']).nullable().optional()});
const taskDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{try{return shiftDay(v,0)===v;}catch{return false;}});
const taskTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Task links remain within the private practitioner app. No arbitrary external URL. */
export function internalTaskPath(value:string):boolean {
 if(value.length>280||value.includes('..')||value.includes('//')||/[\u0000-\u001f\\#]/.test(value))return false;
 return /^\/(?:he|en)\/app\/(?:calendar|clients|communications|reports|marketing|payments|forms)(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z0-9_=&%-]+)?$/.test(value)||
  /^\/(?:he|en)\/app\/cases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\?mode=demo)?$/i.test(value);
}
export const taskCreateSchema=z.strictObject({
 title:clean(140).trim().min(1),dueDate:taskDate,dueTime:taskTime.nullable(),
 note:clean(1000).nullable(),sourcePath:z.string().refine(internalTaskPath).nullable(),caseId:caseId.nullable(),mode:z.enum(['live','demo']).optional()
});
export const taskListSchema=z.strictObject({from:timestamp,to:timestamp,caseId:caseId.nullable(),mode:z.enum(['live','demo']).nullable().optional()});
export const taskCompleteSchema=versionSchema.extend({mode:z.enum(['live','demo']).optional()});
export function parseQuery<T>(schema:z.ZodType<T>,input:unknown):T{const r=schema.safeParse(input);if(!r.success)throw new Error('INVALID_QUERY');return r.data;}
