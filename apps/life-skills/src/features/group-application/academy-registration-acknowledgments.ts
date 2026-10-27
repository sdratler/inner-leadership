import {z} from 'zod';

/** Parent attestations captured by the current free-registration form.
 * They do not mark a child as signed, authorize payment or turn the displayed
 * information into a final participation waiver. Historical registrations do
 * not acquire these attestations retroactively. */
export const academyConductAttestation={
 id:'jlfa-parent-conduct-attestation',
 version:'JLFA-PARENT-CONDUCT-ATTESTATION-20261027-01-v1',
 en:'I have read and explained the Fishing Academy conduct rules to each child listed in this registration.',
 he:'קראתי והסברתי את כללי ההתנהגות של אקדמיית הדיג לכל ילד הרשום בהרשמה זו.',
} as const;
export const academyConductAttestationHashes={
 en:'99b2b605e687e0bd2ce90d1ad32635d47f04bdf89eba4dea475e20ccf37acfb2',
 he:'4c63bdce4a4de74f2c7a729643fcc47fd1de2a69657706db0e6c1d4b13535392',
} as const;

export const academyProgramInformationAcceptance={
 id:'jlfa-program-information-acceptance',
 version:'JLFA-PROGRAM-INFORMATION-ACCEPTANCE-20261027-01-v1',
 en:'I have read and agree to the program terms, safety information, payment and cancellation information, and registration privacy notice. I understand that this free registration does not authorize payment or complete a final participation waiver.',
 he:'קראתי ואני מסכים/ה לתנאי התוכנית, למידע הבטיחות, למידע על תשלום וביטול ולהודעת הפרטיות של ההרשמה. מובן לי שהרשמה חינמית זו אינה מתירה תשלום ואינה משלימה כתב ויתור סופי להשתתפות.',
} as const;
export const academyProgramInformationAcceptanceHashes={
 en:'4961b269fb057655d955b08a5280969e53ed95e5c31edff7ac3cfbdb027e410d',
 he:'f51aa4d0fb335c555c619a1ad420bbf6de31f5d7c1e986782a22d7a1b900dd97',
} as const;

const language=z.enum(['en','he']);
export const academyRegistrationAcknowledgmentsSchema=z.object({
 version:z.literal('academy-registration-acknowledgments-v1'),
 conduct:z.object({
  confirmed:z.literal(true),kind:z.literal('parent_explained_child_conduct'),
  childIds:z.array(z.string().uuid()).min(1).max(10),
  documentId:z.literal(academyConductAttestation.id),version:z.literal(academyConductAttestation.version),
  language,textSha256:z.string().regex(/^[a-f0-9]{64}$/),
 }).strict(),
 programInformation:z.object({
  confirmed:z.literal(true),kind:z.literal('program_information_acceptance'),
  documentId:z.literal(academyProgramInformationAcceptance.id),version:z.literal(academyProgramInformationAcceptance.version),
  language,textSha256:z.string().regex(/^[a-f0-9]{64}$/),
 }).strict(),
}).strict().superRefine((value,context)=>{
 if(new Set(value.conduct.childIds).size!==value.conduct.childIds.length)context.addIssue({code:'custom',path:['conduct','childIds'],message:'duplicate_child'});
 if(value.conduct.language!==value.programInformation.language)context.addIssue({code:'custom',path:['programInformation','language'],message:'acknowledgment_language_mismatch'});
 if(value.conduct.textSha256!==academyConductAttestationHashes[value.conduct.language])context.addIssue({code:'custom',path:['conduct'],message:'conduct_attestation_mismatch'});
 if(value.programInformation.textSha256!==academyProgramInformationAcceptanceHashes[value.programInformation.language])context.addIssue({code:'custom',path:['programInformation'],message:'program_information_acceptance_mismatch'});
});
export type AcademyRegistrationAcknowledgments=z.infer<typeof academyRegistrationAcknowledgmentsSchema>;

export function registrationAcknowledgments(language:'en'|'he',childIds:readonly string[]):AcademyRegistrationAcknowledgments{
 return {
  version:'academy-registration-acknowledgments-v1',
  conduct:{confirmed:true,kind:'parent_explained_child_conduct',childIds:[...childIds],documentId:academyConductAttestation.id,version:academyConductAttestation.version,language,textSha256:academyConductAttestationHashes[language]},
  programInformation:{confirmed:true,kind:'program_information_acceptance',documentId:academyProgramInformationAcceptance.id,version:academyProgramInformationAcceptance.version,language,textSha256:academyProgramInformationAcceptanceHashes[language]},
 };
}
