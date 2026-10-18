import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {lockWorkspace} from "../identity/data.ts";
import {one,type IdentityStore} from "../identity/store.ts";
import type {Actor} from "../identity/types.ts";
import type {PublicGroupApplicationStore} from "../group-application/store.ts";
import {floridaParentApplicationFieldsSchema} from "../group-application/contract.ts";
import type {NativeFishingProgram} from "./native-program.ts";
import {FishingProgramError} from "./native-program-contract.ts";

export const academyInquiryLearnerLinkVersion="JLFA-INQUIRY-LEARNER-LINK-20261018-01-v1" as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.uuid();
const commandSchema=z.strictObject({operationId:uuid,applicationId:uuid,learnerIndex:z.number().int().min(0).max(9),
 selectedEnrollmentId:uuid,expectedEnrollmentRevision:z.number().int().positive(),expectedInquiryFieldsDigest:hash});
const receiptSchema=z.strictObject({id:uuid,commandDigest:hash,bindingDigest:hash});
export const academyInquiryFieldsDigest=(fields:unknown)=>createHash("sha256").update(JSON.stringify(fields)).digest("hex");
const conflict=():never=>{throw new AppError("CONFLICT");};
function unavailable():never{throw new AppError("UNAVAILABLE");}

/** Actual native writer, intentionally UNMOUNTED. Explicit operator selection
 * correlates one reviewed inquiry learner to an EXISTING confirmed child/family.
 * No email/name match, People creation, guardian grant, checkout or credit.
 * Required native readers have no permissive/synthetic production defaults. */
export class AcademyInquiryLearnerLinkStore{
 constructor(private readonly database:IdentityStore,private readonly program:NativeFishingProgram,private readonly inquiries:PublicGroupApplicationStore){}
 async link(actor:Actor,raw:unknown){
  const parsed=commandSchema.safeParse(raw);if(!parsed.success)throw new AppError("INVALID_REQUEST");const command=parsed.data;
  try{return await this.database.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);
   // Both actual readers use this SAME transaction and reload the real session.
   // Native program also rechecks current operator, source approvals, fit/terms,
   // purchase-line binding and the current payer's verified guardian relation.
   const native=await this.program.readEnrollmentForInquiryLinkInTransaction(tx,actor,command.selectedEnrollmentId),e=native.enrollment;
   if(native.operatorAccountId!==actor.id||e.workspaceId!==actor.workspaceId||e.id!==command.selectedEnrollmentId||e.program!=="sunday_fishing_academy"||e.state!=="confirmed")throw new AppError("FORBIDDEN");
   if(e.revision!==command.expectedEnrollmentRevision)conflict();
   const nativeDigest=academyInquiryFieldsDigest(native);
   const reauthorize=async()=>{
    const current=await this.program.readEnrollmentForInquiryLinkInTransaction(tx,actor,command.selectedEnrollmentId);
    if(academyInquiryFieldsDigest(current)!==nativeDigest)conflict();
   };
   const record=await this.inquiries.readForOwnerInTransaction(tx,actor,command.applicationId);
   const fields=floridaParentApplicationFieldsSchema.safeParse(record.fields);
   if(!fields.success||fields.data.programId!=="sunday_fishing_academy"||!fields.data.academyIntake||!fields.data.academyFit)throw new AppError("INVALID_REQUEST");
   if(command.learnerIndex>=fields.data.academyIntake.learners.length)throw new AppError("INVALID_REQUEST");
   const inquiryFieldsDigest=academyInquiryFieldsDigest(fields.data);if(inquiryFieldsDigest!==command.expectedInquiryFieldsDigest)conflict();
   const source=await one<{requestDigest:string}>(tx,"SELECT request_digest AS \"requestDigest\" FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2 FOR SHARE",[actor.workspaceId,command.applicationId]);
   if(!source||!hash.safeParse(source.requestDigest).success||record.id!==command.applicationId)unavailable();
   const binding={version:academyInquiryLearnerLinkVersion,workspaceId:actor.workspaceId,applicationId:command.applicationId,learnerIndex:command.learnerIndex,
    learnerId:e.learnerId,householdId:e.householdId,payerAccountId:native.payerAccountId,initialEnrollmentId:e.id,initialEnrollmentRevision:e.revision,
    purchaseId:e.purchaseId,purchaseLineId:e.purchaseLineId,offerId:native.offerId,intakeVersion:fields.data.academyIntake.version,termsVersion:e.evidence.acceptedTermsVersion,
    inquiryRequestDigest:source.requestDigest,inquiryFieldsDigest,guardianDigest:native.guardianDigest};
   const bindingDigest=academyInquiryFieldsDigest(binding),commandDigest=academyInquiryFieldsDigest(command);
   // Reauthorization and all current binding reads precede cached command lookup.
   const prior=await one(tx,`SELECT id,command_digest AS "commandDigest",binding_digest AS "bindingDigest" FROM ls_fishing_stage.academy_inquiry_learner_links WHERE workspace_id=$1 AND actor_account_id=$2 AND operation_id=$3 FOR SHARE`,[actor.workspaceId,actor.id,command.operationId]);
   if(prior){const value=receiptSchema.safeParse(prior);if(!value.success)unavailable();if(value.data.commandDigest!==commandDigest||value.data.bindingDigest!==bindingDigest)conflict();await reauthorize();return {version:academyInquiryLearnerLinkVersion,saved:true as const,linkId:value.data.id,replayed:true};}
   const duplicate=await tx.query(`SELECT id FROM ls_fishing_stage.academy_inquiry_learner_links WHERE workspace_id=$1 AND application_id=$2 AND (learner_index=$3 OR learner_id=$4) LIMIT 2 FOR SHARE`,[actor.workspaceId,command.applicationId,command.learnerIndex,e.learnerId]);
   if(duplicate.length)conflict();
   const id=randomUUID();
   const rows=await tx.query(`INSERT INTO ls_fishing_stage.academy_inquiry_learner_links
    (workspace_id,id,application_id,learner_index,learner_id,household_id,payer_account_id,initial_enrollment_id,initial_enrollment_revision,purchase_id,purchase_line_id,offer_id,intake_version,terms_version,inquiry_request_digest,inquiry_fields_digest,guardian_digest,binding_digest,actor_account_id,operation_id,command_digest,linked_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,clock_timestamp()) RETURNING id`,
   [actor.workspaceId,id,binding.applicationId,binding.learnerIndex,binding.learnerId,binding.householdId,binding.payerAccountId,binding.initialEnrollmentId,binding.initialEnrollmentRevision,binding.purchaseId,binding.purchaseLineId,binding.offerId,binding.intakeVersion,binding.termsVersion,binding.inquiryRequestDigest,binding.inquiryFieldsDigest,binding.guardianDigest,bindingDigest,actor.id,command.operationId,commandDigest]);
   if(rows.length!==1||rows[0]!.id!==id)unavailable();
   await reauthorize();
   return {version:academyInquiryLearnerLinkVersion,saved:true as const,linkId:id,replayed:false};
  });}catch(error){
   if(error instanceof AppError||error instanceof FishingProgramError)throw error;
   if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="23505")conflict();
   return unavailable();
  }
 }
}
