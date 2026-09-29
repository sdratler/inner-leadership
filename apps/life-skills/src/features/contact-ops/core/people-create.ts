import {z} from "zod";
import {normalizePhone} from "./contact-resolution.ts";
import {dateOnly} from "./validation.ts";

const epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
export const prospectCreateFieldsSchema=z.object({name:z.string().trim().max(120),
 phone:z.string().trim().min(8).max(64).refine(value=>normalizePhone(value)!==null),
 language:z.enum(["","he","en"]),source:z.string().trim().max(120),
 notes:z.string().max(5000),nextAction:z.string().max(500),
 dueDate:z.union([z.literal(""),z.string().refine(dateOnly)])}).strict();
export type ProspectCreateFields=z.infer<typeof prospectCreateFieldsSchema>;
/** Existing legacy requests are accepted only while the durable authority is Sheet. */
export const prospectCreateSchema=prospectCreateFieldsSchema.extend({action:z.literal("add"),
 expectedEpoch:epoch.optional(),operationId:z.string().uuid().optional()}).strict();
export type ProspectCreateInput=z.infer<typeof prospectCreateSchema>;
const native=prospectCreateFieldsSchema.extend({action:z.literal("add"),expectedEpoch:epoch,
 operationId:z.string().uuid()}).strict();
export type PeopleCreate=z.infer<typeof native>;
/** Keep the exact pending request for uncertain-outcome retries. No person/role/mode is accepted. */
export function peopleCreate(input:PeopleCreate):PeopleCreate{return native.parse(input);}

/** This is genuine native provenance, never a fabricated spreadsheet snapshot. */
export const nativeManualInquirySchema=z.object({origin:z.literal("native_manual"),
 leadId:z.string().regex(/^LS-LEAD-native-[0-9a-f-]{36}$/),
 phone:z.string().refine(value=>normalizePhone(value)===value),language:z.enum(["","he","en"]),
 source:z.string().max(120),createdAt:z.string().datetime()}).strict();
export type NativeManualInquiry=z.infer<typeof nativeManualInquirySchema>;
