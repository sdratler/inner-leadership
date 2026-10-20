import {z} from 'zod';
import type {FamilyHostedAction} from '../fishing-payments/domain.ts';
export const academyHostedVersion='JLFA-ACADEMY-HOSTED-20261020-01' as const;
/** Native references only. No amount, payer, customer, merchant or paid claim. */
export const academyHostedCommandSchema=z.strictObject({version:z.literal(academyHostedVersion),action:z.literal('request'),operationId:z.uuid(),learnerId:z.uuid(),stageId:z.uuid(),purchaseId:z.uuid(),dueIndex:z.number().int().min(1).max(3)});
export type AcademyHostedCommand=z.infer<typeof academyHostedCommandSchema>;
export type AcademyHostedResult={state:'ready';action:FamilyHostedAction}|{state:'review_required'};
