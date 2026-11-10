import { z } from 'zod';
import { NATIVE_FAMILY_VERSION, nativeFamilyCreateCommandSchema } from './native-family-contract-v1.ts';
import { fishingInquiryFamilyProposalSchema } from './inquiry-family-contract-v1.ts';

export const nativeFamilyCreationReceiptSchema = z.object({ version: z.literal(NATIVE_FAMILY_VERSION), resultKind: z.literal('original_creation_receipt'), record: fishingInquiryFamilyProposalSchema, replayed: z.boolean() }).strict();
const code = z.enum(['CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'UNAUTHENTICATED', 'INVALID_REQUEST']);
export type NativeFamilyRejectedCode = z.infer<typeof code>;
const correlation = { version: z.literal(NATIVE_FAMILY_VERSION), workspaceId: z.uuid(), actorId: z.uuid(), command: nativeFamilyCreateCommandSchema };
export const nativeFamilyCreationOutcomeSchema = z.discriminatedUnion('state', [
  z.object({ ...correlation, state: z.literal('created'), receipt: nativeFamilyCreationReceiptSchema }).strict(),
  z.object({ ...correlation, state: z.literal('rejected'), code }).strict(),
]);
export type NativeFamilyCreationOutcome = z.infer<typeof nativeFamilyCreationOutcomeSchema>;
export const nativeFamilyCreatedDataSchema = nativeFamilyCreationReceiptSchema.extend({ kind: z.literal('native_family_created') }).strict();
export const nativeFamilyRejectedDataSchema = z.object({ ...correlation, kind: z.literal('native_family_rejected'), code }).strict();
export const nativeFamilySaveDataSchema = z.discriminatedUnion('kind', [nativeFamilyCreatedDataSchema, nativeFamilyRejectedDataSchema]);
