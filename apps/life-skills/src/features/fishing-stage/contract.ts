import {z} from "zod";
import type {Actor,EnrollmentProjection,FishingNotice,FishingSource,FishingStageRef,IdentityClock,OccurrenceProjection} from "../fishing/contract.ts";
export type {Actor,EnrollmentProjection,FishingNotice,FishingStageRef,IdentityClock,OccurrenceProjection};

export const floridaZone="America/New_York" as const;
const uuid=z.uuid(),version=z.string().trim().min(1).max(120),revision=z.number().int().nonnegative();
const text=z.string().max(1200).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
const decisionReason=text.trim().min(1);
export const stageReferenceSchema=z.strictObject({cohortId:uuid,stageId:uuid,stage:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)])});
export const occurrenceTimeSchema=z.discriminatedUnion("kind",[
 z.strictObject({kind:z.literal("undated"),timeZone:z.literal(floridaZone)}),
 z.strictObject({kind:z.literal("scheduled"),timeZone:z.literal(floridaZone),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true})})
]).superRefine((time,ctx)=>{if(time.kind==="scheduled"&&Date.parse(time.endsAt)<=Date.parse(time.startsAt))ctx.addIssue({code:"custom",message:"END_MUST_FOLLOW_START"});});
export const logisticsSchema=z.strictObject({time:occurrenceTimeSchema,location:text,directions:text,equipment:text,logisticalNote:text,childCapacity:z.number().int().min(1).max(1000)});
const base={operationId:uuid,expectedRevision:revision};
const occurrence={occurrenceId:uuid,expectedOccurrenceRevision:revision.min(1)};
export const stageCommandSchema=z.discriminatedUnion("action",[
 z.strictObject({...base,action:z.literal("create"),templateVersion:version,childCapacity:z.number().int().min(1).max(1000)}),
 z.strictObject({...base,action:z.literal("publish")}),
 z.strictObject({...base,...occurrence,action:z.literal("revise"),details:logisticsSchema,reason:decisionReason}),
 z.strictObject({...base,...occurrence,action:z.literal("cancel"),reason:decisionReason}),
 z.strictObject({...base,...occurrence,action:z.literal("complete"),reason:decisionReason}),
 z.strictObject({...base,...occurrence,action:z.literal("attendance"),enrollmentId:uuid,state:z.enum(["present","late","absent","no_show"]),reason:decisionReason}),
 z.strictObject({...base,...occurrence,action:z.literal("notice"),reason:z.enum(["ordinary_absence","unavoidable"])}),
 z.strictObject({...base,action:z.literal("request_makeup"),noticeId:uuid}),
 z.strictObject({...base,action:z.literal("confirm_makeup"),noticeId:uuid,replacementOccurrenceId:uuid,expectedReplacementRevision:revision.min(1),reason:decisionReason})
]);
export type StageCommand=z.infer<typeof stageCommandSchema>;
export type CanonicalOccurrence=Omit<OccurrenceProjection,"allowedActions">;
export type ApprovedStageTemplate=FishingSource&{
 version:string;stage:FishingStageRef["stage"];status:"approved";
 sourceSha256:string;modules:readonly {moduleId:string;moduleVersion:string;learnerContent:"approved"|"unavailable"}[];
};
export type AttendanceFact={enrollmentId:string;occurrenceId:string;state:"present"|"late"|"absent"|"no_show";recordedAt:string;recordedBy:string;reason:string};
export type MakeupRecord={notice:FishingNotice;requestedAt:string|null;decisionAt:string|null;decisionBy:string|null;decisionReason:string|null};
export type StageState=FishingStageRef&FishingSource&{
 workspaceId:Actor["workspaceId"];program:"sunday_fishing_academy";revision:number;template:ApprovedStageTemplate;
 occurrences:CanonicalOccurrence[];
 history:CanonicalOccurrence[];attendance:AttendanceFact[];makeups:MakeupRecord[];
};
export type StageReceipt={operationId:string;stageRevision:number;replayed:boolean};
export type OperationRecord={digest:string;receipt:StageReceipt};
/** These are freshly resolved native facts, NOT browser inputs or cached grants.
 * MAIN's adapter must bind them to the same transaction as every read/write. */
export type FreshStageContext={
 actor:Actor;sessionRevoked:boolean;scope:FishingStageRef&{workspaceId:string;program:"sunday_fishing_academy"};
 instructor:{accountId:Actor["id"];displayName:string};operatorAccountIds:readonly string[];
 approvedChildCapacity:number;enrollment:EnrollmentProjection|null;
 guardianRelationshipCurrent:boolean;childAccountEnabled:boolean;
};
export type ReplacementCandidate={occurrence:CanonicalOccurrence;suitableForEnrollment:boolean};
export interface FishingStageTransaction {
 resolveFreshContext(actor:Actor,ref:FishingStageRef):Promise<FreshStageContext|null>;
 resolveApprovedTemplate(context:FreshStageContext,version:string):Promise<ApprovedStageTemplate|null>;
 load(context:FreshStageContext):Promise<StageState|null>;
 readOperation(context:FreshStageContext,operationId:string):Promise<OperationRecord|null>;
 readEnrollment(context:FreshStageContext,enrollmentId:string):Promise<EnrollmentProjection|null>;
 /** Count confirmed AND reserved child places using native locks. */
 occupiedSeats(context:FreshStageContext,occurrenceId:string):Promise<number>;
 /** Reuse existing adult/venue calendar reservations, one per occurrence.
  * Validate approved resources, overlaps, holidays and safe capacity under lock.
  * Undated/cancelled rows release only their own reservations; never book them. */
 reconcileResources(context:FreshStageContext,before:readonly CanonicalOccurrence[],after:readonly CanonicalOccurrence[]):Promise<void>;
 resolveReplacement(context:FreshStageContext,enrollmentId:string,occurrenceId:string):Promise<ReplacementCandidate|null>;
 /** Atomically recheck target revision, suitability and all reserved/confirmed
  * seats. Enforce one reservation per entitlement and per learner/target. */
 reserveMakeup(context:FreshStageContext,input:{enrollmentId:string;entitlementId:string;occurrenceId:string;expectedRevision:number}):Promise<string>;
 /** Atomic CAS + immutable revision + operation receipt; roll back ALL port
  * effects on failure. Unique workspace/cohort/stage/template/ordinal binding. */
 commit(context:FreshStageContext,state:StageState,expectedRevision:number,operation:OperationRecord):Promise<void>;
}
export interface FishingStageStore {transaction<T>(work:(tx:FishingStageTransaction)=>Promise<T>):Promise<T>;}
export type StageView=FishingStageRef&{
 revision:number;role:"practitioner"|"parent"|"child";enrollmentId:string|null;
 occurrences:OccurrenceProjection[];nextOccurrenceId:string|null;
 notices:Array<{id:string;occurrenceId:string;state:FishingNotice["state"];receivedAt:string;originalStartsAt:string;originalOccurrenceRevision:number;scheduleChangedSinceNotice:boolean;requestedAt:string|null;replacementOccurrenceId:string|null;specificTripGuaranteed:false}>;
 attendance:Array<Pick<AttendanceFact,"enrollmentId"|"occurrenceId"|"state"|"recordedAt">>;
 lessonReferences:Array<{occurrenceId:string;moduleId:string;version:string}>;
};
