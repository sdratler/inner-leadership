import {z} from 'zod';
export const academyEnrollmentVersion='JLFA-ENROLLMENT-REVIEW-20261020-01' as const;
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().trim().min(1).max(1200).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
export const academyOwnerEnrollmentBindingSchema=z.strictObject({applicationId:uuid,personId:uuid,expectedEpoch:z.number().int().nonnegative(),expectedAssociationVersion:z.number().int().positive(),expectedFieldsDigest:sha,expectedFamilyDigest:sha});
export const academyEnrollmentCommandSchema=z.discriminatedUnion('action',[
 z.strictObject({version:z.literal(academyEnrollmentVersion),action:z.literal('fit'),operationId:uuid,binding:academyOwnerEnrollmentBindingSchema,learnerIndex:z.number().int().min(0).max(9),stageId:uuid,decision:z.enum(['approved','rejected']),note:text}),
 z.strictObject({version:z.literal(academyEnrollmentVersion),action:z.literal('terms'),operationId:uuid,learnerId:uuid,stageId:uuid,sourceApprovalId:uuid,sourceSha256:sha,termsVersion:z.string().min(1).max(120),accepted:z.literal(true)})
]);
export type AcademyEnrollmentCommand=z.infer<typeof academyEnrollmentCommandSchema>;
export type AcademyOwnerEnrollmentBinding=z.infer<typeof academyOwnerEnrollmentBindingSchema>;
export type AcademyEnrollmentStage={stageId:string;cohortId:string;stage:1|2|3|4;label:string;fit:null|{id:string;decision:'approved'|'rejected';recordedAt:string};terms:{state:'unavailable'}|{state:'available';sourceApprovalId:string;sourceSha256:string;termsVersion:string;body:string;acceptanceId:string|null}};
export type AcademyEnrollmentContext={state:'not_ready';reason:'family_setup_required'|'parent_activation_required'}|{state:'ready';role:'practitioner';binding:AcademyOwnerEnrollmentBinding;children:{learnerIndex:number;learnerId:string;displayName:string}[];stages:Record<string,AcademyEnrollmentStage[]>}|{state:'ready';role:'parent';learnerId:string;stages:AcademyEnrollmentStage[]};
