import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {one,type SqlSession} from "../identity/store.ts";
import {academyPolicyPreflightVersion,type AcademyOriginalSessionAnchor} from "../fishing/academy-policy-preflight-contract.ts";
import {academySessionPolicyNativeVersion,academyCalendarCompatibilityVersion,type AcademySessionCreditRecord,type AcademySessionCreditResolvedFacts,
 type AcademySessionCreditNativeFacts,type AcademySessionCreditNativeFactsV2,
 type AcademySessionCreditCommandResult} from "../fishing/academy-session-policy-native-contract.ts";

const uuid=z.uuid(),text=z.string().min(1).max(120).refine(v=>v===v.trim()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const academyCreditAnchorSchema=z.strictObject({workspaceId:uuid,learnerId:uuid,cohortId:uuid,stageId:uuid,
 occurrenceId:uuid,ordinal:z.number().int().min(1).max(12),moduleId:text,moduleVersion:text,activityId:text});
export const academyCreditRecordSchema=z.strictObject({id:uuid,anchor:academyCreditAnchorSchema,enrollmentId:uuid,
 purchaseId:uuid,purchaseLineId:text,state:z.enum(["outstanding","replacement_reserved","delivered"]),replacementReservationId:uuid.nullable()})
 .refine(v=>v.state!=="replacement_reserved"||v.replacementReservationId!==null)
 .refine(v=>v.state!=="outstanding"||v.replacementReservationId===null);
export const academyCreditCommandSchema=z.strictObject({operationId:uuid,enrollmentId:uuid,originalOccurrenceId:uuid,
 expectedStageRevision:positive,sourceEvidenceId:text,expectedEvidenceRevision:positive});
export const academyCreditSelectionSchema=z.strictObject({selectedEnrollmentId:uuid});
const kinds=z.enum(["ordinary","keys","offshore","unclassified"]);
export const academyCreditFactsSchema=z.strictObject({
 anchor:academyCreditAnchorSchema,enrollmentId:uuid,purchaseId:uuid,purchaseLineId:text,householdId:uuid,
 guardianBindingId:text,acceptedTermsVersion:text,
 inquiry:z.strictObject({workspaceId:uuid,applicationId:uuid,fieldsDigest:hash,learnerIndex:z.number().int().min(0).max(9),drivePreferenceDigest:hash}),
 stageRevision:positive,sourceEvidenceId:text,evidenceRevision:positive,evidenceDigest:hash,
 duration:z.strictObject({version:z.literal(academyPolicyPreflightVersion),sessionKind:kinds,time:z.discriminatedUnion("kind",[
  z.strictObject({kind:z.literal("scheduled"),startsAt:z.string().max(80),endsAt:z.string().max(80),timeZone:text}),
  z.strictObject({kind:z.literal("undated"),timeZone:text})])}),
 travel:z.strictObject({version:z.literal(academyPolicyPreflightVersion),original:academyCreditAnchorSchema,sessionKind:kinds,
  obligation:z.strictObject({anchor:academyCreditAnchorSchema,evidenceId:text,state:z.enum(["purchased_undelivered","delivered","unpurchased","unknown"])}).nullable(),
  change:z.strictObject({anchor:academyCreditAnchorSchema,kind:z.enum(["academy_venue","academy_schedule","academy_weather_cancelled","parent_absence","other"]),
   evidenceId:text,weatherQualification:z.enum(["qualifying","not_qualifying","unknown"]),
   recordedDriveLimit:z.enum(["up_to_30","up_to_45","up_to_60","over_60"]),revisedOneWayMinutes:z.number().finite().nonnegative().nullable(),familyCannotAttend:z.boolean().nullable()})}),
 legacyCredit:academyCreditRecordSchema.nullable(),
});
/** Strict additive branch. No transforms/defaults/coercion: legacy parsed key
 * order and sealed evidence digests retain their original representation. */
export const academyCreditFactsV2Schema=academyCreditFactsSchema.extend({
 compatibility:z.strictObject({version:z.literal(academyCalendarCompatibilityVersion),
  originalStage:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)])}),
 travel:academyCreditFactsSchema.shape.travel.extend({
  change:academyCreditFactsSchema.shape.travel.shape.change.extend({
   recordedDriveLimit:z.union([academyCreditFactsSchema.shape.travel.shape.change.shape.recordedDriveLimit,
    z.number().int().min(5).max(120).multipleOf(5)]),
  }),
 }),
});
export const academyCreditResolvedFactsSchema=z.union([academyCreditFactsSchema,academyCreditFactsV2Schema]);
const reason=z.enum(["invalid_input","original_anchor_mismatch","obligation_missing","obligation_unknown","obligation_not_purchased","obligation_delivered",
 "credit_anchor_mismatch","credit_delivered","credit_unknown","change_evidence_missing","drive_limit_requires_facts","attendance_requires_facts",
 "weather_requires_review","separate_exception_terms","existing_absence_policy","no_qualifying_change","within_recorded_limit","family_can_attend",
 "academy_change_exceeds_limit","qualifying_weather_cancellation","same_outstanding_credit"]);
const resultSchema=z.strictObject({version:z.literal(academySessionPolicyNativeVersion),outcome:z.enum(["issued","retained","no_credit","facts_required"]),reason,
 credit:academyCreditRecordSchema.nullable(),replayed:z.literal(false),mayBook:z.literal(false),mayMarkDelivered:z.literal(false),specificDateOrSeatGuaranteed:z.literal(false)});
const receiptSchema=z.strictObject({requestDigest:hash,evidenceId:uuid,evidenceFactsDigest:hash,result:resultSchema});
const evidenceSchema=z.strictObject({facts:academyCreditResolvedFactsSchema});
type EvidenceRow={id:string;workspaceId:string;learnerId:string;occurrenceId:string;sourceId:string;revision:number;digest:string;ciphertext:string};
type EventRow={workspaceId:string;actorId:string;operationId:string;requestDigest:string;evidenceId:string;creditId:string|null;outcome:string;ciphertext:string};
type CreditRow={id:string;workspaceId:string;learnerId:string;cohortId:string;stageId:string;occurrenceId:string;ordinal:number;moduleId:string;moduleVersion:string;
 activityId:string;enrollmentId:string;purchaseId:string;purchaseLineId:string;state:string;replacementReservationId:string|null;firstEvidenceId:string};
const creditColumns=`id,workspace_id AS "workspaceId",learner_id AS "learnerId",cohort_id AS "cohortId",stage_id AS "stageId",original_occurrence_id AS "occurrenceId",
 original_ordinal AS ordinal,module_id AS "moduleId",module_version AS "moduleVersion",activity_id AS "activityId",enrollment_id AS "enrollmentId",
 purchase_id AS "purchaseId",purchase_line_id AS "purchaseLineId",state,replacement_reservation_id AS "replacementReservationId",first_evidence_id AS "firstEvidenceId"`;
const evidenceColumns=`id,workspace_id AS "workspaceId",learner_id AS "learnerId",original_occurrence_id AS "occurrenceId",source_evidence_id AS "sourceId",
 source_revision AS revision,evidence_sha256 AS digest,payload_ciphertext AS ciphertext`;
const eventColumns=`workspace_id AS "workspaceId",actor_account_id AS "actorId",operation_id AS "operationId",request_sha256 AS "requestDigest",
 evidence_id AS "evidenceId",credit_id AS "creditId",outcome,receipt_ciphertext AS ciphertext`;
export function academyCreditDigest(value:unknown):string{return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function sameAcademyAnchor(a:AcademyOriginalSessionAnchor,b:AcademyOriginalSessionAnchor):boolean{
 return a.workspaceId===b.workspaceId&&a.learnerId===b.learnerId&&a.cohortId===b.cohortId&&a.stageId===b.stageId&&a.occurrenceId===b.occurrenceId&&
  a.ordinal===b.ordinal&&a.moduleId===b.moduleId&&a.moduleVersion===b.moduleVersion&&a.activityId===b.activityId;
}
export function sameAcademyCredit(a:AcademySessionCreditRecord,b:AcademySessionCreditRecord):boolean{
 return sameAcademyAnchor(a.anchor,b.anchor)&&a.id===b.id&&a.enrollmentId===b.enrollmentId&&a.purchaseId===b.purchaseId&&a.purchaseLineId===b.purchaseLineId&&
  a.state===b.state&&a.replacementReservationId===b.replacementReservationId;
}
/** Legacy reservation state is current authority, not part of immutable source evidence. */
export function academyEvidenceFacts(facts:AcademySessionCreditNativeFacts):AcademySessionCreditNativeFacts;
export function academyEvidenceFacts(facts:AcademySessionCreditNativeFactsV2):AcademySessionCreditNativeFactsV2;
export function academyEvidenceFacts(facts:AcademySessionCreditResolvedFacts):AcademySessionCreditResolvedFacts;
export function academyEvidenceFacts(facts:AcademySessionCreditResolvedFacts):AcademySessionCreditResolvedFacts{return {...facts,legacyCredit:null};}
function unavailable():never{throw new AppError("UNAVAILABLE");}
function parsed<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);return r.success?r.data:unavailable();}
const evidenceAad=(workspace:string,id:string)=>`ls_fishing_stage/academy_evidence/v1/${workspace}/${id}`;
const eventAad=(workspace:string,actor:string,operation:string)=>`ls_fishing_stage/academy_credit_event/v1/${workspace}/${actor}/${operation}`;
function encode(value:unknown,aad:string,ring:Keyring):string{
 const plain=JSON.stringify(value);if(Buffer.byteLength(plain)>45000)unavailable();
 const encrypted=seal(plain,aad,ring);if(Buffer.byteLength(encrypted)>65536)unavailable();return encrypted;
}
function decode(value:string,aad:string,ring:Keyring):unknown{
 if(typeof value!=="string"||Buffer.byteLength(value)>65536)unavailable();
 try{return JSON.parse(unseal(value,aad,ring));}catch{return unavailable();}
}

/** Only the service's already authorized, workspace-locked SqlSession is accepted.
 * This store owns no connection, transaction, clock, authority or fallback.
 * All three candidate tables are append-only in this slice; no seat writes. */
export class AcademySessionCreditStore{
 constructor(private readonly tx:SqlSession,private readonly ring:Keyring){}
 private evidence(row:EvidenceRow):AcademySessionCreditResolvedFacts{
  const facts=parsed(evidenceSchema,decode(row.ciphertext,evidenceAad(row.workspaceId,row.id),this.ring)).facts;
  if(facts.legacyCredit!==null||facts.anchor.workspaceId!==row.workspaceId||facts.anchor.learnerId!==row.learnerId||facts.anchor.occurrenceId!==row.occurrenceId||
   facts.sourceEvidenceId!==row.sourceId||facts.evidenceRevision!==row.revision||facts.evidenceDigest!==row.digest)unavailable();return facts;
 }
 private event(row:EventRow){
  const receipt=parsed(receiptSchema,decode(row.ciphertext,eventAad(row.workspaceId,row.actorId,row.operationId),this.ring));
  if(receipt.requestDigest!==row.requestDigest||receipt.evidenceId!==row.evidenceId||receipt.result.outcome!==row.outcome||
   (receipt.result.credit?.id??null)!==row.creditId||receipt.result.credit&&receipt.result.credit.anchor.workspaceId!==row.workspaceId)unavailable();
  return receipt;
 }
 private async evidenceById(workspace:string,id:string){
  const row=await one<EvidenceRow>(this.tx,`SELECT ${evidenceColumns} FROM ls_fishing_stage.academy_session_policy_evidence WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[workspace,id]);
  return row?this.evidence(row):unavailable();
 }
 private async credit(row:CreditRow):Promise<AcademySessionCreditRecord>{
  const record=parsed(academyCreditRecordSchema,{id:row.id,anchor:{workspaceId:row.workspaceId,learnerId:row.learnerId,cohortId:row.cohortId,stageId:row.stageId,
   occurrenceId:row.occurrenceId,ordinal:row.ordinal,moduleId:row.moduleId,moduleVersion:row.moduleVersion,activityId:row.activityId},
   enrollmentId:row.enrollmentId,purchaseId:row.purchaseId,purchaseLineId:row.purchaseLineId,state:row.state,replacementReservationId:row.replacementReservationId});
  const facts=await this.evidenceById(row.workspaceId,row.firstEvidenceId);
  if(!sameAcademyAnchor(facts.anchor,record.anchor)||facts.enrollmentId!==record.enrollmentId||facts.purchaseId!==record.purchaseId||facts.purchaseLineId!==record.purchaseLineId)unavailable();
  // Plaintext state/reservation headers cannot silently override a sealed receipt.
  const event=await one<EventRow>(this.tx,`SELECT ${eventColumns} FROM ls_fishing_stage.academy_session_credit_events
   WHERE workspace_id=$1 AND credit_id=$2 ORDER BY recorded_at DESC,operation_id DESC LIMIT 1 FOR SHARE`,[row.workspaceId,row.id]);
  if(!event)unavailable();const proof=this.event(event).result.credit;
  if(!proof||!sameAcademyCredit(proof,record))unavailable();return record;
 }
 async byOriginal(anchor:AcademyOriginalSessionAnchor):Promise<AcademySessionCreditRecord|null>{
  const row=await one<CreditRow>(this.tx,`SELECT ${creditColumns} FROM ls_fishing_stage.academy_session_credits
   WHERE workspace_id=$1 AND learner_id=$2 AND original_occurrence_id=$3 FOR UPDATE`,[anchor.workspaceId,anchor.learnerId,anchor.occurrenceId]);
  return row?this.credit(row):null;
 }
 async byId(workspace:string,id:string):Promise<AcademySessionCreditRecord|null>{
  const row=await one<CreditRow>(this.tx,`SELECT ${creditColumns} FROM ls_fishing_stage.academy_session_credits WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[workspace,id]);
  return row?this.credit(row):null;
 }
 async selected(workspace:string,enrollment:string,learner:string):Promise<readonly AcademySessionCreditRecord[]>{
  const rows=await this.tx.query<CreditRow>(`SELECT ${creditColumns} FROM ls_fishing_stage.academy_session_credits
   WHERE workspace_id=$1 AND enrollment_id=$2 AND learner_id=$3 ORDER BY stage_id,original_ordinal,id LIMIT 1001 FOR SHARE`,[workspace,enrollment,learner]);
  if(rows.length>1000)unavailable();const records=[];
  for(const row of rows)records.push(await this.credit(row));return records;
 }
 async replay(workspace:string,actor:string,operation:string,requestDigest:string,facts:AcademySessionCreditResolvedFacts):Promise<AcademySessionCreditCommandResult|null>{
  const row=await one<EventRow>(this.tx,`SELECT ${eventColumns} FROM ls_fishing_stage.academy_session_credit_events
   WHERE workspace_id=$1 AND actor_account_id=$2 AND operation_id=$3 FOR SHARE`,[workspace,actor,operation]);
  if(!row)return null;if(row.requestDigest!==requestDigest)throw new AppError("CONFLICT");
  const receipt=this.event(row),evidence=await this.evidenceById(workspace,receipt.evidenceId);
  const expected=academyCreditDigest(academyEvidenceFacts(facts));
  if(receipt.evidenceFactsDigest!==expected||academyCreditDigest(evidence)!==expected)throw new AppError("CONFLICT");
  return {...receipt.result,replayed:true};
 }
 async recordEvidence(facts:AcademySessionCreditResolvedFacts,now:Date):Promise<string>{
  const a=facts.anchor,body=academyEvidenceFacts(facts);
  const old=await one<EvidenceRow>(this.tx,`SELECT ${evidenceColumns} FROM ls_fishing_stage.academy_session_policy_evidence
   WHERE workspace_id=$1 AND learner_id=$2 AND original_occurrence_id=$3 AND source_evidence_id=$4 AND source_revision=$5 FOR SHARE`,
  [a.workspaceId,a.learnerId,a.occurrenceId,facts.sourceEvidenceId,facts.evidenceRevision]);
  if(old){if(academyCreditDigest(this.evidence(old))!==academyCreditDigest(body))throw new AppError("CONFLICT");return old.id;}
  const id=randomUUID();await this.tx.query(`INSERT INTO ls_fishing_stage.academy_session_policy_evidence
   (workspace_id,id,learner_id,original_occurrence_id,source_evidence_id,source_revision,evidence_sha256,payload_ciphertext,recorded_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[a.workspaceId,id,a.learnerId,a.occurrenceId,facts.sourceEvidenceId,facts.evidenceRevision,facts.evidenceDigest,
   encode({facts:body},evidenceAad(a.workspaceId,id),this.ring),now]);return id;
 }
 async insert(record:AcademySessionCreditRecord,evidenceId:string,now:Date):Promise<void>{
  const c=parsed(academyCreditRecordSchema,record),a=c.anchor;
  await this.tx.query(`INSERT INTO ls_fishing_stage.academy_session_credits
   (workspace_id,id,learner_id,cohort_id,stage_id,original_occurrence_id,original_ordinal,module_id,module_version,activity_id,
    enrollment_id,purchase_id,purchase_line_id,state,replacement_reservation_id,first_evidence_id,created_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
  [a.workspaceId,c.id,a.learnerId,a.cohortId,a.stageId,a.occurrenceId,a.ordinal,a.moduleId,a.moduleVersion,a.activityId,c.enrollmentId,c.purchaseId,c.purchaseLineId,c.state,c.replacementReservationId,evidenceId,now]);
 }
 async recordEvent(workspace:string,actor:string,operation:string,requestDigest:string,evidenceId:string,facts:AcademySessionCreditResolvedFacts,result:AcademySessionCreditCommandResult,now:Date):Promise<void>{
  const body=parsed(receiptSchema,{requestDigest,evidenceId,evidenceFactsDigest:academyCreditDigest(academyEvidenceFacts(facts)),result});
  await this.tx.query(`INSERT INTO ls_fishing_stage.academy_session_credit_events
   (workspace_id,actor_account_id,operation_id,request_sha256,evidence_id,credit_id,outcome,receipt_ciphertext,recorded_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[workspace,actor,operation,requestDigest,evidenceId,result.credit?.id??null,result.outcome,
   encode(body,eventAad(workspace,actor,operation),this.ring),now]);
 }
}
