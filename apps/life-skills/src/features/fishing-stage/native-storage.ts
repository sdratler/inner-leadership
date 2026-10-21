import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {AppError} from "../../lib/errors.ts";
import {asId} from "../../lib/ids.ts";
import {logisticsSchema,stageReferenceSchema,type StageState,type ApprovedStageTemplate,type EnrollmentProjection} from "./contract.ts";
import {safetyStateSchema} from './safety.ts';
import {weeklyStateSchema} from "./weekly-progress.ts";

export const nativeLimits=Object.freeze({revisions:1000,snapshotBytes:1048576,envelopeBytes:2000000,partBytes:16384,parts:64,attendance:12000,notices:12000,history:12000});
const uuid=z.uuid(),version=z.string().trim().min(1).max(120),hash=z.string().regex(/^[a-f0-9]{64}$/);
const workspaceId=uuid.transform(value=>asId(value,"workspace")),accountId=uuid.transform(value=>asId(value,"account")),personId=uuid.transform(value=>asId(value,"person"));
const instant=z.iso.datetime({offset:true}),positive=z.number().int().positive();
const source={policyVersion:version,sourceVersion:version};
const scope=stageReferenceSchema.extend({workspaceId,program:z.literal("sunday_fishing_academy")});
export const templateSchema=z.strictObject({...source,version,stage:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),status:z.literal("approved"),sourceSha256:hash,
 modules:z.array(z.strictObject({moduleId:z.string().regex(/^RM-[1-4](?:0[1-9]|1[0-2])$/),moduleVersion:version,learnerContent:z.enum(["approved","unavailable"])})).length(12)});
export const enrollmentSchema=stageReferenceSchema.extend({workspaceId,program:z.literal("sunday_fishing_academy"),id:uuid,revision:positive,purchaseId:uuid,purchaseLineId:uuid,learnerId:personId,householdId:uuid,
 state:z.enum(["pending_review","confirmed","suspended","revoked"]),purchaseScope:z.strictObject({kind:z.literal('monthly_block'),blockId:uuid,acceptanceId:uuid,occurrenceIds:z.array(uuid).length(4).refine(ids=>new Set(ids).size===4)}).optional(),evidence:z.strictObject({verifiedGuardianBindingId:version,capacityReservationId:version,fitDecisionId:version,acceptedTermsVersion:version,ownerActionId:version}),authorizedAccountIds:z.array(accountId).max(100)});
export const authoritySchema=z.strictObject({scope,instructor:z.strictObject({accountId,displayName:z.string().trim().min(1).max(200)}),operatorAccountIds:z.array(accountId).max(100),approvedChildCapacity:z.number().int().min(1).max(1000),enrollment:enrollmentSchema.nullable(),guardianRelationshipCurrent:z.boolean(),childAccountEnabled:z.boolean()});
const ordinal=z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5),z.literal(6),z.literal(7),z.literal(8),z.literal(9),z.literal(10),z.literal(11),z.literal(12)]);
const occurrence=scope.extend({...logisticsSchema.shape,id:uuid,revision:positive.max(nativeLimits.revisions),templateVersion:version,ordinal,moduleId:z.string().regex(/^RM-[1-4](?:0[1-9]|1[0-2])$/),moduleVersion:version,
 state:z.enum(["draft","published","completed","cancelled"]),optional:z.literal(false),instructor:z.strictObject({accountId,displayName:z.string().trim().min(1).max(200)}),replacesOccurrenceId:uuid.nullable(),changedBy:accountId,changedAt:instant,changeReason:z.string().trim().min(1).max(1200)});
const notice=z.strictObject({...source,id:uuid,workspaceId,enrollmentId:uuid,occurrenceId:uuid,originalOccurrenceRevision:positive,originalStartsAt:instant,receivedAt:instant,
 reason:z.enum(["ordinary_absence","unavoidable","operator_cancelled"]),state:z.enum(["protected","best_effort","operator_review","operator_undelivered"]),entitlementId:uuid.nullable(),replacementOccurrenceId:uuid.nullable(),replacementReservationId:uuid.nullable(),specificTripGuaranteed:z.literal(false)});
const makeup=z.strictObject({notice,requestedAt:instant.nullable(),decisionAt:instant.nullable(),decisionBy:uuid.nullable(),decisionReason:z.string().trim().min(1).max(1200).nullable()});
const stateSchema=scope.extend({...source,revision:positive.max(nativeLimits.revisions),template:templateSchema,occurrences:z.array(occurrence).length(12),history:z.array(occurrence).max(nativeLimits.history),
 attendance:z.array(z.strictObject({enrollmentId:uuid,occurrenceId:uuid,state:z.enum(["present","late","absent","no_show"]),recordedAt:instant,recordedBy:uuid,reason:z.string().trim().min(1).max(1200)})).max(nativeLimits.attendance),makeups:z.array(makeup).max(nativeLimits.notices),weekly:weeklyStateSchema.optional(),safety:safetyStateSchema.optional()});
export const linkSchema=z.strictObject({workspaceId:uuid,sourceStageId:uuid,entitlementId:uuid,enrollmentId:uuid,learnerId:uuid,occurrenceId:uuid,reservationId:uuid});
export type NativeMakeupLink=z.infer<typeof linkSchema>;
const snapshotSchema=z.strictObject({state:stateSchema,links:z.array(linkSchema).max(nativeLimits.notices)});
export type NativeSnapshot={state:StageState;links:NativeMakeupLink[]};
export const planHeaderSchema=stageReferenceSchema.extend({workspaceId:uuid,templateVersion:version,revision:positive.max(nativeLimits.revisions),stateHash:hash});
export type PlanHeader=z.infer<typeof planHeaderSchema>;
export const revisionHeaderSchema=z.strictObject({workspaceId:uuid,stageId:uuid,revision:positive.max(nativeLimits.revisions),actorId:uuid,operationId:uuid,recordedAt:instant,previousHash:hash.nullable(),stateHash:hash});
export type RevisionHeader=z.infer<typeof revisionHeaderSchema>;
export const operationHeaderSchema=z.strictObject({workspaceId:uuid,actorId:uuid,operationId:uuid,stageId:uuid,stageRevision:positive.max(nativeLimits.revisions),digest:hash,stateHash:hash});
export type OperationHeader=z.infer<typeof operationHeaderSchema>;
export const operationSchema=z.strictObject({digest:hash,receipt:z.strictObject({operationId:uuid,stageRevision:positive.max(nativeLimits.revisions),replayed:z.literal(false)})});
export function unavailable():never{throw new AppError("UNAVAILABLE");}
export const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function parseTemplate(value:unknown):ApprovedStageTemplate{return templateSchema.parse(value);}
export function parseEnrollment(value:unknown):EnrollmentProjection{return enrollmentSchema.parse(value);}
export function parseSnapshot(value:unknown):NativeSnapshot{
 const parsed:NativeSnapshot=snapshotSchema.parse(value),s=parsed.state;
 if(s.policyVersion!==s.template.policyVersion||s.sourceVersion!==s.template.sourceVersion||s.stage!==s.template.stage)unavailable();
 const ids=new Set(s.occurrences.map(o=>o.id));
 if(ids.size!==12||s.history.some(o=>!ids.has(o.id))||new Set(s.makeups.map(m=>m.notice.id)).size!==s.makeups.length)unavailable();
 for(const o of [...s.occurrences,...s.history]){
  const current=s.occurrences[o.ordinal-1],lesson=s.template.modules[o.ordinal-1];
  if(!current||!lesson||o.id!==current.id||o.workspaceId!==s.workspaceId||o.cohortId!==s.cohortId||o.stageId!==s.stageId||o.stage!==s.stage||o.templateVersion!==s.template.version||o.moduleId!==lesson.moduleId||o.moduleVersion!==lesson.moduleVersion)unavailable();
 }
 for(const m of s.makeups){
  const n=m.notice,original=[...s.history,...s.occurrences].find(o=>o.id===n.occurrenceId&&o.revision===n.originalOccurrenceRevision);
  if(n.workspaceId!==s.workspaceId||n.policyVersion!==s.policyVersion||n.sourceVersion!==s.sourceVersion||!original||original.time.kind!=="scheduled"||original.time.startsAt!==n.originalStartsAt||
   Boolean(n.replacementOccurrenceId)!==Boolean(n.replacementReservationId)||n.replacementReservationId&&!n.entitlementId)unavailable();
 }
 for(const fact of s.attendance)if(!s.occurrences.some(o=>o.id===fact.occurrenceId&&o.state==="completed"))unavailable();
 if(s.weekly)for(const item of [...s.weekly.observations,...s.weekly.recaps]){
  const current=s.occurrences.find(o=>o.id===item.occurrenceId);
  if(!current||current.state!=="completed"||current.moduleId!==item.moduleId||current.moduleVersion!==item.moduleVersion)unavailable();
 }
 const reserved=s.makeups.filter(m=>m.notice.replacementReservationId);
 if(reserved.length!==parsed.links.length||new Set(parsed.links.map(l=>l.entitlementId)).size!==parsed.links.length||new Set(parsed.links.map(l=>`${l.learnerId}:${l.occurrenceId}`)).size!==parsed.links.length)unavailable();
 for(const link of parsed.links){const n=reserved.find(m=>m.notice.entitlementId===link.entitlementId)?.notice;
  if(!n||link.workspaceId!==s.workspaceId||link.sourceStageId!==s.stageId||n.enrollmentId!==link.enrollmentId||n.replacementOccurrenceId!==link.occurrenceId||n.replacementReservationId!==link.reservationId)unavailable();}
 return parsed;
}

/** A bounded record envelope, not a second crypto primitive. Each part uses the
 * unchanged identity AEAD limit. AAD authenticates all physical headers, kind,
 * part index AND total count, preventing truncation/reordering/substitution. */
export function encodeNative(kind:"plan"|"revision"|"operation",header:unknown,value:unknown,ring:Keyring):string{
 const bytes=Buffer.from(JSON.stringify(value)),limit=kind==="operation"?8192:nativeLimits.snapshotBytes;
 if(!bytes.length||bytes.length>limit)unavailable();
 const count=Math.ceil(bytes.length/nativeLimits.partBytes),parts:string[]=[];
 for(let index=0;index<count;index++)parts.push(seal(bytes.subarray(index*nativeLimits.partBytes,(index+1)*nativeLimits.partBytes).toString("base64"),aad(kind,header,index,count),ring));
 const encoded=JSON.stringify({version:1,parts});if(Buffer.byteLength(encoded)>nativeLimits.envelopeBytes)unavailable();return encoded;
}
function aad(kind:string,header:unknown,index:number,count:number){return `fishing-stage-v1:${kind}:${digest(header)}:${index}:${count}`;}
export function decodeNative(kind:"plan"|"revision"|"operation",header:unknown,ciphertext:string,ring:Keyring):unknown{
 try{
  if(typeof ciphertext!=="string"||Buffer.byteLength(ciphertext)>nativeLimits.envelopeBytes)unavailable();
  const envelope=z.strictObject({version:z.literal(1),parts:z.array(z.string().max(100000)).min(1).max(nativeLimits.parts)}).parse(JSON.parse(ciphertext));
  const parts=envelope.parts.map((part,index)=>{
   const text=unseal(part,aad(kind,header,index,envelope.parts.length),ring),bytes=Buffer.from(text,"base64");
   if(!bytes.length||bytes.length>nativeLimits.partBytes||bytes.toString("base64")!==text||index<envelope.parts.length-1&&bytes.length!==nativeLimits.partBytes)unavailable();return bytes;
  });
  const bytes=Buffer.concat(parts),limit=kind==="operation"?8192:nativeLimits.snapshotBytes;
  if(bytes.length>limit)unavailable();const text=bytes.toString("utf8");if(!Buffer.from(text).equals(bytes))unavailable();return JSON.parse(text);
 }catch{unavailable();}
}
export function assertPlanBinding(header:PlanHeader,snapshot:NativeSnapshot):void{
 const s=snapshot.state;
 if(s.workspaceId!==header.workspaceId||s.stageId!==header.stageId||s.cohortId!==header.cohortId||s.stage!==header.stage||s.template.version!==header.templateVersion||s.revision!==header.revision||digest(snapshot)!==header.stateHash)unavailable();
}
