import {z} from "zod";

export const BNA_SUPPORT_PROGRAM="bna_support_interest" as const;
export const BNA_SUPPORT_NOTICE={
 version:"BNA-SUPPORT-INTEREST-20261029-v1",
 en:"Please keep my support inquiry privately and contact me using the details I provided. I have read the Privacy Policy.",
 he:"נא לשמור את פניית התמיכה שלי באופן פרטי וליצור איתי קשר באמצעות הפרטים שמסרתי. קראתי את מדיניות הפרטיות.",
} as const;
export const BNA_SUPPORT_UPDATES_NOTICE={
 version:"BNA-SUPPORT-UPDATES-20261029-v1",
 en:"Send me BNA project updates by email. I can unsubscribe at any time.",
 he:"שלחו לי עדכונים על פרויקט בני נביאים בדוא״ל. אוכל להסיר את ההרשמה בכל עת.",
} as const;

/** Adult support intent only. A saved inquiry is neither a gift nor permission
 * for a parent, Fishing, provider or donor sequence. No child/payment fields. */
export const bnaSupportFieldsSchema=z.object({
 name:z.string().trim().min(1).max(120),contactChannel:z.enum(["email","phone"]),contact:z.string().trim().max(254),
 purpose:z.enum(["support_conversation","project_updates"]),language:z.enum(["en","he"]),siteLanguage:z.enum(["en","he"]),
 areaOfInterest:z.string().trim().max(500).optional(),question:z.string().trim().max(2000).optional(),
 emailUpdates:z.boolean(),
 permission:z.object({confirmed:z.literal(true),version:z.literal(BNA_SUPPORT_NOTICE.version),language:z.enum(["en","he"])}).strict(),
 updatesPermission:z.object({confirmed:z.literal(true),channel:z.literal("email"),version:z.literal(BNA_SUPPORT_UPDATES_NOTICE.version),language:z.enum(["en","he"])}).strict().optional(),
}).strict().superRefine((value,ctx)=>{
 if(value.permission.language!==value.siteLanguage)ctx.addIssue({code:"custom",path:["permission","language"],message:"notice language mismatch"});
 if(value.contactChannel==="email"&&(!z.email().max(254).safeParse(value.contact).success||value.contact!==value.contact.toLowerCase()))ctx.addIssue({code:"custom",path:["contact"],message:"email required"});
 if(value.contactChannel==="phone"&&!/^\+[1-9]\d{7,14}$/.test(value.contact))ctx.addIssue({code:"custom",path:["contact"],message:"international phone required"});
 if(value.purpose==="project_updates"&&!value.emailUpdates)ctx.addIssue({code:"custom",path:["emailUpdates"],message:"explicit updates permission required"});
 if(value.emailUpdates&&(value.contactChannel!=="email"||!value.updatesPermission||value.updatesPermission.language!==value.siteLanguage))ctx.addIssue({code:"custom",path:["updatesPermission"],message:"email channel and current explicit permission required"});
 if(!value.emailUpdates&&value.updatesPermission)ctx.addIssue({code:"custom",path:["updatesPermission"],message:"updates permission conflicts with preference"});
});
export type BnaSupportFields=z.infer<typeof bnaSupportFieldsSchema>;
