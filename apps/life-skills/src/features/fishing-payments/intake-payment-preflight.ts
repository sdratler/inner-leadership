import {z} from "zod";
import {approvedOffer,id,instant} from "./domain.ts";
import type {ApprovedOffer} from "../fishing/contract.ts";
import {academyPolicyPreflightVersion,academyCompletedIntakeVersion,type AcademyPaymentPreflightInput,type AcademyPaymentPreflightResult,type AcademyPaymentPreflightReason} from "../fishing/academy-policy-preflight-contract.ts";

const nativeId=z.uuid();
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const identifier=(value:unknown)=>id.safeParse(value).success;
const digest=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
function at(value:unknown):number|null{const parsed=instant.safeParse(value);if(!parsed.success)return null;const time=Date.parse(parsed.data);return Number.isFinite(time)?time:null;}
function result(reasons:readonly AcademyPaymentPreflightReason[],learnerCount=0,mappedLearnerCount=0):AcademyPaymentPreflightResult{
 return Object.freeze({version:academyPolicyPreflightVersion,status:reasons.length?"incomplete":"ready_for_native_review",reasons:Object.freeze([...reasons]),learnerCount,mappedLearnerCount,mayCharge:false,mayReserveFounding:false});
}
function assess(input:unknown):AcademyPaymentPreflightResult{
 if(!record(input)||input.version!==academyPolicyPreflightVersion)return result(["invalid_input"]);
 const now=at(input.now);if(now===null)return result(["invalid_input"]);
 const intake=input.intake;
 if(intake===null||intake===undefined)return result(["intake_missing"]);
 if(!record(intake)||!["complete","ordinary_inquiry","invalid"].includes(typeof intake.state==="string"?intake.state:""))return result(["invalid_input"]);
 if(intake.state!=="complete")return result(["intake_incomplete"]);
 const count=intake.learnerCount;
 if(typeof count!=="number"||!Number.isSafeInteger(count)||count<1||count>10)return result(["invalid_input"]);
 if(intake.version!==academyCompletedIntakeVersion)return result(["intake_version"],count);
 if(!nativeId.safeParse(intake.workspaceId).success||!nativeId.safeParse(intake.applicationId).success||!digest(intake.fieldsDigest))return result(["inquiry_binding_mismatch"],count);
 const link=input.link;
 if(link===null||link===undefined)return result(["link_missing"],count);
 if(!record(link))return result(["invalid_input"],count);
 if(link.workspaceId!==intake.workspaceId||link.applicationId!==intake.applicationId||link.fieldsDigest!==intake.fieldsDigest)return result(["inquiry_binding_mismatch"],count);
 if(!identifier(link.householdId)||!nativeId.safeParse(link.payerAccountId).success)return result(["household_payer_mismatch"],count);
 if(!identifier(link.guardianBindingId))return result(["guardian_missing"],count);
 const raw=input.offer;
 if(raw===null||raw===undefined)return result(["offer_missing"],count);
 if(!record(raw)||!identifier(raw.id)||!nativeId.safeParse(raw.workspaceId).success||!Array.isArray(raw.lines))return result(["offer_invalid"],count);
 if(raw.workspaceId!==intake.workspaceId||!identifier(link.approvedOfferId)||raw.id!==link.approvedOfferId)return result(["offer_binding_mismatch"],count);
 if(raw.householdId!==link.householdId||raw.payerAccountId!==link.payerAccountId)return result(["household_payer_mismatch"],count);
 const terms=raw.terms;
 if(!record(terms)||!identifier(link.acceptedTermsVersion)||terms.version!==link.acceptedTermsVersion||terms.acceptedBy!==link.payerAccountId)return result(["terms_mismatch"],count);
 const acceptedAt=at(terms.acceptedAt);if(acceptedAt===null||acceptedAt>now)return result(["terms_mismatch"],count);
 if(raw.lines.length!==count)return result(["learner_mapping_invalid"],count);
 // Bound nested arrays before the existing pure structural validator clones them.
 for(const line of raw.lines)if(!record(line)||!Array.isArray(line.dues)||line.dues.length<1||line.dues.length>3)return result(["offer_invalid"],count);
 let offer:ApprovedOffer;
 try{offer=approvedOffer(raw);}catch{return result(["offer_invalid"],count);}
 if(Date.parse(offer.expiresAt)<=now)return result(["offer_expired"],count);
 if(!Array.isArray(link.learners)||link.learners.length!==count)return result(["learner_mapping_invalid"],count);
 const indices=new Set<number>(),learners=new Set<string>(),pairs:{facts:Record<string,unknown>;line:ApprovedOffer["lines"][number]}[]=[];
 for(const facts of link.learners){
  if(!record(facts)||typeof facts.learnerIndex!=="number"||!Number.isInteger(facts.learnerIndex)||facts.learnerIndex<0||facts.learnerIndex>=count||indices.has(facts.learnerIndex)||typeof facts.learnerId!=="string"||!nativeId.safeParse(facts.learnerId).success||learners.has(facts.learnerId)||!identifier(facts.cohortId)||!identifier(facts.stageId))return result(["learner_mapping_invalid"],count);
  const line=offer.lines.find(line=>line.learnerId===facts.learnerId);
  if(!line||facts.cohortId!==line.cohortId||facts.stageId!==line.stageId||facts.stage!==line.stage)return result(["learner_mapping_invalid"],count);
  indices.add(facts.learnerIndex);learners.add(facts.learnerId);pairs.push({facts,line});
 }
 const missing=new Set<AcademyPaymentPreflightReason>();
 for(const {facts,line} of pairs){
  const fit=facts.fit,capacity=facts.capacity,schedule=facts.schedule,location=facts.location;
  // Fit is separate native evidence, never the discount-eligibility evidence ID.
  if(!record(fit)||fit.state!=="suitable"||!identifier(fit.decisionId))missing.add("fit_incomplete");
  if(!record(capacity)||capacity.reservationId!==line.capacity.reservationId||typeof capacity.revision!=="number"||!Number.isSafeInteger(capacity.revision)||capacity.revision<1||capacity.revision!==line.capacity.revision||capacity.expiresAt!==line.capacity.expiresAt||(at(capacity.expiresAt)??-Infinity)<=now)missing.add("capacity_incomplete");
  if(!record(schedule)||schedule.state!=="suitable"||!identifier(schedule.evidenceId))missing.add("schedule_incomplete");
  if(!record(location)||location.state!=="suitable"||!identifier(location.evidenceId))missing.add("location_incomplete");
 }
 const order:readonly AcademyPaymentPreflightReason[]=["fit_incomplete","capacity_incomplete","schedule_incomplete","location_incomplete"];
 return result(order.filter(reason=>missing.has(reason)),count,pairs.length);
}

/** Unmounted pure preflight over supplied facts, not current native authority.
 * Root must resolve/revalidate real snapshots and actor permissions separately.
 * No charge, founding reservation, proof minting, output IDs, reflection or IO.
 */
export function assessInquiryPaymentPreflight(input:AcademyPaymentPreflightInput):AcademyPaymentPreflightResult{
 try{return assess(input);}catch{return result(["invalid_input"]);}
}
