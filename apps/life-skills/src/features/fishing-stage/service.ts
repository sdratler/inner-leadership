import "server-only";
import {createHash,randomUUID} from "node:crypto";
import type {FishingOccurrenceReadPort} from "../fishing/contract.ts";
import {canonicalTime,noticeState} from "./time.ts";
import {applyWeeklyCommand,weeklyStateSchema,weeklyPublications,weeklyPublicationCurrent,WeeklyProgressError,type WeeklyCommand,type WeeklyReadFacts} from "./weekly-progress.ts";
import {floridaZone,logisticsSchema,stageCommandSchema,stageReferenceSchema,
 type Actor,type ApprovedStageTemplate,type CanonicalOccurrence,type EnrollmentProjection,type FishingStageRef,
 type FishingStageStore,type FishingStageTransaction,type FreshStageContext,type IdentityClock,type MakeupRecord,
 type OccurrenceProjection,type StageCommand,type StageState,type StageView} from "./contract.ts";

export class FishingStageError extends Error {
 constructor(readonly code:"FORBIDDEN"|"NOT_FOUND"|"CONFLICT"|"CAPACITY"|"INVALID_STATE"|"APPROVAL_REQUIRED"){super(`FISHING_STAGE_${code}`);}
}
function fail(code:FishingStageError["code"]):never{throw new FishingStageError(code);}
function sameStage(a:FishingStageRef,b:FishingStageRef){return a.cohortId===b.cohortId&&a.stageId===b.stageId&&a.stage===b.stage;}
function operator(c:FreshStageContext){return c.actor.role==="practitioner"&&c.operatorAccountIds.includes(c.actor.id);}
const weeklyActions=new Set(["observe_skills","draft_weekly_recap","review_weekly_recap","publish_weekly_recap"]);
function isWeekly(command:StageCommand):command is WeeklyCommand{return weeklyActions.has(command.action);}
const weeklyDigest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function weeklyFacts(s:StageState,enrollment:EnrollmentProjection,occurrenceId:string,now:Date):WeeklyReadFacts|null{
 const o=s.occurrences.find(value=>value.id===occurrenceId),attendance=s.attendance.filter(value=>value.enrollmentId===enrollment.id&&value.occurrenceId===occurrenceId).at(-1);
 if(!o||o.time.kind!=="scheduled"||!attendance)return null;
 return {now:now.toISOString(),digest:weeklyDigest,enrollment:{id:enrollment.id,learnerId:enrollment.learnerId},
  occurrence:{id:o.id,revision:o.revision,moduleId:o.moduleId,moduleVersion:o.moduleVersion,startsAt:o.time.startsAt,endsAt:o.time.endsAt,state:o.state},
  attendance:{state:attendance.state,recordedAt:attendance.recordedAt,recordedBy:attendance.recordedBy}};
}
function validEnrollment(e:EnrollmentProjection|null,c:FreshStageContext):e is EnrollmentProjection{
 return !!e&&e.workspaceId===c.scope.workspaceId&&e.program===c.scope.program&&sameStage(e,c.scope)&&e.state==="confirmed"&&
  Number.isSafeInteger(e.revision)&&e.revision>0&&[e.evidence?.verifiedGuardianBindingId,e.evidence?.capacityReservationId,e.evidence?.fitDecisionId,
   e.evidence?.acceptedTermsVersion,e.evidence?.ownerActionId].every(value=>typeof value==="string"&&value.trim().length>0);
}
function fresh(c:FreshStageContext|null,actor:Actor,ref:FishingStageRef,now:Date):FreshStageContext{
 if(!c||c.sessionRevoked||c.actor.state!=="active"||!Number.isFinite(c.actor.expiresAt)||c.actor.expiresAt<=now.getTime()||c.actor.id!==actor.id||
  c.actor.workspaceId!==actor.workspaceId||c.actor.sessionDigest!==actor.sessionDigest||c.scope.workspaceId!==c.actor.workspaceId||
  c.scope.program!=="sunday_fishing_academy"||!sameStage(c.scope,ref))fail("FORBIDDEN");
 if(operator(c))return c;
 const e=c.enrollment;
 if(!validEnrollment(e,c)||!e.authorizedAccountIds.includes(c.actor.id))fail("FORBIDDEN");
 if(c.actor.role==="parent"&&c.guardianRelationshipCurrent)return c;
 if(c.actor.role==="child"&&c.childAccountEnabled&&c.actor.personId===e.learnerId)return c;
 return fail("FORBIDDEN");
}
function templateValid(t:ApprovedStageTemplate|null,ref:FishingStageRef,version:string):t is ApprovedStageTemplate{
 return !!t&&t.status==="approved"&&t.version===version&&t.stage===ref.stage&&/^[a-f0-9]{64}$/.test(t.sourceSha256)&&
  !!t.policyVersion&&!!t.sourceVersion&&t.modules.length===12&&t.modules.every((m,i)=>
   m.moduleId===`RM-${ref.stage}${String(i+1).padStart(2,"0")}`&&!!m.moduleVersion&&["approved","unavailable"].includes(m.learnerContent));
}
/** An adapter must decode and authenticate encrypted snapshots before this
 * structural check. This function is not an encryption or authorization layer. */
export function validateStageState(s:StageState,c:Pick<FreshStageContext,"scope">):void{
 if(s.workspaceId!==c.scope.workspaceId||s.program!==c.scope.program||!sameStage(s,c.scope)||!Number.isSafeInteger(s.revision)||s.revision<1||
  !templateValid(s.template,s,s.template.version)||s.occurrences.length!==12||new Set(s.occurrences.map(o=>o.id)).size!==12||
  s.policyVersion!==s.template.policyVersion||s.sourceVersion!==s.template.sourceVersion)fail("INVALID_STATE");
 for(const [index,o] of s.occurrences.entries()){
  const lessonModule=s.template.modules[index]!;
  if(o.workspaceId!==s.workspaceId||o.program!==s.program||!sameStage(o,s)||o.ordinal!==index+1||o.templateVersion!==s.template.version||
   o.moduleId!==lessonModule.moduleId||o.moduleVersion!==lessonModule.moduleVersion||o.optional!==false||!Number.isSafeInteger(o.revision)||o.revision<1||
   !["draft","published","completed","cancelled"].includes(o.state))fail("INVALID_STATE");
  logisticsSchema.parse({time:o.time,location:o.location,directions:o.directions,equipment:o.equipment,logisticalNote:o.logisticalNote,childCapacity:o.childCapacity});
  const history=s.history.filter(h=>h.id===o.id);
  if(history.length!==o.revision-1||history.some((h,i)=>h.revision!==i+1||h.workspaceId!==s.workspaceId||!sameStage(h,s)))fail("INVALID_STATE");
 }
 if(new Set(s.makeups.map(m=>`${m.notice.enrollmentId}:${m.notice.occurrenceId}`)).size!==s.makeups.length)fail("INVALID_STATE");
 if(s.weekly){
  const weekly=weeklyStateSchema.parse(s.weekly);
  for(const item of [...weekly.observations,...weekly.recaps]){
   const o=s.occurrences.find(value=>value.id===item.occurrenceId);
   if(!o||o.state!=="completed"||o.moduleId!==item.moduleId||o.moduleVersion!==item.moduleVersion)fail("INVALID_STATE");
  }
 }
}
function projection(o:CanonicalOccurrence,c:FreshStageContext):OccurrenceProjection{
 const allowed:OccurrenceProjection["allowedActions"][number][]=["read"];
 if(operator(c)){
  if(o.state==="draft"||o.state==="published")allowed.push("revise","cancel");
  if(o.state==="completed")allowed.push("record_attendance");
 }else if(c.actor.role==="parent"&&o.time.kind==="scheduled"&&(o.state==="published"||o.state==="cancelled"))allowed.push("report_absence","request_makeup");
 // Deliberate whitelist; no spread of store objects, private notes or roster.
 return {id:o.id,revision:o.revision,workspaceId:o.workspaceId,program:o.program,cohortId:o.cohortId,stageId:o.stageId,stage:o.stage,
  templateVersion:o.templateVersion,ordinal:o.ordinal,moduleId:o.moduleId,moduleVersion:o.moduleVersion,state:o.state,optional:o.optional,
  time:canonicalTime(o.time),location:o.location,directions:o.directions,equipment:o.equipment,logisticalNote:o.logisticalNote,
  instructor:{accountId:o.instructor.accountId,displayName:o.instructor.displayName},childCapacity:o.childCapacity,
  replacesOccurrenceId:o.replacesOccurrenceId,changedBy:o.changedBy,changedAt:o.changedAt,changeReason:o.changeReason,allowedActions:allowed};
}
function view(s:StageState,c:FreshStageContext,now:Date):StageView{
 const occurrences=s.occurrences.filter(o=>operator(c)||o.state!=="draft").map(o=>projection(o,c));
 const next=occurrences.filter(o=>o.state==="published"&&o.time.kind==="scheduled"&&Date.parse(o.time.endsAt)>now.getTime())
  .sort((a,b)=>Date.parse(a.time.kind==="scheduled"?a.time.startsAt:"")-Date.parse(b.time.kind==="scheduled"?b.time.startsAt:""))[0];
 const own=c.enrollment?.id;
 return {cohortId:s.cohortId,stageId:s.stageId,stage:s.stage,revision:s.revision,role:c.actor.role as StageView["role"],enrollmentId:operator(c)?null:own!,
  occurrences,nextOccurrenceId:next?.id??null,
  notices:(c.actor.role==="child"?[]:s.makeups.filter(m=>operator(c)||m.notice.enrollmentId===own)).map(m=>({id:m.notice.id,occurrenceId:m.notice.occurrenceId,
   state:s.occurrences.find(o=>o.id===m.notice.occurrenceId)?.state==="cancelled"?"operator_undelivered":m.notice.state,receivedAt:m.notice.receivedAt,originalStartsAt:m.notice.originalStartsAt,originalOccurrenceRevision:m.notice.originalOccurrenceRevision,
   scheduleChangedSinceNotice:s.occurrences.find(o=>o.id===m.notice.occurrenceId)?.revision!==m.notice.originalOccurrenceRevision,
   requestedAt:m.requestedAt,replacementOccurrenceId:m.notice.replacementOccurrenceId,specificTripGuaranteed:false})),
  attendance:s.attendance.filter(a=>operator(c)||a.enrollmentId===own).map(a=>({enrollmentId:a.enrollmentId,occurrenceId:a.occurrenceId,state:a.state,recordedAt:a.recordedAt})),
  lessonReferences:occurrences.filter(o=>s.template.modules[o.ordinal-1]?.learnerContent==="approved").map(o=>({occurrenceId:o.id,moduleId:o.moduleId,version:o.moduleVersion})),
  ...(s.weekly?(operator(c)?{weeklyOperator:structuredClone(s.weekly)}:c.actor.role==="parent"&&c.enrollment?{weeklyUpdates:weeklyPublications(s.weekly,c.enrollment.id).filter(update=>{
   if(update.learnerId!==c.enrollment!.learnerId)return false;const facts=weeklyFacts(s,c.enrollment!,update.occurrenceId,now);return facts!==null&&weeklyPublicationCurrent(s.weekly!,update,facts);
  })}:{}):{})};
}
function revise(s:StageState,o:CanonicalOccurrence,c:FreshStageContext,now:Date,reason:string,changes:Partial<CanonicalOccurrence>){
 s.history.push(structuredClone(o));Object.assign(o,changes,{revision:o.revision+1,changedBy:c.actor.id,changedAt:now.toISOString(),changeReason:reason});
}
function occurrenceFor(s:StageState,command:Extract<StageCommand,{occurrenceId:string}>){
 const o=s.occurrences.find(o=>o.id===command.occurrenceId);if(!o)fail("NOT_FOUND");
 if(o.revision!==command.expectedOccurrenceRevision)fail("CONFLICT");return o;
}

/** Domain service only. No runtime factory, database target, routes, env, provider
 * or enrollment mutation. MAIN supplies an admitted atomic native adapter. */
export class FishingStageService implements FishingOccurrenceReadPort {
 constructor(private readonly store:FishingStageStore,private readonly clock:IdentityClock){}
 async read(actor:Actor,reference:unknown):Promise<StageView|null>{
  const ref=stageReferenceSchema.parse(reference);
  return this.store.transaction(async tx=>{
   let c:FreshStageContext;const now=this.clock.now();
   try{c=fresh(await tx.resolveFreshContext(actor,ref),actor,ref,now);}catch(e){if(e instanceof FishingStageError&&e.code==="FORBIDDEN")return null;throw e;}
   const s=await tx.load(c);if(!s)return null;validateStageState(s,c);return view(s,c,now);
  });
 }
 async readOccurrences(actor:Actor,stage:FishingStageRef):Promise<readonly OccurrenceProjection[]>{return (await this.read(actor,stage))?.occurrences??[];}
 async execute(actor:Actor,reference:unknown,input:unknown){
  const ref=stageReferenceSchema.parse(reference),command=stageCommandSchema.parse(input);
  return this.store.transaction(async tx=>{
   const now=this.clock.now(),c=fresh(await tx.resolveFreshContext(actor,ref),actor,ref,now);
   const familyAction=command.action==="notice"||command.action==="request_makeup";
   if(familyAction?c.actor.role!=="parent":!operator(c))fail("FORBIDDEN");
   const digest=createHash("sha256").update(JSON.stringify({ref,command,actorId:c.actor.id,workspaceId:c.actor.workspaceId,
    enrollmentId:familyAction?c.enrollment!.id:null})).digest("hex");
   const prior=await tx.readOperation(c,command.operationId);
   if(prior){if(prior.digest!==digest)fail("CONFLICT");return {...prior.receipt,replayed:true};}
   const loaded=await tx.load(c);
   if((loaded?.revision??0)!==command.expectedRevision)fail("CONFLICT");
   let s:StageState;
   if(command.action==="create"){
    if(loaded)fail("CONFLICT");
    const template=await tx.resolveApprovedTemplate(c,command.templateVersion);
    if(!templateValid(template,ref,command.templateVersion))fail("APPROVAL_REQUIRED");
    if(!Number.isSafeInteger(c.approvedChildCapacity)||command.childCapacity>c.approvedChildCapacity)fail("CAPACITY");
    s={...ref,workspaceId:c.actor.workspaceId,program:c.scope.program,revision:1,template:structuredClone(template),policyVersion:template.policyVersion,sourceVersion:template.sourceVersion,
     history:[],attendance:[],makeups:[],occurrences:template.modules.map((m,i)=>({id:randomUUID(),...ref,workspaceId:c.actor.workspaceId,program:c.scope.program,
      revision:1,templateVersion:template.version,ordinal:(i+1) as CanonicalOccurrence["ordinal"],moduleId:m.moduleId,moduleVersion:m.moduleVersion,
      state:"draft",optional:false,time:{kind:"undated",timeZone:floridaZone},location:"",directions:"",equipment:"",logisticalNote:"",instructor:{...c.instructor},
      childCapacity:command.childCapacity,replacesOccurrenceId:null,changedBy:c.actor.id,changedAt:now.toISOString(),changeReason:"Stage plan created; dates unconfirmed."}))};
   }else{
    if(!loaded)fail("NOT_FOUND");validateStageState(loaded,c);s=structuredClone(loaded);s.revision++;
    await this.change(tx,c,s,command,now);
   }
   validateStageState(s,c);
   // Even non-scheduling commands retain the atomic adapter transaction. Native
   // resource reconciliation runs only for changes that can affect a booking.
   if(["publish","revise","cancel"].includes(command.action))await tx.reconcileResources(c,loaded?.occurrences??[],s.occurrences);
   const receipt={operationId:command.operationId,stageRevision:s.revision,replayed:false};
   await tx.commit(c,s,command.expectedRevision,{digest,receipt});return receipt;
  });
 }
 private async change(tx:FishingStageTransaction,c:FreshStageContext,s:StageState,command:Exclude<StageCommand,{action:"create"}>,now:Date){
  if(isWeekly(command)){
   occurrenceFor(s,command);const e=await tx.readEnrollment(c,command.enrollmentId);if(!validEnrollment(e,c))fail("FORBIDDEN");
   const facts=weeklyFacts(s,e,command.occurrenceId,now);if(!facts)fail("INVALID_STATE");
   try{s.weekly=applyWeeklyCommand(s.weekly??{observations:[],recaps:[]},command,{...facts,actorId:c.actor.id,nextId:randomUUID});}
   catch(error){if(error instanceof WeeklyProgressError&&error.code!=="UNAVAILABLE")fail(error.code==="CONFLICT"?"CONFLICT":"INVALID_STATE");throw error;}
   return;
  }
  if(command.action==="publish"){
   if(!s.occurrences.some(o=>o.state==="draft")||s.occurrences.some(o=>o.state!=="draft"&&o.state!=="cancelled"))fail("INVALID_STATE");
   for(const o of s.occurrences){if(o.state==="draft"){await this.capacity(tx,c,o);revise(s,o,c,now,"Plan published.",{state:"published"});}}return;
  }
  if(command.action==="request_makeup"){
   const m=s.makeups.find(m=>m.notice.id===command.noticeId&&m.notice.enrollmentId===c.enrollment!.id);if(!m)fail("NOT_FOUND");
   if(m.requestedAt||m.notice.replacementReservationId)fail("CONFLICT");m.requestedAt=now.toISOString();return;
  }
  if(command.action==="confirm_makeup"){
   const m=s.makeups.find(m=>m.notice.id===command.noticeId);if(!m)fail("NOT_FOUND");
   if(m.notice.replacementReservationId||m.notice.replacementOccurrenceId)fail("CONFLICT");
   const e=await tx.readEnrollment(c,m.notice.enrollmentId);if(!validEnrollment(e,c))fail("FORBIDDEN");
   const target=await tx.resolveReplacement(c,e.id,command.replacementOccurrenceId);
   if(!target||!target.suitableForEnrollment)fail("APPROVAL_REQUIRED");const o=target.occurrence;
   if(o.id!==command.replacementOccurrenceId||o.id===m.notice.occurrenceId||o.workspaceId!==s.workspaceId||o.program!==s.program||o.optional!==false||o.state!=="published"||o.time.kind!=="scheduled"||Date.parse(o.time.startsAt)<=now.getTime()||!Number.isSafeInteger(o.childCapacity)||o.childCapacity<1)fail("INVALID_STATE");
   canonicalTime(o.time);
   if(o.revision!==command.expectedReplacementRevision)fail("CONFLICT");
   // This approval is deliberate even for best-effort/unavoidable notices. It
   // creates one entitlement, not a second credit or a financial transaction.
   const entitlement=m.notice.entitlementId??randomUUID();
   const reservation=await tx.reserveMakeup(c,{enrollmentId:e.id,entitlementId:entitlement,occurrenceId:o.id,expectedRevision:o.revision});
   if(!reservation)fail("CAPACITY");
   m.notice={...m.notice,entitlementId:entitlement,replacementOccurrenceId:o.id,replacementReservationId:reservation};
   m.decisionAt=now.toISOString();m.decisionBy=c.actor.id;m.decisionReason=command.reason;return;
  }
  const o=occurrenceFor(s,command);
  if(command.action==="revise"){
   if(o.state!=="draft"&&o.state!=="published")fail("INVALID_STATE");
   const details={...command.details,time:canonicalTime(command.details.time)};
   await this.capacity(tx,c,{...o,...details});revise(s,o,c,now,command.reason,details);return;
  }
  if(command.action==="cancel"){
   if(o.state!=="draft"&&o.state!=="published")fail("INVALID_STATE");
   revise(s,o,c,now,command.reason,{state:"cancelled"});return;
  }
  if(command.action==="complete"){
   if(o.state!=="published"||o.time.kind!=="scheduled"||Date.parse(o.time.startsAt)>now.getTime())fail("INVALID_STATE");
   revise(s,o,c,now,command.reason,{state:"completed"});return;
  }
  if(command.action==="attendance"){
   if(o.state!=="completed"||o.time.kind!=="scheduled")fail("INVALID_STATE");
   const e=await tx.readEnrollment(c,command.enrollmentId);if(!validEnrollment(e,c))fail("FORBIDDEN");
   // Append corrections. Do not mutate an earlier attendance fact or infer one
   // from an elapsed date, a payment, a quiz, an absence or operator cancellation.
   s.attendance.push({enrollmentId:e.id,occurrenceId:o.id,state:command.state,recordedAt:now.toISOString(),recordedBy:c.actor.id,reason:command.reason});return;
  }
  if(command.action==="notice"){
   if((o.state!=="published"&&o.state!=="cancelled")||o.time.kind!=="scheduled")fail("INVALID_STATE");
   const e=c.enrollment!;
   if(s.makeups.some(m=>m.notice.enrollmentId===e.id&&m.notice.occurrenceId===o.id))fail("CONFLICT");
   const state=o.state==="cancelled"?"operator_undelivered":noticeState(now.toISOString(),o.time.startsAt,command.reason);
   const record:MakeupRecord={notice:{id:randomUUID(),workspaceId:s.workspaceId,enrollmentId:e.id,occurrenceId:o.id,
    originalOccurrenceRevision:o.revision,originalStartsAt:o.time.startsAt,receivedAt:now.toISOString(),reason:o.state==="cancelled"?"operator_cancelled":command.reason,state,
    entitlementId:state==="protected"||state==="operator_undelivered"?randomUUID():null,replacementOccurrenceId:null,replacementReservationId:null,
    specificTripGuaranteed:false,policyVersion:s.policyVersion,sourceVersion:s.sourceVersion},requestedAt:null,decisionAt:null,decisionBy:null,decisionReason:null};
   s.makeups.push(record);
  }
 }
 private async capacity(tx:FishingStageTransaction,c:FreshStageContext,o:CanonicalOccurrence){
  if(!Number.isSafeInteger(c.approvedChildCapacity)||o.childCapacity>c.approvedChildCapacity)fail("CAPACITY");
  const occupied=await tx.occupiedSeats(c,o.id);if(!Number.isSafeInteger(occupied)||occupied<0||occupied>o.childCapacity)fail("CAPACITY");
 }
}
