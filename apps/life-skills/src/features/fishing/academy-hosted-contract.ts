import {z} from 'zod';
import type {FamilyHostedAction} from '../fishing-payments/domain.ts';
export const academyHostedVersion='JLFA-ACADEMY-HOSTED-20261020-01' as const;
/** Native references only. No amount, payer, customer, merchant or paid claim. */
export const academyHostedCommandSchema=z.strictObject({version:z.literal(academyHostedVersion),action:z.literal('request'),operationId:z.uuid(),learnerId:z.uuid(),stageId:z.uuid(),purchaseId:z.uuid(),dueIndex:z.number().int().min(1).max(3)});
export type AcademyHostedCommand=z.infer<typeof academyHostedCommandSchema>;
export type AcademyHostedResult={state:'ready';action:FamilyHostedAction}|{state:'review_required'};
const invoiceUrl=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='invoice.stripe.com'&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname.startsWith('/i/')&&!/[\r\n]/.test(value);}catch{return false;}});
export const academyHostedResultSchema=z.discriminatedUnion('state',[z.strictObject({state:z.literal('review_required')}),z.strictObject({state:z.literal('ready'),action:z.strictObject({purchaseId:z.uuid(),dueIndex:z.number().int().min(1).max(3),state:z.literal('ready'),url:invoiceUrl})})]);
/** A successful response is usable only for the exact clicked native bill. */
export function readAcademyHostedResult(value:unknown,command:AcademyHostedCommand):AcademyHostedResult{
 const result=academyHostedResultSchema.parse(value);if(result.state==='ready'&&(result.action.purchaseId!==command.purchaseId||result.action.dueIndex!==command.dueIndex))throw Error('HOSTED_RESPONSE_BINDING');return result as AcademyHostedResult;
}
