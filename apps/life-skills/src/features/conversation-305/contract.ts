import {z} from "zod";

export const CONVERSATION_305_LINE="+13054916674" as const;
export const conversationClassification=z.enum(["fishing","bna","both","support_provider","unclassified"]);
const followup=z.object({classification:conversationClassification,note:z.string().trim().min(1).max(5000),
 nextAction:z.string().trim().min(1).max(500).nullable(),dueDate:z.iso.date().nullable(),
 waitingCondition:z.string().trim().min(1).max(500).nullable()}).strict().superRefine((value,ctx)=>{
 if(Boolean(value.nextAction)!==Boolean(value.dueDate))ctx.addIssue({code:"custom",path:["dueDate"],message:"dated action required"});
 if(!value.nextAction&&!value.waitingCondition)ctx.addIssue({code:"custom",path:["nextAction"],message:"action or waiting condition required"});
});
export const conversationCreateSchema=z.object({kind:z.literal("create"),operationId:z.string().uuid(),
 channel:z.enum(["phone","whatsapp","sms","other"]),contactHint:z.string().trim().min(1).max(160),
 followup}).strict();
export const conversationReviseSchema=z.object({kind:z.literal("revise"),operationId:z.string().uuid(),
 conversationId:z.string().uuid(),expectedVersion:z.number().int().min(1),followup}).strict();
export const conversationCommandSchema=z.discriminatedUnion("kind",[conversationCreateSchema,conversationReviseSchema]);
export type ConversationCommand=z.infer<typeof conversationCommandSchema>;
export type ConversationFollowup=z.infer<typeof followup>;
