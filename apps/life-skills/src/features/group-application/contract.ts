import {z} from "zod";

/** Existing Israel application permission. This contract remains writable at /groups/apply. */
export const groupApplicationNotice={
 version:"ls-group-application-20261009-01-v1",
 en:"I agree that Life Skills may store these application and contact details privately and contact me about this group inquiry. This is an application for owner review only. It is not clinical consent, recurring marketing permission, enrollment, placement, payment authorization, booking or a guarantee of acceptance.",
 he:"אני מסכים/ה שכישורי חיים ישמור באופן פרטי את פרטי הבקשה והקשר ויצור איתי קשר בנוגע להתעניינות בקבוצה. זוהי בקשה לבדיקת הבעלים בלבד. אין זו הסכמה טיפולית, הרשאה לשיווק חוזר, הרשמה, שיבוץ, הרשאה לתשלום, קביעת פגישה או הבטחת קבלה.",
} as const;

/** Direct public permission for one administrative Florida program inquiry. */
export const floridaGroupApplicationNotice={
 version:"LS-FISH-FL-LANDING-20261012-01-INQUIRY-v1",
 en:"I agree that Life Skills may store these basic contact and group-interest details privately and contact me about this inquiry. This does not enroll a child, accept service terms, authorize recurring marketing, reserve a place, create a booking or authorize payment.",
 he:"אני מסכים/ה שכישורי חיים ישמרו באופן פרטי את פרטי הקשר הבסיסיים ואת העניין בקבוצה, וייצרו איתי קשר בנוגע לפנייה זו. הפנייה אינה רושמת ילד, מאשרת תנאי שירות, נותנת הסכמה לשיווק חוזר, שומרת מקום, יוצרת הזמנה או מאשרת תשלום.",
} as const;

export function normalizeGroupApplicationContact(input:string):string{
 const trimmed=input.trim();
 if(trimmed.includes("@"))return trimmed.toLowerCase();
 const compact=trimmed.replace(/[\s().-]/g,"");
 return compact.startsWith("00")?"+"+compact.slice(2):compact;
}
export function normalizeGroupApplicationPhone(input:string):string{
 const compact=input.trim().replace(/[\s().-]/g,"");
 if(compact.startsWith("00"))return "+"+compact.slice(2);
 if(/^0\d{8,9}$/.test(compact))return "+972"+compact.slice(1);
 return compact;
}

export const observationValueSchema=z.enum(["not_shared","going_well","sometimes_difficult","would_like_support"]);
export const groupApplicationTownSchema=z.enum(["beit_shemesh","jerusalem","modiin","other"]);
const currentScreenTimeSchema=z.enum(["none","under_2_hours_weekly","2_to_5_hours_weekly","6_to_10_hours_weekly","11_to_20_hours_weekly","over_20_hours_weekly","no_fixed_limit","not_sure"]);
const legacyScreenTimeSchema=z.enum(["not_shared","under_1_hour","1_to_2_hours","2_to_4_hours","over_4_hours"]);
const israelFieldsBase=z.object({
 parentName:z.string().trim().min(1).max(100),
 parentPhone:z.string().max(32).transform(normalizeGroupApplicationPhone).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)),
 language:z.enum(["he","en"]),childAge:z.number().int().min(0).max(17),town:z.string().trim().min(1).max(120),
 townChoice:groupApplicationTownSchema.optional(),otherTown:z.string().trim().min(1).max(120).optional(),neighborhood:z.string().trim().min(1).max(120).optional(),
 schedulePreference:z.enum(["morning","evening","flexible"]),interestedInEveningGroup:z.boolean().optional(),
 screenAccess:z.enum(["not_shared","screens_at_home","no_screens_at_home","no_regular_access","shared_device","own_device"]).optional(),
 screenTime:z.union([currentScreenTimeSchema,legacyScreenTimeSchema]).optional(),
 observations:z.object({intrinsicMotivation:observationValueSchema.optional(),expression:observationValueSchema.optional(),selfGovernance:observationValueSchema.optional(),valuesAndGoals:observationValueSchema.optional(),cooperation:observationValueSchema.optional(),socialConfidence:observationValueSchema.optional(),stressfulSituations:observationValueSchema.optional()}).strict(),
 parentPriorities:z.string().trim().min(1).max(600).optional(),
 permission:z.object({confirmed:z.literal(true),version:z.literal(groupApplicationNotice.version),language:z.enum(["he","en"])}).strict(),
}).strict();
const townNames={beit_shemesh:"Beit Shemesh",jerusalem:"Jerusalem",modiin:"Modiin"} as const;
function currentIsraelFieldsIssue(value:z.infer<typeof israelFieldsBase>,context:z.RefinementCtx){
 if(!value.townChoice)context.addIssue({code:"custom",path:["townChoice"],message:"required"});
 if(!value.neighborhood)context.addIssue({code:"custom",path:["neighborhood"],message:"required"});
 if(value.interestedInEveningGroup!==undefined)context.addIssue({code:"custom",path:["interestedInEveningGroup"],message:"deprecated"});
 if(value.townChoice==="other"){
  if(!value.otherTown)context.addIssue({code:"custom",path:["otherTown"],message:"required"});
  else if(value.town!==value.otherTown)context.addIssue({code:"custom",path:["town"],message:"mismatch"});
 }else if(value.townChoice&&value.town!==townNames[value.townChoice])context.addIssue({code:"custom",path:["town"],message:"mismatch"});
 if(value.townChoice!=="other"&&value.otherTown!==undefined)context.addIssue({code:"custom",path:["otherTown"],message:"unexpected"});
 if(value.screenAccess!==undefined&&!(["screens_at_home","no_screens_at_home"] as const).includes(value.screenAccess as "screens_at_home"|"no_screens_at_home"))context.addIssue({code:"custom",path:["screenAccess"],message:"legacy value"});
 if(value.screenTime!==undefined&&!currentScreenTimeSchema.safeParse(value.screenTime).success)context.addIssue({code:"custom",path:["screenTime"],message:"legacy value"});
 if(value.screenAccess==="no_screens_at_home"&&value.screenTime!==undefined)context.addIssue({code:"custom",path:["screenTime"],message:"unexpected"});
}
export const currentGroupApplicationFieldsSchema=israelFieldsBase.superRefine(currentIsraelFieldsIssue);
const israelReadableFieldsSchema=israelFieldsBase.superRefine((value,context)=>{
 if(value.townChoice!==undefined){currentIsraelFieldsIssue(value,context);return;}
 if(value.interestedInEveningGroup===undefined)context.addIssue({code:"custom",path:["interestedInEveningGroup"],message:"legacy field required"});
 if(value.neighborhood!==undefined||value.otherTown!==undefined)context.addIssue({code:"custom",path:["townChoice"],message:"legacy location shape invalid"});
});

const contactSchema=z.string().max(254).transform(normalizeGroupApplicationContact).pipe(z.string().refine(value=>z.string().email().safeParse(value).success||/^\+?\d{7,15}$/.test(value),"contact"));
const scheduleValueSchema=z.enum(["weekday_after_school","sunday","flexible","other","weekday_morning_homeschool"]);
export const floridaProgramIdSchema=z.enum(["sunday_fishing_academy","morning_torah_learning","private_fishing_life_skills"]);
export type FloridaProgramId=z.infer<typeof floridaProgramIdSchema>;
export const floridaParentApplicationFieldsSchema=z.object({
 parentName:z.string().trim().min(1).max(100),contact:contactSchema,language:z.enum(["he","en"]),
 childAge:z.string().trim().min(1).max(20).optional(),cityArea:z.string().trim().min(1).max(100),neighborhood:z.string().trim().min(1).max(100).optional(),
 programId:floridaProgramIdSchema,
 schedulePreference:z.array(scheduleValueSchema).min(1).max(5).refine(values=>new Set(values).size===values.length,"duplicate schedule preference"),
 scheduleContext:z.literal("program_format_interest").optional(),
 scheduleNotes:z.string().trim().min(1).max(300).optional(),
 permission:z.object({confirmed:z.literal(true),version:z.literal(floridaGroupApplicationNotice.version),language:z.enum(["he","en"])}).strict(),
}).strict().superRefine((value,context)=>{
 if(value.scheduleContext!==undefined&&value.programId!=="sunday_fishing_academy")context.addIssue({code:"custom",path:["scheduleContext"],message:"academy-only format interest"});
 if(value.schedulePreference.includes("weekday_morning_homeschool")&&(value.programId!=="sunday_fishing_academy"||value.scheduleContext!=="program_format_interest"))context.addIssue({code:"custom",path:["schedulePreference"],message:"academy format context required"});
});

/** Business contact permission only; never a guardian attestation or school contract. */
export const floridaSchoolInquiryNotice={
 version:"LS-FISH-FL-FORMS-20261013-01-SCHOOL-INQUIRY-v1",
 en:"I agree that Life Skills may keep these business inquiry details privately and contact me about the requested school activity. This does not accept a quotation, make a booking, consent to any child's participation or sign me up for general marketing.",
 he:"אני מסכים/ה שכישורי חיים ישמרו באופן פרטי את פרטי הפנייה המקצועית וייצרו איתי קשר לגבי הפעילות שבית הספר מבקש לברר. אין בכך אישור להצעת מחיר, הזמנה, הסכמה להשתתפות של ילד כלשהו או הרשמה לשיווק כללי.",
} as const;
export const floridaSchoolInquiryFieldsSchema=z.object({
 inquiryKind:z.literal("institution"),programId:z.literal("sunday_fishing_academy"),language:z.enum(["he","en"]),
 schoolName:z.string().trim().min(1).max(120),contactName:z.string().trim().min(1).max(100),staffRole:z.string().trim().min(1).max(80),cityArea:z.string().trim().min(1).max(100),
 contact:contactSchema.refine(value=>value.includes("@")||/^\+[1-9]\d{7,14}$/.test(value),"include country code"),
 ageBand:z.enum(["under_8","8_10","11_13","14_17","mixed","undecided"]),groupSize:z.number().int().min(1).max(1000),
 preferredWeekday:z.enum(["monday","tuesday","wednesday","thursday","friday","flexible"]),schoolTransport:z.enum(["yes","no","undecided"]),
 permission:z.object({confirmed:z.literal(true),version:z.literal(floridaSchoolInquiryNotice.version),language:z.enum(["he","en"])}).strict(),
}).strict().superRefine((value,context)=>{if(value.permission.language!==value.language)context.addIssue({code:"custom",path:["permission","language"],message:"permission language must match inquiry"});});
export const floridaGroupApplicationFieldsSchema=z.union([floridaParentApplicationFieldsSchema,floridaSchoolInquiryFieldsSchema]);

export const groupApplicationFieldsSchema=z.union([floridaGroupApplicationFieldsSchema,israelReadableFieldsSchema]);
export const israelGroupApplicationCommandSchema=z.object({operationId:z.string().uuid(),fields:currentGroupApplicationFieldsSchema}).strict();
export const floridaGroupApplicationCommandSchema=z.object({operationId:z.string().uuid(),fields:floridaGroupApplicationFieldsSchema}).strict();
export const groupApplicationCommandSchema=z.union([floridaGroupApplicationCommandSchema,israelGroupApplicationCommandSchema]);
const submissionBase={challenge:z.string().min(80).max(1024),website:z.literal(""),operationId:z.string().uuid()} as const;
export const groupApplicationSubmissionSchema=z.object({...submissionBase,fields:currentGroupApplicationFieldsSchema}).strict();
export const floridaGroupApplicationSubmissionSchema=z.object({...submissionBase,fields:floridaGroupApplicationFieldsSchema}).strict();
export type IsraelGroupApplicationFields=z.infer<typeof currentGroupApplicationFieldsSchema>;
export type IsraelReadableGroupApplicationFields=z.infer<typeof israelReadableFieldsSchema>;
export type FloridaGroupApplicationFields=z.infer<typeof floridaGroupApplicationFieldsSchema>;
export type FloridaParentApplicationFields=z.infer<typeof floridaParentApplicationFieldsSchema>;
export type FloridaSchoolInquiryFields=z.infer<typeof floridaSchoolInquiryFieldsSchema>;
export type GroupApplicationFields=z.infer<typeof groupApplicationFieldsSchema>;
export type IsraelGroupApplicationCommand=z.infer<typeof israelGroupApplicationCommandSchema>;
export type FloridaGroupApplicationCommand=z.infer<typeof floridaGroupApplicationCommandSchema>;
export type GroupApplicationCommand=z.infer<typeof groupApplicationCommandSchema>;
export type GroupApplicationRecord={id:string;source:"public_group_application";state:"owner_review";receivedAt:string;fields:GroupApplicationFields};
export function isFloridaGroupApplication(fields:GroupApplicationFields):fields is FloridaGroupApplicationFields{return "programId" in fields;}
export function isSchoolInquiry(fields:GroupApplicationFields):fields is FloridaSchoolInquiryFields{return "inquiryKind" in fields&&fields.inquiryKind==="institution";}
