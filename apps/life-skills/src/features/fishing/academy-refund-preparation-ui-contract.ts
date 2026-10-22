/** Browser DTO: family-scoped review and preparation only, never execution. */
import {z} from 'zod';
import {academyOwnerEnrollmentBindingSchema,type AcademyOwnerEnrollmentBinding} from './academy-enrollment-contract.ts';
import {refundPreparationCommandSchema,type RefundPreparationSelection, type refundPreparationView, type refundPreparationResultSchema} from './academy-refund-preparation-contract.ts';
export const academyRefundPreparationUiVersion='JLFA-REFUND-PREPARED-UI-20261021-01' as const;
export const refundPreparationUiQuerySchema=z.strictObject({applicationId:z.uuid()});
export const refundPreparationUiCommandSchema=z.strictObject({version:z.literal(academyRefundPreparationUiVersion),operationId:z.uuid(),binding:academyOwnerEnrollmentBindingSchema,command:refundPreparationCommandSchema}).refine(c=>c.operationId!==c.command.operationId&&c.operationId!==c.command.id);
export type RefundPreparationUiCommand=z.infer<typeof refundPreparationUiCommandSchema>;
export type RefundPreparationUiOption={selection:RefundPreparationSelection;members:{purchaseId:string;childId:string;displayName:string}[];review:ReturnType<typeof refundPreparationView>|null;saved:z.infer<typeof refundPreparationResultSchema>|null;blocked:'policy_required'|'stale_preparation'|null};
export type RefundPreparationUiContext={state:'not_ready'|'not_admitted'}|{state:'ready';binding:AcademyOwnerEnrollmentBinding;options:RefundPreparationUiOption[];effect:'none';execution:'denied'};
