import {z} from 'zod';
export const academySharedServiceVersion='JLFA-SHARED-SERVICE-20261021-01' as const;
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive().max(1000000);
export const academySharedServiceStateSchema=z.enum(['pending','credited','not_attended','local_alternative','cancelled','review_required']);
export const academySharedServiceViewSchema=z.strictObject({state:academySharedServiceStateSchema,recordedOnce:z.boolean(),originalActivity:z.literal('not_inferred')});
/** Private provenance, never a browser-supplied financial/attendance fact. */
export const academySharedServiceEvidenceSchema=z.strictObject({version:z.literal(academySharedServiceVersion),originalOccurrenceId:uuid,purchaseId:uuid,purchaseLineId:uuid,learnerId:uuid,enrollmentId:uuid.nullable(),
 eventId:uuid,publicationId:uuid,publicationRevision:revision,publicationSha256:sha,bindingSha256:sha,sourceReviewSha256:sha,sourceRevoked:z.boolean(),
 startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),state:academySharedServiceStateSchema,recordedOnce:z.boolean(),
 attendance:z.strictObject({id:uuid,revision,sha256:sha,state:z.enum(['present','late','absent','no_show'])}).nullable()});
export type AcademySharedServiceEvidence=z.infer<typeof academySharedServiceEvidenceSchema>;
export type AcademySharedServiceView=z.infer<typeof academySharedServiceViewSchema>;
export function academySharedServiceView(value:AcademySharedServiceEvidence):AcademySharedServiceView{return academySharedServiceViewSchema.parse({state:value.state,recordedOnce:value.recordedOnce,originalActivity:'not_inferred'});}
