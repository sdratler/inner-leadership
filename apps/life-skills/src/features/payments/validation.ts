import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import { asId } from '../../lib/ids.ts';
import type { CreditEffectReference } from '../identity/interfaces.ts';
const uuid=z.string().uuid();
const caseId=uuid.transform(v=>asId(v,'case'));
const paymentId=uuid.transform(v=>asId(v,'payment'));
const chargeId=uuid.transform(v=>asId(v,'payment_charge'));
const blockId=uuid.transform(v=>asId(v,'credit_block'));
const clean=(max:number)=>z.string().trim().min(1).max(max).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
const instant=z.string().max(40).refine(v=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))).transform(v=>new Date(v).toISOString());
export const overviewQuery=z.strictObject({caseId});
export const chargeSchema=z.strictObject({caseId,dueOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;})});
export const paymentSchema=z.strictObject({caseId,amountMinor:z.number().int().min(1).max(10_000_000),method:z.enum(['cash','bank_transfer']),receivedAt:instant,privateReference:clean(160)});
export const allocationSchema=z.strictObject({caseId,paymentId,chargeId,amountMinor:z.number().int().min(1).max(10_000_000)});
export const refundSchema=z.strictObject({caseId,blockId,credits:z.number().int().min(1).max(4),reason:clean(500)});
const effect=z.strictObject({schemaVersion:z.literal(1),caseId,appointmentId:uuid.transform(v=>asId(v,'appointment')),rescheduleRequestId:uuid.transform(v=>asId(v,'reschedule_request')).nullable(),termsVersion:z.string().min(1).max(100),effect:z.enum(['consume','restore','preserve']),idempotencyKey:z.string().min(16).max(100),actorAccountId:uuid.transform(v=>asId(v,'account')),occurredAt:instant});
export function parseCreditEffect(value:unknown):CreditEffectReference{const result=effect.safeParse(value);if(!result.success)throw new AppError('INVALID_REQUEST');return result.data;}
