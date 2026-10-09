import {z} from "zod";

/** Direct public permission for one administrative group application. */
export const groupApplicationNotice={
 version:"ls-group-application-20261009-01-v1",
 en:"I agree that Life Skills may store these application and contact details privately and contact me about this group inquiry. This is an application for owner review only. It is not clinical consent, recurring marketing permission, enrollment, placement, payment authorization, booking or a guarantee of acceptance.",
 he:"אני מסכים/ה שכישורי חיים ישמור באופן פרטי את פרטי הבקשה והקשר ויצור איתי קשר בנוגע להתעניינות בקבוצה. זוהי בקשה לבדיקת הבעלים בלבד. אין זו הסכמה טיפולית, הרשאה לשיווק חוזר, הרשמה, שיבוץ, הרשאה לתשלום, קביעת פגישה או הבטחת קבלה.",
} as const;
export function normalizeGroupApplicationPhone(input:string):string{
 const compact=input.trim().replace(/[\s().-]/g,"");
 if(compact.startsWith("00"))return "+"+compact.slice(2);
 if(/^0\d{8,9}$/.test(compact))return "+972"+compact.slice(1);
 return compact;
}

export const observationValueSchema=z.enum(["not_shared","going_well","sometimes_difficult","would_like_support"]);
export const groupApplicationFieldsSchema=z.object({
 parentName:z.string().trim().min(1).max(100),
 parentPhone:z.string().max(32).transform(normalizeGroupApplicationPhone).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)),
 language:z.enum(["he","en"]),
 childAge:z.number().int().min(0).max(17),
 town:z.string().trim().min(1).max(120),
 schedulePreference:z.enum(["morning","evening","flexible"]),
 interestedInEveningGroup:z.boolean(),
 screenAccess:z.enum(["not_shared","no_regular_access","shared_device","own_device"]).optional(),
 screenTime:z.enum(["not_shared","under_1_hour","1_to_2_hours","2_to_4_hours","over_4_hours"]).optional(),
 observations:z.object({
  intrinsicMotivation:observationValueSchema.optional(),expression:observationValueSchema.optional(),
  selfGovernance:observationValueSchema.optional(),valuesAndGoals:observationValueSchema.optional(),
  cooperation:observationValueSchema.optional(),socialConfidence:observationValueSchema.optional(),
  stressfulSituations:observationValueSchema.optional(),
 }).strict(),
 parentPriorities:z.string().trim().min(1).max(600).optional(),
 permission:z.object({confirmed:z.literal(true),version:z.literal(groupApplicationNotice.version),language:z.enum(["he","en"])}).strict(),
}).strict();
export const groupApplicationCommandSchema=z.object({operationId:z.string().uuid(),fields:groupApplicationFieldsSchema}).strict();
export const groupApplicationSubmissionSchema=z.object({
 challenge:z.string().min(80).max(1024),website:z.literal(""),operationId:z.string().uuid(),fields:groupApplicationFieldsSchema,
}).strict();
export type GroupApplicationFields=z.infer<typeof groupApplicationFieldsSchema>;
export type GroupApplicationCommand=z.infer<typeof groupApplicationCommandSchema>;
export type GroupApplicationRecord={id:string;source:"public_group_application";state:"owner_review";receivedAt:string;fields:GroupApplicationFields};
