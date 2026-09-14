import { z } from 'zod';
import { asId } from '../../lib/ids.ts';
import { iso } from './time.ts';
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
export const listSchema=z.strictObject({from:timestamp,to:timestamp,caseId:caseId.nullable(),cursor:z.string().max(180).nullable()});
export function parseQuery<T>(schema:z.ZodType<T>,input:unknown):T{const r=schema.safeParse(input);if(!r.success)throw new Error('INVALID_QUERY');return r.data;}
