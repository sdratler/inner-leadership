import {z} from "zod";
/** Candidate administrative inquiry only. Never acceptance of a place, treatment or payment. */
export const interestNotice = {
 version:"group-interest-candidate-v1",
 en:"The parent agreed that Life Skills may store these contact and group-interest details privately and contact them about this inquiry. This records interest only; it does not reserve a place, accept service terms, authorize clinical processing, marketing messages or payment.",
 he:"ההורה הסכים שכישורי חיים ישמור באופן פרטי את פרטי הקשר וההתעניינות ויצור קשר בקשר לפנייה זו. זהו תיעוד התעניינות בלבד: אין שמירת מקום, הסכמה לתנאי שירות, עיבוד מידע טיפולי, מסרים שיווקיים או תשלום.",
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
export type InterestFields=z.infer<typeof interestFieldsSchema>;
export type InterestCommand=z.infer<typeof interestCommandSchema>;
export type InterestRecord={id:string;state:"interest";source:"owner_entered";createdAt:string;recordedBy:string;fields:InterestFields};
export type InterestList={items:InterestRecord[];hasMore:boolean};
