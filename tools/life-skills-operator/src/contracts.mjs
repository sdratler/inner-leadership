import { z } from 'zod';

export const ChangeSchema = z.object({
  target: z.string().min(1),
  operation: z.enum(['set', 'replace', 'move', 'add', 'remove', 'preserve']),
  value: z.unknown().optional(),
  reason: z.string().optional(),
});

export const IntentSchema = z.object({
  classification: z.enum(['execute_approved_intent', 'owner_correction', 'proposed_decision']),
  domain: z.enum(['website_hero', 'ad_creative', 'brand', 'copy', 'other']),
  summary: z.string().min(1),
  preserve: z.array(ChangeSchema).default([]),
  changes: z.array(ChangeSchema).default([]),
  unresolved: z.array(z.string()).default([]),
  locale: z.enum(['he', 'en', 'both', 'unspecified']).default('unspecified'),
  format: z.enum(['feed', 'vertical', 'desktop', 'mobile', 'multiple', 'unspecified']).default('unspecified'),
  conceptId: z.string().nullable().default(null),
  photoId: z.enum(['LS-PHOTO-A', 'LS-PHOTO-B']).nullable().default(null),
  ownerApprovalRequired: z.boolean().default(false),
  rationale: z.string().default(''),
});

export const ExecutionContractSchema = z.object({
  schemaVersion: z.literal(2),
  mode: z.enum(['plan', 'execute']),
  classification: IntentSchema.shape.classification,
  domain: IntentSchema.shape.domain,
  outcome: z.string(),
  intentResolution: z.object({
    method: z.enum(['structured_local', 'model_interpretation']),
    modelCalls: z.number().int().nonnegative(),
  }),
  requiredReads: z.array(z.string()),
  exactAssets: z.record(z.string(), z.unknown()),
  rendering: z.record(z.string(), z.unknown()),
  layering: z.record(z.string(), z.unknown()),
  copy: z.record(z.string(), z.unknown()),
  proposedDiff: z.array(ChangeSchema),
  preserve: z.array(ChangeSchema),
  unresolved: z.array(z.string()),
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
