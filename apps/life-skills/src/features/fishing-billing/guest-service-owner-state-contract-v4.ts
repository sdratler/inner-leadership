import {z} from 'zod';
import {billingId,billingInstant} from './contracts.ts';
import {BILLING_SERVICE_V4} from './guest-service-contract-v4.ts';
export const SERVICE_STATE_ACTION_V4='change_service_billing_state_v4' as const;
export const serviceStateCommandV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.literal(SERVICE_STATE_ACTION_V4),operationId:billingId,quoteId:billingId,expectedQuoteRevision:z.number().int().positive().max(2147483646),
 paused:z.boolean().optional(),cancel:z.literal(true).optional(),
}).strict().refine(c=>(c.paused!==undefined||c.cancel===true)&&!(c.cancel&&c.paused===false),'STATE_CHANGE_REQUIRED');
export type ServiceStateCommandV4=z.infer<typeof serviceStateCommandV4Schema>;
export const serviceStateV4Schema=z.object({revision:z.number().int().positive().max(2147483647),state:z.enum(['issued','accepted','cancelled']),paused:z.boolean()}).strict();
export const serviceStateReceiptV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.literal(SERVICE_STATE_ACTION_V4),workspaceId:billingId,actorId:billingId,operationId:billingId,
 quoteId:billingId,familyId:billingId,offerSha256:z.string().regex(/^[a-f0-9]{64}$/),acceptanceId:billingId.nullable(),recordedAt:billingInstant,replayed:z.boolean(),
 before:serviceStateV4Schema,after:serviceStateV4Schema,
}).strict().superRefine((v,c)=>{
 if(v.before.state==='cancelled'||v.after.revision!==v.before.revision+1||v.before.state==='accepted'&&v.acceptanceId===null||v.before.state==='issued'&&v.acceptanceId!==null||
  v.after.state!==v.before.state&&v.after.state!=='cancelled')c.addIssue({code:'custom',message:'SERVICE_STATE_OPERATION_SCOPE'});
});
export type ServiceStateReceiptV4=z.infer<typeof serviceStateReceiptV4Schema>;
export const serviceStateOutcomeV4Schema=z.discriminatedUnion('state',[
 z.object({state:z.literal('committed'),version:z.literal(BILLING_SERVICE_V4),workspaceId:billingId,actorId:billingId,command:serviceStateCommandV4Schema,result:serviceStateReceiptV4Schema}).strict(),
 z.object({state:z.literal('rejected_current_attempt'),version:z.literal(BILLING_SERVICE_V4),workspaceId:billingId,actorId:billingId,command:serviceStateCommandV4Schema,code:z.enum(['CONFLICT','FORBIDDEN','NOT_FOUND','UNAUTHENTICATED','INVALID_REQUEST'])}).strict(),
]).superRefine((v,c)=>{
 if(v.state==='committed'&&(v.result.workspaceId!==v.workspaceId||v.result.actorId!==v.actorId||v.result.operationId!==v.command.operationId||v.result.quoteId!==v.command.quoteId||v.result.before.revision!==v.command.expectedQuoteRevision||
  v.result.after.paused!==(v.command.paused??v.result.before.paused)||v.result.after.state!==(v.command.cancel?'cancelled':v.result.before.state)))c.addIssue({code:'custom',message:'SERVICE_STATE_OUTCOME_SCOPE'});
});
