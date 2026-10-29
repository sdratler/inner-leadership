import {z} from "zod";
export const bnaOptionalTemplate=z.enum(['EMAIL-B1','EMAIL-B2','EMAIL-B3','EMAIL-B4','EMAIL-B5','EMAIL-S1','EMAIL-S2','EMAIL-S3']);
export const bnaOptionalPrepare=z.strictObject({action:z.literal('prepare'),inquiryId:z.uuid(),operationId:z.uuid(),templateId:bnaOptionalTemplate,expectedPreferenceVersion:z.number().int().min(0)});
export const bnaOptionalCommand=z.strictObject({action:z.enum(['cancel','retry_not_attempted']),messageId:z.uuid(),operationId:z.uuid(),expectedVersion:z.number().int().min(1).max(2147483645)});
export type BnaOptionalPrepare=z.infer<typeof bnaOptionalPrepare>;
export type BnaOptionalCommand=z.infer<typeof bnaOptionalCommand>;
export type BnaOptionalTemplate=z.infer<typeof bnaOptionalTemplate>;
export type BnaOptionalState='prepared'|'unknown'|'sent'|'failed'|'canceled'|'canceled_unknown';
