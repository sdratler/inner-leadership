import {z} from "zod";

/** Source03 inquiry preferences only. This is never enrollment, payment,
 * capacity, transport, readiness or founding-family reservation authority. */
export const ACADEMY_INTAKE_VERSION="JLFA-ENROLLMENT-20261018-03-v1" as const;
export const academyDriveLimitSchema=z.union([z.enum(["up_to_30","up_to_45","up_to_60","over_60"]),z.number().int().min(5).max(120).multipleOf(5)]);
export const academyIntakeSchema=z.object({
 version:z.literal(ACADEMY_INTAKE_VERSION),
 postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
 driveLimit:academyDriveLimitSchema,
 preferredAreas:z.string().trim().min(1).max(160).optional(),
 preferredGroupLanguage:z.enum(["en","he","either"]),
 stagePreference:z.enum(["foundation","independent","advanced","leadership","discuss"]),
 keysTravel:z.enum(["parent_drive","shuttle_interest","alternative","discuss"]),
 offshoreInterest:z.enum(["interested","not_interested","discuss"]),
 nextStep:z.enum(["enrollment_followup","callback"]),
 confirmationEmail:z.string().trim().email().max(254).transform(value=>value.toLowerCase()).optional(),
 travelNotes:z.string().trim().min(1).max(300).optional(),
 learners:z.array(z.object({
  ageYears:z.number().int().min(0).max(17).optional(),
  gradeBand:z.enum(["grade_3_5","grade_6_8","grade_9_12","discuss"]),
  schooling:z.enum(["school","homeschool","discuss"]),
  tackleBox:z.enum(["ready","need_advice","not_sure"]),
 }).strict()).min(1).max(10),
}).strict();
export type AcademyIntake=z.infer<typeof academyIntakeSchema>;
export type AcademyDriveLimit=z.infer<typeof academyDriveLimitSchema>;
/** "Over60" is a recorded category, never an invented unlimited numeric cap. */
export function academyDriveMinutes(limit:AcademyDriveLimit):number|undefined{
 if(typeof limit==="number")return limit;
 return limit==="up_to_30"?30:limit==="up_to_45"?45:limit==="up_to_60"?60:undefined;
}
const optional=(value:FormDataEntryValue|null)=>typeof value==="string"&&value.trim()?value:undefined;
export function academyIntakeFromForm(values:FormData):AcademyIntake|null{
 const count=Number(values.get("learnerCount"));if(!Number.isInteger(count)||count<1||count>10)return null;
 const result=academyIntakeSchema.safeParse({version:ACADEMY_INTAKE_VERSION,
  postalCode:values.get("postalCode"),driveLimit:/^\d+$/.test(String(values.get("driveLimit")??""))?Number(values.get("driveLimit")):values.get("driveLimit"),preferredAreas:optional(values.get("preferredAreas")),
  preferredGroupLanguage:values.get("preferredGroupLanguage"),stagePreference:values.get("stagePreference"),
  keysTravel:values.get("keysTravel"),offshoreInterest:values.get("offshoreInterest"),nextStep:values.get("nextStep"),
  confirmationEmail:optional(values.get("confirmationEmail")),travelNotes:optional(values.get("travelNotes")),
  learners:Array.from({length:count},(_,index)=>({ageYears:values.get(`learnerAge-${index}`)===null||values.get(`learnerAge-${index}`)===""?undefined:Number(values.get(`learnerAge-${index}`)),gradeBand:values.get(`learnerGrade-${index}`),schooling:values.get(`learnerSchooling-${index}`),tackleBox:values.get(`learnerTackleBox-${index}`)})),
 });return result.success?result.data:null;
}
