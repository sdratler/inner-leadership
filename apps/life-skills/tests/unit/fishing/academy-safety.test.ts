import {randomUUID,createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import {applySafetyCommand,safetyCommandSchema,safetyStateSchema,type SafetyState} from '../../../src/features/fishing-stage/safety.ts';
import {stageCommandSchema} from '../../../src/features/fishing-stage/contract.ts';
const base=()=>({operationId:randomUUID(),expectedRevision:1,occurrenceId:randomUUID(),expectedOccurrenceRevision:1,enrollmentId:randomUUID()}),facts={actorId:randomUUID(),learnerId:randomUUID(),now:'2026-10-21T12:00:00Z',nextId:randomUUID};
const intervention=(decision:'warning'|'stop_activity'|'suspend_activity'|'remove_activity',handoff:'not_required'|'awaiting_authorized_guardian')=>({...base(),action:'safety_intervention' as const,decision,reason:'SYNTHETIC owner observation',supervisingAdult:'Synthetic responsible adult',handoff});
const empty:SafetyState={assessments:[],interventions:[],handoffs:[]};
test('new warnings may explicitly omit pickup, while every serious intervention retains adult supervision and authorized handoff',()=>{
 const warning=intervention('warning','not_required');expect(stageCommandSchema.safeParse(warning).success).toBe(true);expect(safetyCommandSchema.safeParse(warning).success).toBe(true);expect(safetyCommandSchema.safeParse(intervention('warning','awaiting_authorized_guardian')).success).toBe(true);
 for(const decision of ['stop_activity','suspend_activity','remove_activity']as const){expect(stageCommandSchema.safeParse(intervention(decision,'not_required')).success).toBe(false);expect(stageCommandSchema.safeParse(intervention(decision,'awaiting_authorized_guardian')).success).toBe(true);expect(safetyCommandSchema.safeParse({...intervention(decision,'awaiting_authorized_guardian'),supervisingAdult:''}).success).toBe(false);}
});
test('legacy warning and handoff evidence survives unchanged when appending a warning without pickup',()=>{
 const old=intervention('warning','awaiting_authorized_guardian'),pending=applySafetyCommand(empty,old,facts),record=pending.interventions[0]!,handoff={...base(),action:'safety_handoff' as const,occurrenceId:record.occurrenceId,enrollmentId:record.enrollmentId,interventionId:record.id,authorizedGuardianReference:'SYNTHETIC verified guardian',handoffEvidence:'SYNTHETIC actual pickup'},legacy=applySafetyCommand(pending,handoff,facts),bytes=JSON.stringify(legacy),hash=createHash('sha256').update(bytes).digest('hex');
 expect(JSON.stringify(safetyStateSchema.parse(legacy))).toBe(bytes);const next=applySafetyCommand(legacy,intervention('warning','not_required'),facts);expect(JSON.stringify(legacy)).toBe(bytes);expect(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')).toBe(hash);expect(next.interventions[0]).toEqual(legacy.interventions[0]);expect(next.handoffs).toEqual(legacy.handoffs);expect(next.interventions[1]!.handoff).toBe('not_required');
});
test('handoff cannot be fabricated against a warning that did not request pickup or a serious record with a weakened requirement',()=>{
 const warning=applySafetyCommand(empty,intervention('warning','not_required'),facts),record=warning.interventions[0]!;expect(()=>applySafetyCommand(warning,{...base(),action:'safety_handoff',occurrenceId:record.occurrenceId,enrollmentId:record.enrollmentId,interventionId:record.id,authorizedGuardianReference:'SYNTHETIC guardian',handoffEvidence:'SYNTHETIC fabricated pickup'},facts)).toThrow();expect(safetyStateSchema.safeParse({...warning,interventions:[{...record,decision:'remove_activity'}]}).success).toBe(false);
});
