import {asId} from "../../../src/lib/ids.ts";
import type {Actor,ApprovedStageTemplate,CanonicalOccurrence,EnrollmentProjection,FishingStageStore,FishingStageTransaction,FreshStageContext,OperationRecord,StageState} from "../../../src/features/fishing-stage/contract.ts";
export const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const ref={cohortId:id(10),stageId:id(11),stage:1 as const};
export function actor(role:Actor["role"]="practitioner"):Actor{return {id:asId(id(role==="practitioner"?1:role==="parent"?2:4),"account"),workspaceId:asId(id(9),"workspace"),personId:asId(id(role==="child"?3:20),"person"),
 role,state:"active",locale:"en",sessionDigest:"synthetic-session-"+role,expiresAt:Date.parse("2030-01-01T00:00:00Z")};}
export function enrollment():EnrollmentProjection{return {...ref,id:id(30),revision:1,workspaceId:asId(id(9),"workspace"),program:"sunday_fishing_academy",purchaseId:id(40),purchaseLineId:id(41),learnerId:asId(id(3),"person"),householdId:id(42),state:"confirmed",
 evidence:{verifiedGuardianBindingId:id(50),capacityReservationId:id(51),fitDecisionId:id(52),acceptedTermsVersion:"synthetic-v1",ownerActionId:id(53)},authorizedAccountIds:[actor("parent").id,actor("child").id]};}
export function template(stage:1|2|3|4=1):ApprovedStageTemplate{return {stage,version:"synthetic-stage-v1",status:"approved",sourceSha256:"a".repeat(64),policyVersion:"RM-FAMILIES-ABSENCE-PRESTART-20261015-09",sourceVersion:"RM-FULL-IMPLEMENTATION-20261015-11",
 modules:Array.from({length:12},(_,i)=>({moduleId:`RM-${stage}${String(i+1).padStart(2,"0")}`,moduleVersion:"synthetic-module-v1",learnerContent:i===0?"approved":"unavailable"}))};}
/** Atomic IN-MEMORY port fixture. Not native SQL, login, calendar or enrollment evidence. */
export class Fixture implements FishingStageStore {
 now=new Date("2026-03-07T15:00:00Z");state:StageState|null=null;template=template();enrollment=enrollment();
 revoked=false;guardianCurrent=true;childEnabled=true;approvedCapacity=4;failCommit=false;failResources=false;
 operations=new Map<string,OperationRecord>();occupied=new Map<string,number>();reservations=new Map<string,string>();resourceRows=new Map<string,CanonicalOccurrence>();
 target:CanonicalOccurrence|null=null;targetSuitable=true;targetOccupied=0;targetRevisionDrift=false;contextMutator:((c:FreshStageContext)=>void)|null=null;
 reads=0;private tail:Promise<void>=Promise.resolve();
 async transaction<T>(work:(tx:FishingStageTransaction)=>Promise<T>):Promise<T>{
  const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>{release=resolve;});await previous;
  const snapshot=structuredClone({state:this.state,operations:this.operations,reservations:this.reservations,resourceRows:this.resourceRows,targetOccupied:this.targetOccupied});
  try{return await work({
   resolveFreshContext:async(a,r)=>{this.reads++;const c:FreshStageContext={actor:structuredClone(a),sessionRevoked:this.revoked,scope:{...r,workspaceId:id(9),program:"sunday_fishing_academy"},instructor:{accountId:actor().id,displayName:"Synthetic instructor"},operatorAccountIds:[actor().id],approvedChildCapacity:this.approvedCapacity,enrollment:structuredClone(this.enrollment),guardianRelationshipCurrent:this.guardianCurrent,childAccountEnabled:this.childEnabled};this.contextMutator?.(c);return c;},
   resolveApprovedTemplate:async()=>structuredClone(this.template),load:async()=>structuredClone(this.state),
   readOperation:async(c,op)=>structuredClone(this.operations.get(c.actor.id+":"+op)??null),
   readEnrollment:async(_c,enrollmentId)=>enrollmentId===this.enrollment.id?structuredClone(this.enrollment):null,
   occupiedSeats:async(_c,occurrenceId)=>this.occupied.get(occurrenceId)??0,
   reconcileResources:async(_c,_before,after)=>{if(this.failResources)throw Error("SYNTHETIC_RESOURCE_CONFLICT");for(const o of after){if(o.state==="published"&&o.time.kind==="scheduled")this.resourceRows.set(o.id,structuredClone(o));else this.resourceRows.delete(o.id);}},
   resolveReplacement:async()=>this.target?{occurrence:structuredClone(this.target),suitableForEnrollment:this.targetSuitable}:null,
   reserveMakeup:async(_c,value)=>{if(!this.target||this.targetRevisionDrift||this.target.revision!==value.expectedRevision)throw Error("SYNTHETIC_TARGET_CONFLICT");if(this.targetOccupied>=this.target.childCapacity)throw Error("SYNTHETIC_CAPACITY");if(this.reservations.has(value.entitlementId))throw Error("SYNTHETIC_DUPLICATE_ENTITLEMENT");this.targetOccupied++;const reservation=id(700+this.reservations.size);this.reservations.set(value.entitlementId,reservation);return reservation;},
   commit:async(c,state,expected,operation)=>{if(this.failCommit)throw Error("SYNTHETIC_STORAGE_FAILURE");if((this.state?.revision??0)!==expected)throw Error("SYNTHETIC_CAS_CONFLICT");const key=c.actor.id+":"+operation.receipt.operationId;if(this.operations.has(key))throw Error("SYNTHETIC_OPERATION_CONFLICT");this.state=structuredClone(state);this.operations.set(key,structuredClone(operation));}
  });}catch(error){Object.assign(this,snapshot);throw error;}finally{release();}
 }
 reopen(){const next=new Fixture();Object.assign(next,structuredClone({now:this.now,state:this.state,operations:this.operations,enrollment:this.enrollment,occupied:this.occupied,reservations:this.reservations,resourceRows:this.resourceRows}));return next;}
}
