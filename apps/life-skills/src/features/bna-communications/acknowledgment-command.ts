import {z} from 'zod';

export const bnaAcknowledgmentCommandSchema=z.strictObject({
 action:z.enum(['cancel_acknowledgment','retry_acknowledgment']),
 inquiryId:z.string().uuid(),messageId:z.string().uuid(),operationId:z.string().uuid(),
 expectedVersion:z.number().int().min(1).max(2147483645),
});
export type BnaAcknowledgmentCommand=z.infer<typeof bnaAcknowledgmentCommandSchema>;
