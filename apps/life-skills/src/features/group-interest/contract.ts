import {z} from "zod";
/** Candidate administrative inquiry only. Never acceptance of a place, treatment or payment. */
export const interestNotice = {
 version:"ls-group-interest-20261007-01-v1",
 en:"The parent agreed that Life Skills may store these contact and group-interest details privately and contact them about this inquiry. This is administrative interest only: it is not clinical consent, marketing permission, service registration, enrollment, placement, payment authority or a guarantee of follow-up.",
 he:"ההורה הסכים שכישורי חיים ישמור באופן פרטי את פרטי הקשר וההתעניינות ויצור קשר בנוגע לפנייה זו. זוהי התעניינות מנהלית בלבד: אין זו הסכמה טיפולית, הרשאה לשיווק, רישום לשירות, הרשמה, שיבוץ, הרשאה לתשלום או הבטחה למעקב.",
} as const;
const short=z.string().trim().min(1).max(100);
export const interestFieldsSchema=z.object({
 serviceType:z.enum(["group","tutoring","group_and_tutoring"]),
 parentName:short,parentPhone:z.string().regex(/^\+[1-9]\d{7,14}$/),
 language:z.enum(["he","en"]),childLabel:z.string().trim().min(1).max(60),
 childAge:z.number().int().min(0).max(17),
 area:z.string().trim().max(120),availability:z.string().trim().max(240),
 groupPreference:z.string().trim().max(240),
 permission:z.object({confirmed:z.literal(true),version:z.literal(interestNotice.version),
 language:z.enum(["he","en"]),source:z.enum(["spoken","written","whatsapp"])}).strict(),
}).strict();
export const interestCommandSchema=z.object({operationId:z.string().uuid(),fields:interestFieldsSchema}).strict();
export const serviceInterestCommandSchema=z.object({
 action:z.literal("record_service_interest"),operationId:z.string().uuid(),inquiryId:z.string().uuid(),
 familyId:z.string().uuid(),personId:z.string().uuid(),serviceType:z.enum(["group","tutoring"]),
}).strict();
export const interestMutationSchema=z.union([interestCommandSchema,serviceInterestCommandSchema]);
export type InterestFields=z.infer<typeof interestFieldsSchema>;
export type InterestCommand=z.infer<typeof interestCommandSchema>;
export type ServiceInterestCommand=z.infer<typeof serviceInterestCommandSchema>;
export type InterestRecord={id:string;state:"interest";source:"owner_entered";createdAt:string;recordedBy:string;fields:InterestFields};
export type VerifiedFamilyMember={familyId:string;familyLabel:string;personId:string;personLabel:string};
export type ServiceInterestRecord={id:string;state:"service_interest";serviceType:"group"|"tutoring";sourceInquiryId:string;
 familyId:string;familyLabel:string;personId:string;personLabel:string;recordedBy:string;createdAt:string};
export type InterestList={items:InterestRecord[];hasMore:boolean;members:VerifiedFamilyMember[];
 serviceInterests:ServiceInterestRecord[]};
