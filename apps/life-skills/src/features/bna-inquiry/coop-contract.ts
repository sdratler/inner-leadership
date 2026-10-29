import {z} from "zod";
export const BNA_COOP_PROGRAM="bna_learning_coop" as const;
export const BNA_COOP_NOTICE={version:"BNA-COOP-INTEREST-20261029-v1",
 en:"Please contact me about the BNA learning co-op using the details I provided. I have read the privacy information.",
 he:"אבקש ליצור איתי קשר בעניין קואופרטיב הלמידה של בני נביאים באמצעות הפרטים שמסרתי. קראתי את המידע על פרטיות."} as const;
const contact=z.string().trim().max(254);
export const bnaCoopFieldsSchema=z.object({
 name:z.string().trim().min(1).max(120),contactChannel:z.enum(["email","phone"]),contact,
 secondaryContact:z.object({channel:z.enum(["email","phone"]),value:contact}).strict().optional(),
 emailUpdates:z.boolean(),language:z.enum(["en","he"]),siteLanguage:z.enum(["en","he"]),townOrZip:z.string().trim().min(2).max(100),
 childAges:z.array(z.number().int().min(0).max(18)).min(1).max(8),
 availability:z.string().trim().max(500).optional(),question:z.string().trim().max(2000).optional(),
 permission:z.object({confirmed:z.literal(true),version:z.literal(BNA_COOP_NOTICE.version),language:z.enum(["en","he"])}).strict(),
}).strict().superRefine((value,ctx)=>{
 if(value.secondaryContact){
  const secondary=value.secondaryContact;
  if(secondary.channel===value.contactChannel)ctx.addIssue({code:"custom",path:["secondaryContact"],message:"distinct contact channel required"});
  if(secondary.channel==="email"&&(!z.email().max(254).safeParse(secondary.value.toLowerCase()).success||secondary.value!==secondary.value.toLowerCase()))ctx.addIssue({code:"custom",path:["secondaryContact","value"],message:"email required"});
  if(secondary.channel==="phone"&&!/^\+[1-9]\d{7,14}$/.test(secondary.value))ctx.addIssue({code:"custom",path:["secondaryContact","value"],message:"international phone required"});
 }
 if(value.emailUpdates&&value.contactChannel!=="email"&&value.secondaryContact?.channel!=="email")ctx.addIssue({code:"custom",path:["emailUpdates"],message:"email required for email updates"});
 if(value.permission.language!==value.siteLanguage)ctx.addIssue({code:"custom",path:["permission","language"],message:"notice language mismatch"});
 if(value.contactChannel==="email"&&(!z.email().max(254).safeParse(value.contact.toLowerCase()).success||value.contact!==value.contact.toLowerCase()))ctx.addIssue({code:"custom",path:["contact"],message:"email required"});
 if(value.contactChannel==="phone"&&!/^\+[1-9]\d{7,14}$/.test(value.contact))ctx.addIssue({code:"custom",path:["contact"],message:"international phone required"});
});
export type BnaCoopFields=z.infer<typeof bnaCoopFieldsSchema>;
