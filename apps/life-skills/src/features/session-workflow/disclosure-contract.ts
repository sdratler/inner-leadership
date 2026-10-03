import {z} from "zod";
import {validIso} from "./policy.ts";
export const MAX_DISCLOSURE_RECORDS=100;
const uuid=z.string().uuid().transform(value=>value.toLowerCase()),time=z.string().refine(validIso),text=(max:number)=>z.string().min(1).max(max).refine(value=>value.trim().length>0);
export const disclosureInputSchema=z.strictObject({recipient:text(200),purpose:text(500),topic:text(800),authorityBasis:text(4000),authorityState:z.enum(["checked","needs_review","restricted"]),channel:z.enum(["phone","meeting","secure_message"]),authorizedByAccountId:uuid,childDiscussionRecorded:z.boolean(),authorizedAt:time,expiresAt:time});
export type DisclosureInput=z.infer<typeof disclosureInputSchema>;
export const disclosureSchema=disclosureInputSchema.extend({workspaceId:uuid,caseId:uuid,sessionId:uuid,id:uuid,recordedByPractitionerId:uuid,revokedAt:time.nullable(),usedAt:time.nullable(),effective:z.boolean()});
export type DisclosureView=z.infer<typeof disclosureSchema>;
export const disclosureReceiptSchema=z.strictObject({disclosureId:uuid,revokedAt:time.nullable(),usedAt:time.nullable()});
export const disclosureUseSchema=z.strictObject({usedAt:time});
export const disclosureRevokeSchema=z.strictObject({expectedUsedAt:time.nullable()});
export function disclosureRecordReadback(saved:DisclosureView,input:DisclosureInput):boolean{return saved.revokedAt===null&&saved.usedAt===null&&Object.entries(input).every(([key,value])=>key==="authorizedAt"||key==="expiresAt"?Date.parse(saved[key])===Date.parse(value as string):saved[key as keyof DisclosureInput]===value);}
