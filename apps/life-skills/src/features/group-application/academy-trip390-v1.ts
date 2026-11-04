import {z} from 'zod';

/** Immutable pre-20261104-02 read/replay contract. Never tighten historical answers. */
export const TRIP390_V1_INTEREST_VERSION='JLFA-TRIP390-INTEREST-v1';
export const TRIP390_V1_NOTICE_VERSION='JLFA-TRIP390-INTEREST-NOTICE-v1';
export const TRIP390_V1_OFFER=Object.freeze({version:'JLFA-KEYS390-v1'} as const);
const text=(max:number)=>z.string().trim().min(1).max(max).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'control_characters');
export const trip390V1InterestSchema=z.object({
 version:z.literal(TRIP390_V1_INTEREST_VERSION),offerVersion:z.literal(TRIP390_V1_OFFER.version),
 guardianName:text(100),email:z.string().trim().email().max(254).transform(value=>value.toLowerCase()),
 phone:z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional(),
 city:text(120).refine(value=>Array.from(value).length>=2,'city_required'),
 postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
 messageLanguage:z.enum(['en','he']),instructionLanguage:z.enum(['en','he','either']).optional(),
 children:z.array(z.object({id:z.string().uuid(),name:text(100),ageYears:z.number().int().min(0).max(120),experience:z.enum(['new','some','experienced','not_sure'])}).strict()).min(1).max(10),
 notes:text(600).optional(),
 acknowledgment:z.object({version:z.literal(TRIP390_V1_NOTICE_VERSION),language:z.enum(['en','he']),conductExplained:z.literal(true),interestPrivacySafety:z.literal(true),whatsapp:z.boolean()}).strict(),
}).strict().superRefine((value,ctx)=>{
 if(value.acknowledgment.whatsapp&&!value.phone)ctx.addIssue({code:'custom',path:['phone'],message:'whatsapp_phone_required'});
 if(new Set(value.children.map(child=>child.id)).size!==value.children.length)ctx.addIssue({code:'custom',path:['children'],message:'duplicate_child'});
});
export type Trip390V1Interest=z.infer<typeof trip390V1InterestSchema>;
export const trip390V1Notice={
  "en": {
    "conduct": "I have read and explained the Fishing Academy conduct rules to each child listed.",
    "interest": "I have read the interest-registration information, safety summary and privacy notice. I understand that this form is not payment, a reserved seat or the final participation agreement.",
    "privacy": "Your family’s details are private. We use them to plan groups and contact you about the program.",
    "whatsapp": "Optional: Send me Fishing Academy trip updates and reminders by WhatsApp.",
    "interestNote": "No payment now. We’ll contact you to confirm dates and availability."
  },
  "he": {
    "conduct": "קראתי והסברתי את כללי ההתנהגות באקדמיה לדיג לכל ילד שרשום בטופס.",
    "interest": "קראתי את המידע על רישום ההתעניינות, תקציר הבטיחות והודעת הפרטיות. אני מבין/ה שטופס זה אינו תשלום, שמירת מקום או הסכם ההשתתפות הסופי.",
    "privacy": "פרטי המשפחה נשמרים באופן פרטי ומשמשים לתכנון קבוצות וליצירת קשר לגבי התוכנית.",
    "whatsapp": "רשות: אני מעוניין/ת לקבל עדכונים ותזכורות על טיולי האקדמיה לדיג בוואטסאפ.",
    "interestNote": "אין תשלום עכשיו. ניצור איתכם קשר לאישור המועדים והזמינות."
  }
} as const;
