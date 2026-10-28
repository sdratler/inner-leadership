import {z} from "zod";

export const BNA_INQUIRY_PROGRAM="bna_torah_mornings" as const;
export const BNA_INQUIRY_NOTICE={
 version:"BNA-TORAH-MORNING-INTEREST-20261028-v1",
 en:"Please keep my inquiry privately and contact me about the first Torah-morning group. This inquiry does not enroll a child, reserve a place, authorize payment, or subscribe me to general marketing.",
 he:"נא לשמור את פנייתי באופן פרטי וליצור איתי קשר לגבי קבוצת התורה הראשונה בבוקר. פנייה זו אינה רושמת ילד, שומרת מקום, מאשרת תשלום או מצרפת אותי לדיוור שיווקי כללי.",
} as const;

const contact=z.string().trim().max(254);
const tag=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);
export const bnaAttributionSchema=z.object({
 campaign:tag.optional(),source:tag.optional(),content:tag.optional(),referral:tag.optional(),postRef:tag.optional(),
}).strict();
export const bnaInquiryFieldsSchema=z.object({
 name:z.string().trim().min(1).max(120),
 contactChannel:z.enum(["email","phone"]),contact,
 language:z.enum(["en","he"]),townOrZip:z.string().trim().min(2).max(100),
 childAges:z.array(z.number().int().min(0).max(18)).min(1).max(8),
 readiness:z.string().trim().max(500).optional(),availability:z.string().trim().max(500).optional(),
 startPreference:z.string().trim().max(200).optional(),childName:z.string().trim().max(120).optional(),
 question:z.string().trim().max(2000).optional(),
 permission:z.object({confirmed:z.literal(true),version:z.literal(BNA_INQUIRY_NOTICE.version),language:z.enum(["en","he"])}).strict(),
}).strict().superRefine((value,ctx)=>{
 if(value.permission.language!==value.language)ctx.addIssue({code:"custom",path:["permission","language"],message:"language mismatch"});
 if(value.contactChannel==="email"&&(!z.email().max(254).safeParse(value.contact.toLowerCase()).success||value.contact!==value.contact.toLowerCase()))ctx.addIssue({code:"custom",path:["contact"],message:"email required"});
 if(value.contactChannel==="phone"&&!/^\+[1-9]\d{7,14}$/.test(value.contact))ctx.addIssue({code:"custom",path:["contact"],message:"international phone required"});
});
export const bnaInquirySubmissionSchema=z.object({
 challenge:z.string().min(80).max(1024),website:z.literal("").optional(),operationId:z.string().uuid(),
 fields:bnaInquiryFieldsSchema,attribution:bnaAttributionSchema.optional(),
}).strict();
export const bnaFollowupCommandSchema=z.object({
 operationId:z.string().uuid(),inquiryId:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),
 status:z.enum(["new","contacted","waiting","closed"]),
 note:z.string().trim().min(1).max(5000),nextAction:z.string().trim().max(500).nullable(),
 dueDate:z.iso.date().nullable(),waitingCondition:z.string().trim().max(500).nullable(),
}).strict().superRefine((value,ctx)=>{
 if(value.status==="waiting"&&!value.waitingCondition)ctx.addIssue({code:"custom",path:["waitingCondition"],message:"waiting condition required"});
 if(value.status!=="closed"&&!value.nextAction&&!value.waitingCondition)ctx.addIssue({code:"custom",path:["nextAction"],message:"action or waiting condition required"});
});
export type BnaInquiryFields=z.infer<typeof bnaInquiryFieldsSchema>;
export type BnaAttribution=z.infer<typeof bnaAttributionSchema>;
export type BnaFollowupCommand=z.infer<typeof bnaFollowupCommandSchema>;
