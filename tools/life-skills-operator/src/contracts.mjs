import { z } from 'zod';

export const IntentSchema = z.object({
  classification: z.enum(['execute_approved_intent', 'owner_correction', 'proposed_decision']),
  domain: z.enum(['website_hero', 'ad_creative', 'brand', 'copy', 'other']),
  summary: z.string(),
  preserve: z.array(z.string()).default([]),
  requestedChanges: z.array(z.string()).default([]),
  locale: z.enum(['he', 'en', 'both', 'unspecified']).default('unspecified'),
  format: z.enum(['feed', 'vertical', 'desktop', 'mobile', 'multiple', 'unspecified']).default('unspecified'),
  conceptId: z.string().nullable().default(null),
  photoId: z.enum(['A', 'B']).nullable().default(null),
  ownerApprovalRequired: z.boolean().default(false),
  rationale: z.string(),
});

export const ExecutionContractSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(['plan', 'execute']),
  classification: IntentSchema.shape.classification,
  domain: IntentSchema.shape.domain,
  outcome: z.string(),
  requiredReads: z.array(z.string()),
  exactAssets: z.record(z.string(), z.unknown()),
  rendering: z.record(z.string(), z.unknown()),
  layering: z.record(z.string(), z.unknown()),
  copy: z.record(z.string(), z.unknown()),
  validations: z.array(z.string()),
  forbidden: z.array(z.string()),
  stopConditions: z.array(z.string()),
  effects: z.object({
    generateImage: z.boolean(),
    publish: z.boolean(),
    spend: z.boolean(),
    deploy: z.boolean(),
    providerMutation: z.boolean(),
  }),
});
