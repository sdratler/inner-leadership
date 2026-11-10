import { z } from 'zod';
import { trip390CurrentInterestSchema } from '../group-application/academy-trip390-contract.ts';
import { fishingFamilyProposalCommandSchema, fishingInquiryFamilyProposalSchema } from './inquiry-family-contract-v1.ts';

export const NATIVE_FAMILY_OWNER_SOURCE_VERSION = 'JLFA-FISHING-NATIVE-FAMILY-OWNER-SOURCE-v1' as const;
export const nativeFamilyOwnerSourceSchema = z.object({
  version: z.literal(NATIVE_FAMILY_OWNER_SOURCE_VERSION), kind: z.literal('family_source'), reference: z.uuid(),
  expectedEpoch: fishingFamilyProposalCommandSchema.shape.expectedEpoch, sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  guardianName: trip390CurrentInterestSchema.shape.guardianName, messageLanguage: trip390CurrentInterestSchema.shape.messageLanguage,
  children: z.array(trip390CurrentInterestSchema.shape.children.element.pick({ id: true, name: true, ageYears: true })).min(1).max(10),
  contactAdmission: z.enum(['required', 'admitted']), association: fishingInquiryFamilyProposalSchema.nullable(),
}).strict().superRefine((value, context) => {
  const ids = value.children.map(child => child.id.toLowerCase());
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'DUPLICATE_SOURCE_CHILD' });
  const record = value.association;
  if (record && (value.contactAdmission !== 'admitted' || record.command.selection.reference !== value.reference || record.command.expectedEpoch !== value.expectedEpoch ||
    record.command.expectedSourceDigest !== value.sourceDigest || record.command.selection.children.length !== ids.length || record.command.selection.children.some(child => !ids.includes(child.applicationChildId.toLowerCase()))))
    context.addIssue({ code: 'custom', message: 'CURRENT_FAMILY_SOURCE_MISMATCH' });
});
export type NativeFamilyOwnerSource = z.infer<typeof nativeFamilyOwnerSourceSchema>;
