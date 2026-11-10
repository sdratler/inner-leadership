import { z } from 'zod';

export const FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION='JLFA-FISHING-INQUIRY-FAMILY-PROPOSAL-v1' as const;
const uuid=z.uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const mapping=z.object({applicationChildId:uuid,nativeChildId:uuid}).strict();
export const fishingInquiryFamilySelectionSchema=z.object({reference:uuid,familyId:uuid,children:z.array(mapping).min(1).max(10)}).strict()
 .refine(v=>new Set(v.children.map(c=>c.applicationChildId.toLowerCase())).size===v.children.length&&new Set(v.children.map(c=>c.nativeChildId.toLowerCase())).size===v.children.length,'DUPLICATE_CHILD_MAPPING');
const selection=fishingInquiryFamilySelectionSchema,epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
export const fishingFamilyProposalCommandSchema=z.object({operationId:uuid,expectedEpoch:epoch,
 selection,expectedSourceDigest:digest,expectedNativeDigest:digest}).strict();
export type FishingFamilyProposalCommand=z.infer<typeof fishingFamilyProposalCommandSchema>;
const snapshot=z.object({version:z.string().min(1).max(200),language:z.enum(['en','he']),textDigest:digest}).strict();
export const fishingInquiryFamilyProposalSchema=z.object({version:z.literal(FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION),id:uuid,workspaceId:uuid,
 command:fishingFamilyProposalCommandSchema,recordedBy:uuid,recordedAt:z.iso.datetime(),guardianPersonId:uuid,
 messageLanguage:z.enum(['en','he']),sourceVersion:z.string().min(1).max(200),offerVersion:z.string().min(1).max(200),
 acknowledgment:z.object({version:z.string().min(1).max(200),language:z.enum(['en','he']),
  reservationNotice:snapshot,studentConduct:snapshot,whatsapp:z.boolean()}).strict(),
 state:z.literal('proposed'),guardianVerified:z.literal(false),recipientVerified:z.literal(false),
 financialAcceptance:z.literal(false),outboundEligible:z.literal(false),
}).strict();
export type FishingInquiryFamilyProposal=z.infer<typeof fishingInquiryFamilyProposalSchema>;
export const fishingInquiryFamilyProposalPreviewSchema=fishingInquiryFamilyProposalSchema.pick({version:true,guardianPersonId:true,messageLanguage:true,state:true,
 guardianVerified:true,recipientVerified:true,financialAcceptance:true,outboundEligible:true})
 .extend({selection,sourceDigest:digest,nativeDigest:digest}).strict();
