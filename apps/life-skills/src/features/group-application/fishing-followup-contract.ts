import {z} from "zod";
import {inquirySourceCorrectionSchema} from "../inquiry-source-correction.ts";

export const fishingFollowupCommandSchema=z.object({
 operationId:z.string().uuid(),applicationId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),
 status:z.enum(["new","contacted","waiting","closed"]),
 note:z.string().trim().min(1).max(5000),nextAction:z.string().trim().max(500).nullable(),
 dueDate:z.iso.date().nullable(),waitingCondition:z.string().trim().max(500).nullable(),
 sourceCorrection:inquirySourceCorrectionSchema.optional(),
}).strict().superRefine((value,ctx)=>{
 if(Boolean(value.nextAction)!==Boolean(value.dueDate))
  ctx.addIssue({code:"custom",path:["dueDate"],message:"dated action required"});
 if(value.status==="waiting"&&!value.waitingCondition)ctx.addIssue({code:"custom",path:["waitingCondition"],message:"waiting condition required"});
 if(value.status!=="closed"&&!value.nextAction&&!value.waitingCondition)
  ctx.addIssue({code:"custom",path:["nextAction"],message:"action or waiting condition required"});
});
export type FishingFollowupCommand=z.infer<typeof fishingFollowupCommandSchema>;
export const fishingFollowupStateSchema=z.object({
 status:z.enum(["new","contacted","waiting","closed"]),note:z.string().max(5000),
 nextAction:z.string().max(500).nullable(),dueDate:z.iso.date().nullable(),
 waitingCondition:z.string().max(500).nullable(),
 sourceCorrection:inquirySourceCorrectionSchema.optional(),
}).strict().superRefine((value,ctx)=>{
 if(Boolean(value.nextAction)!==Boolean(value.dueDate))
  ctx.addIssue({code:"custom",path:["dueDate"],message:"dated action required"});
});
export type FishingFollowupState=z.infer<typeof fishingFollowupStateSchema>;
