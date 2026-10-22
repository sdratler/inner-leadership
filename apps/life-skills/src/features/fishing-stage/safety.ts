import {z} from 'zod';

export const academySafetyVersion='JLFA-OWNER-20261020-REFUND-SAFETY-03' as const;
const uuid=z.uuid(),note=z.string().trim().min(1).max(1200),instant=z.iso.datetime({offset:true});
const base={operationId:uuid,expectedRevision:z.number().int().positive(),occurrenceId:uuid,expectedOccurrenceRevision:z.number().int().positive(),enrollmentId:uuid};
export const safetyCommandSchemas=[
 z.strictObject({...base,action:z.literal('assess_safety'),decision:z.enum(['ready','restricted','not_ready']),casting:note,waterEdge:note,instructions:note,restrictions:note}),
 z.strictObject({...base,action:z.literal('safety_intervention'),decision:z.enum(['warning','stop_activity','suspend_activity','remove_activity']),reason:note,supervisingAdult:note,handoff:z.enum(['not_required','awaiting_authorized_guardian'])}).superRefine((v,c)=>{if(v.decision!=='warning'&&v.handoff!=='awaiting_authorized_guardian')c.addIssue({code:'custom',message:'serious_intervention_requires_handoff'});}),
 z.strictObject({...base,action:z.literal('safety_handoff'),interventionId:uuid,authorizedGuardianReference:note,handoffEvidence:note})
] as const;
export const safetyCommandSchema=z.discriminatedUnion('action',safetyCommandSchemas);
export type SafetyCommand=z.infer<typeof safetyCommandSchema>;
const recorded={id:uuid,operationId:uuid,occurrenceId:uuid,occurrenceRevision:z.number().int().positive(),enrollmentId:uuid,learnerId:uuid,recordedBy:uuid,recordedAt:instant,version:z.literal(academySafetyVersion)};
export const safetyStateSchema=z.strictObject({
 assessments:z.array(z.strictObject({...recorded,decision:z.enum(['ready','restricted','not_ready']),casting:note,waterEdge:note,instructions:note,restrictions:note})).max(512),
 interventions:z.array(z.strictObject({...recorded,decision:z.enum(['warning','stop_activity','suspend_activity','remove_activity']),reason:note,supervisingAdult:note,handoff:z.enum(['not_required','awaiting_authorized_guardian'])})).max(512),
 handoffs:z.array(z.strictObject({...recorded,interventionId:uuid,authorizedGuardianReference:note,handoffEvidence:note})).max(512)
}).superRefine((s,c)=>{
 const all=[...s.assessments,...s.interventions,...s.handoffs];
 if(new Set(all.map(v=>v.id)).size!==all.length||new Set(all.map(v=>v.operationId)).size!==all.length)c.addIssue({code:'custom',message:'duplicate_safety_evidence'});
 for(const i of s.interventions)if(i.decision!=='warning'&&i.handoff!=='awaiting_authorized_guardian')c.addIssue({code:'custom',message:'serious_intervention_requires_handoff'});
 for(const h of s.handoffs){const i=s.interventions.find(v=>v.id===h.interventionId);if(!i||i.handoff!=='awaiting_authorized_guardian'||i.enrollmentId!==h.enrollmentId||i.learnerId!==h.learnerId||i.occurrenceId!==h.occurrenceId||h.recordedAt<i.recordedAt||s.handoffs.filter(v=>v.interventionId===i.id).length!==1)c.addIssue({code:'custom',message:'invalid_handoff'});}
});
export type SafetyState=z.infer<typeof safetyStateSchema>;
/** Human-authored observations only. No automatic warning counter, enrollment
 * mutation, disciplinary fee, adult-ratio approval or message is produced. */
export function applySafetyCommand(state:SafetyState,raw:SafetyCommand,facts:{actorId:string;learnerId:string;now:string;nextId:()=>string}):SafetyState{
 const c=safetyCommandSchema.parse(raw),s=safetyStateSchema.parse(state),common={id:facts.nextId(),operationId:c.operationId,occurrenceId:c.occurrenceId,occurrenceRevision:c.expectedOccurrenceRevision,enrollmentId:c.enrollmentId,learnerId:facts.learnerId,recordedBy:facts.actorId,recordedAt:facts.now,version:academySafetyVersion};
 if(c.action==='assess_safety')s.assessments.push({...common,decision:c.decision,casting:c.casting,waterEdge:c.waterEdge,instructions:c.instructions,restrictions:c.restrictions});
 else if(c.action==='safety_intervention')s.interventions.push({...common,decision:c.decision,reason:c.reason,supervisingAdult:c.supervisingAdult,handoff:c.handoff});
 else s.handoffs.push({...common,interventionId:c.interventionId,authorizedGuardianReference:c.authorizedGuardianReference,handoffEvidence:c.handoffEvidence});
 return safetyStateSchema.parse(s);
}
