import {z} from 'zod';
import {billingId,billingInstant,sourceReferenceSchema} from './contracts.ts';

export const PROGRAM_SOURCE_V3='JLFA-FISHING-PROGRAM-SOURCE-v3' as const;
const id=billingId.refine(v=>v===v.toLowerCase(),'CANONICAL_UUID_REQUIRED');
const text=z.string().trim().min(1).max(200).refine(v=>!/[\p{Cc}\p{Cf}]/u.test(v));
const exactInstant=billingInstant.refine(v=>!(/\.(\d+)/.exec(v)?.[1]?.slice(3)??'').replace(/0+$/,''),'MILLISECOND_PRECISION_REQUIRED');
const base={version:z.literal(PROGRAM_SOURCE_V3),operationId:id,groupId:id,id,expectedRevision:z.number().int().min(0).max(2147483646)};
const groupFields=z.object({state:z.enum(['forming','cancelled']),location:text,venueSource:sourceReferenceSchema}).strict();
const lessonFields=z.object({state:z.enum(['scheduled','cancelled']),sequence:z.number().int().min(1).max(1000),
 startsAt:exactInstant,endsAt:exactInstant,timeZone:z.literal('America/New_York'),
}).strict().refine(v=>Date.parse(v.endsAt)>Date.parse(v.startsAt),'LESSON_ORDER');
const progressionFields=z.object({state:z.enum(['planned','withdrawn']),familyId:id,
 proposalId:id,reference:id,expectedEpoch:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),
 eligibleFrom:exactInstant,readiness:z.enum(['needs_foundation','foundation_one_complete','foundation_complete','verified_catchup']),
 evidence:sourceReferenceSchema.nullable(),
}).strict().refine(v=>v.readiness==='needs_foundation'||v.evidence!==null,'PROGRESSION_EVIDENCE_REQUIRED');
export const programSourceCommandV3Schema=z.discriminatedUnion('kind',[
 z.object({...base,kind:z.literal('group'),fields:groupFields}).strict(),
 z.object({...base,kind:z.literal('lesson'),fields:lessonFields}).strict(),
 z.object({...base,kind:z.literal('progression'),fields:progressionFields}).strict(),
]).refine(c=>c.kind!=='group'||c.id===c.groupId,'GROUP_ID_MISMATCH');
export type ProgramSourceCommandV3=z.infer<typeof programSourceCommandV3Schema>;
export const programSourceRecordV3Schema=z.object({
 version:z.literal(PROGRAM_SOURCE_V3),workspaceId:id,revision:z.number().int().positive().max(2147483647),
 recordedBy:id,recordedAt:billingInstant,previousDigest:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
 command:programSourceCommandV3Schema,
}).strict().refine(r=>r.revision===r.command.expectedRevision+1&&(r.previousDigest===null)===(r.revision===1),'SOURCE_HISTORY');
export type ProgramSourceRecordV3=z.infer<typeof programSourceRecordV3Schema>;
