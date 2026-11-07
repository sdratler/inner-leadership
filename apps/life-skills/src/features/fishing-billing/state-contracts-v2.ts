import {z} from 'zod';
import {billingId,commandSchema} from './contracts.ts';
import {BILLING_DTO_V2} from './contracts-v2.ts';
/** The calendar-date ledger has its own result format. A state command must
 * never fail merely because its immutable history contains a date receipt. */
export const billingStateCommandV2Schema=commandSchema.extend({
 version:z.literal(BILLING_DTO_V2),quoteId:billingId,
 paused:z.boolean().optional(),cancel:z.literal(true).optional(),
}).strict().refine(c=>c.paused!==undefined||c.cancel===true,'STATE_CHANGE_REQUIRED');
