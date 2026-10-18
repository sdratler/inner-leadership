import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {ACADEMY_INTAKE_VERSION} from "../../src/features/group-application/academy-intake.ts";
import {AcademyIntakeReadback,academyDriveLabel} from "../../src/features/group-application/academy-intake-readback.tsx";
import {AcademyFitReadback} from "../../src/features/group-application/fit-fields.tsx";
import {academyApplicationNotice,floridaGroupApplicationNotice,floridaParentApplicationFieldsSchema,
 floridaGroupApplicationReadableFieldsSchema,groupApplicationFieldsSchema,groupApplicationReplaySchema,
 floridaGroupApplicationSubmissionSchema} from "../../src/features/group-application/contract.ts";

const operationId="b42e3f51-05ae-4c34-8979-c9e88abf08ce";
function current(language:"en"|"he"="en",nextStep:"callback"|"enrollment_followup"="callback",driveLimit=120){
 return {parentName:"Synthetic compatibility parent",contact:"synthetic@example.invalid",language,cityArea:"Synthetic area",
  programId:"sunday_fishing_academy" as const,schedulePreference:["sunday" as const],scheduleContext:"program_format_interest" as const,
  permission:{confirmed:true as const,version:academyApplicationNotice.version,language},
  academyFit:{version:"RM-FIT-20261014-04-v1" as const,learners:[{approximateAge:12,gear:"not_sure" as const,experience:"new" as const}],maximumDriveMinutes:driveLimit,parentDropoff:"discuss" as const},
  academyIntake:{version:ACADEMY_INTAKE_VERSION,postalCode:"33431",driveLimit,preferredGroupLanguage:"either" as const,stagePreference:"foundation" as const,
   keysTravel:"parent_drive" as const,offshoreInterest:"discuss" as const,nextStep,
   learners:[{ageYears:12,gradeBand:"grade_6_8" as const,schooling:"school" as const,tackleBox:"not_sure" as const}]}};
}
const readers=[floridaParentApplicationFieldsSchema,floridaGroupApplicationReadableFieldsSchema,groupApplicationFieldsSchema];

describe("released Academy payload in the preserved native candidate",()=>{
 for(const language of["en","he"] as const)for(const nextStep of["callback","enrollment_followup"] as const)for(const driveLimit of[5,120]){
  it(`${language} ${nextStep} ${driveLimit}: submission, stored JSON, replay and owner readback keep exact fields`,()=>{
   const fields=current(language,nextStep,driveLimit);
   expect(floridaGroupApplicationSubmissionSchema.parse({operationId,website:"",challenge:"c".repeat(80),fields}).fields).toEqual(fields);
   const stored=JSON.parse(JSON.stringify(fields));
   for(const reader of readers)expect(reader.parse(stored)).toEqual(fields);
   expect(groupApplicationReplaySchema.parse({operationId,fields:stored})).toEqual({operationId,fields});
   const decoded=floridaParentApplicationFieldsSchema.parse(stored),intake=decoded.academyIntake!;
   const html=renderToStaticMarkup(createElement(AcademyIntakeReadback,{intake,locale:language}));
   expect(html).toContain(academyDriveLabel(driveLimit,language));
   expect(html).toContain(language==="he"?"גיל בשנים":"Age (years)");
   expect(html).toContain("<dd>12</dd>");
   const fit=renderToStaticMarkup(createElement(AcademyFitReadback,{fit:decoded.academyFit!,locale:language,driveLabel:academyDriveLabel(intake.driveLimit,language),exactAges:intake.learners.every(learner=>learner.ageYears!==undefined)}));
   expect(fit).toContain(language==="he"?"גיל בשנים":"Age (years)");
   expect(fit).not.toContain(language==="he"?"גיל משוער":"Approximate age");
  });
 }
 it.each(["up_to_30","up_to_45","up_to_60","over_60"] as const)("historical %s remains readable without manufacturing exact age or an over60 numeric cap",driveLimit=>{
  const fields=current(),{ageYears,...learner}=fields.academyIntake.learners[0]!;
  expect(ageYears).toBe(12);
  const maximumDriveMinutes=driveLimit==="over_60"?undefined:driveLimit==="up_to_30"?30:driveLimit==="up_to_45"?45:60;
  const historical={...fields,permission:{...fields.permission,version:floridaGroupApplicationNotice.version},academyIntake:{...fields.academyIntake,driveLimit,learners:[learner]},academyFit:{...fields.academyFit,maximumDriveMinutes}};
  const stored=JSON.parse(JSON.stringify(historical));
  for(const reader of readers)expect(reader.parse(stored)).toEqual(stored);
  expect(groupApplicationReplaySchema.parse({operationId,fields:stored}).fields).toEqual(stored);
  const decoded=floridaParentApplicationFieldsSchema.parse(stored),html=renderToStaticMarkup(createElement(AcademyIntakeReadback,{intake:decoded.academyIntake!,locale:"en"}));
  expect(html).not.toContain("Age (years)");expect(html).toContain(academyDriveLabel(driveLimit,"en"));
  if(driveLimit==="over_60")expect(decoded.academyFit?.maximumDriveMinutes).toBeUndefined();
 });
 it("current consent cannot bypass missing or contradictory details through stored/replay legacy branches",()=>{
  const fields=current();
  const bad=[{...fields,academyIntake:undefined},{...fields,academyIntake:{...fields.academyIntake,learners:[{...fields.academyIntake.learners[0],ageYears:undefined}]}},
   {...fields,academyFit:{...fields.academyFit,learners:[{...fields.academyFit.learners[0],approximateAge:13}]}},
   {...fields,academyFit:{...fields.academyFit,maximumDriveMinutes:60}},{...fields,programId:"private_fishing_life_skills"},
   {...fields,permission:{...fields.permission,language:"he"}},{...fields,academyIntake:{...fields.academyIntake,reserved:true}}];
  for(const value of bad){for(const reader of readers)expect(reader.safeParse(value).success).toBe(false);expect(groupApplicationReplaySchema.safeParse({operationId,fields:value}).success).toBe(false);}
 });
});
