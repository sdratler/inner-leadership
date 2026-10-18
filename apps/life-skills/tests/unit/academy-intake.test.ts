import{describe,it,expect}from"vitest";
import{ACADEMY_INTAKE_VERSION,academyIntakeSchema,academyDriveMinutes,academyIntakeFromForm}from"../../src/features/group-application/academy-intake.ts";
import{floridaParentApplicationFieldsSchema,floridaGroupApplicationReadableFieldsSchema,floridaGroupApplicationNotice,academyApplicationNotice}from"../../src/features/group-application/contract.ts";

const intake=()=>({version:ACADEMY_INTAKE_VERSION,postalCode:"33431",driveLimit:"up_to_30" as const,preferredGroupLanguage:"either" as const,stagePreference:"discuss" as const,keysTravel:"parent_drive" as const,offshoreInterest:"discuss" as const,nextStep:"callback" as const,learners:[{gradeBand:"grade_3_5" as const,schooling:"school" as const,tackleBox:"not_sure" as const}]});
const legacy=()=>({parentName:"Synthetic parent",contact:"+12025550101",language:"en" as const,cityArea:"Synthetic area",programId:"sunday_fishing_academy" as const,schedulePreference:["sunday" as const],academyFit:{version:"RM-FIT-20261014-04-v1" as const,learners:[{approximateAge:10,gear:"not_sure" as const,experience:"new" as const}],maximumDriveMinutes:30,parentDropoff:"discuss" as const},scheduleContext:"program_format_interest" as const,permission:{confirmed:true as const,version:floridaGroupApplicationNotice.version,language:"en" as const}});
describe("Source03 saved inquiry preferences",()=>{
 it("retains exact five-minute drive choices through two hours without reinterpreting old over60 records",()=>{
  for(let minutes=5;minutes<=120;minutes+=5){const value=academyIntakeSchema.parse({...intake(),driveLimit:minutes});expect(value.driveLimit).toBe(minutes);expect(academyDriveMinutes(value.driveLimit)).toBe(minutes);}
  for(const driveLimit of[0,4,13,121,125,Infinity,"120","unlimited"])expect(academyIntakeSchema.safeParse({...intake(),driveLimit}).success).toBe(false);
  expect(academyDriveMinutes("over_60")).toBeUndefined();
 });
 it("converts the new form controls into an exact numeric preference and learner age for either next-step choice",()=>{
  for(const nextStep of["callback","enrollment_followup"]){const values=new FormData();for(const[key,value]of Object.entries({learnerCount:"1",postalCode:"33431",driveLimit:"120",preferredGroupLanguage:"en",stagePreference:"foundation",keysTravel:"parent_drive",offshoreInterest:"discuss",nextStep,"learnerAge-0":"12","learnerGrade-0":"grade_6_8","learnerSchooling-0":"school","learnerTackleBox-0":"ready"}))values.set(key,value);
   expect(academyIntakeFromForm(values)).toMatchObject({driveLimit:120,nextStep,learners:[{ageYears:12}]});values.set("driveLimit","125");expect(academyIntakeFromForm(values)).toBeNull();
  }
 });
 it("requires matching exact learner age and full intake for the new Academy consent while preserving historical consent",()=>{
  const base=legacy(),value={...base,permission:{...base.permission,version:academyApplicationNotice.version},academyIntake:{...intake(),driveLimit:120,learners:[{...intake().learners[0]!,ageYears:10}]},academyFit:{...base.academyFit,maximumDriveMinutes:120}};
  expect(floridaParentApplicationFieldsSchema.parse(value)).toEqual(value);
  expect(floridaParentApplicationFieldsSchema.safeParse({...value,academyIntake:undefined}).success).toBe(false);
  expect(floridaParentApplicationFieldsSchema.safeParse({...value,academyIntake:{...value.academyIntake,learners:intake().learners}}).success).toBe(false);
  expect(floridaParentApplicationFieldsSchema.safeParse({...value,academyFit:{...value.academyFit,learners:[{...base.academyFit.learners[0]!,approximateAge:11}]}}).success).toBe(false);
  expect(floridaGroupApplicationReadableFieldsSchema.parse(base)).toEqual(base);
 });
 it("accepts the complete metadata without adding payment or reservation fields",()=>{const parsed=academyIntakeSchema.parse(intake());expect(parsed).toEqual(intake());expect("payment"in parsed).toBe(false);expect("reserved"in parsed).toBe(false);});
 it.each(["postalCode","driveLimit","preferredGroupLanguage","stagePreference","keysTravel","offshoreInterest","nextStep","learners"])("requires %s in this version",key=>{const value:Record<string,unknown>={...intake()};delete value[key];expect(academyIntakeSchema.safeParse(value).success).toBe(false);});
 it("never maps more-than60 to an invented number",()=>{expect((["up_to_30","up_to_45","up_to_60","over_60"] as const).map(value=>academyDriveMinutes(value))).toEqual([30,45,60,undefined]);});
 it("rejects unknown fields, invalid ZIP, incorrect version and empty learner sets",()=>{for(const value of[{...intake(),childName:"Forbidden extra"},{...intake(),postalCode:"abc"},{...intake(),version:"other"},{...intake(),learners:[]},{...intake(),driveLimit:"unlimited"}])expect(academyIntakeSchema.safeParse(value).success).toBe(false);});
 it("preserves legacy fit shape with no new defaults",()=>{const value=legacy();expect(floridaParentApplicationFieldsSchema.parse(value)).toEqual(value);expect(Object.hasOwn(floridaParentApplicationFieldsSchema.parse(value),"academyIntake")).toBe(false);});
 it("requires matching fit/learner/drive/context and academy program for new metadata",()=>{const base={...legacy(),academyIntake:intake()};expect(floridaParentApplicationFieldsSchema.safeParse(base).success).toBe(true);for(const value of[{...base,academyFit:undefined},{...base,academyFit:{...base.academyFit,learners:[]}},{...base,academyFit:{...base.academyFit,maximumDriveMinutes:45}},{...base,scheduleContext:undefined},{...base,programId:"private_fishing_life_skills"},{...base,academyIntake:{...intake(),learners:[...intake().learners,...intake().learners]}}])expect(floridaParentApplicationFieldsSchema.safeParse(value).success).toBe(false);});
 it("keeps the over60 category explicit and rejects contradictory old numeric drive",()=>{const value={...legacy(),academyIntake:{...intake(),driveLimit:"over_60"}};expect(floridaParentApplicationFieldsSchema.safeParse(value).success).toBe(false);expect(floridaParentApplicationFieldsSchema.safeParse({...value,academyFit:{...value.academyFit,maximumDriveMinutes:undefined}}).success).toBe(true);});
 it("cannot fall back through the old readable generation with an invalid new intake",()=>{const value={...legacy(),academyFit:undefined,academyIntake:intake()};expect(floridaGroupApplicationReadableFieldsSchema.safeParse(value).success).toBe(false);});
 it("retains phone-only inquiry without manufacturing an email",()=>{const value=floridaParentApplicationFieldsSchema.parse({...legacy(),academyIntake:intake()});expect(value.contact).toBe("+12025550101");expect(value.academyIntake?.confirmationEmail).toBeUndefined();});
 it("normalizes only an explicitly supplied confirmation email and rejects invalid destinations",()=>{expect(academyIntakeSchema.parse({...intake(),confirmationEmail:" Synthetic@Example.Invalid "}).confirmationEmail).toBe("synthetic@example.invalid");expect(academyIntakeSchema.safeParse({...intake(),confirmationEmail:"not-an-email"}).success).toBe(false);});
 it("does not treat missing form controls or an invalid child count as complete",()=>{expect(academyIntakeFromForm(new FormData())).toBeNull();const form=new FormData();form.set("learnerCount","11");expect(academyIntakeFromForm(form)).toBeNull();});
});
