import {z} from "zod";
export const inquiryLinkCommandSchema=z.object({operationId:z.string().uuid(),conversationId:z.string().uuid(),
 target:z.object({kind:z.enum(["bna_inquiry","fishing_inquiry"]),id:z.string().uuid()}).strict(),
 expectedVersion:z.number().int().min(0).max(2147483645),linked:z.boolean()}).strict();
export type InquiryLinkCommand=z.infer<typeof inquiryLinkCommandSchema>;
