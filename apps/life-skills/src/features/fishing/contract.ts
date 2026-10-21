/** Main-owned RM11 integration seam. Types are not validation or an access grant.
 * Native adapters must reload the current Actor, relationships and revision in
 * the same transaction. Never deserialize these server facts from a browser.
 * USD fishing only; the existing ILS ledger and clinical access remain separate.
 */
import type {Actor,AccountId,PersonId,WorkspaceId} from "../identity/types.ts";
export type {Actor,IdentityClock} from "../identity/types.ts";
export type {IdentityStore,SqlSession} from "../identity/store.ts";

export const fishingContractVersion="rm-fishing-contract-v1" as const;
export type FishingProgram="sunday_fishing_academy"|"private_fishing_life_skills";
export type FishingStageNumber=1|2|3|4;
export type FishingSource=Readonly<{policyVersion:string;sourceVersion:string}>;
export type FishingStageRef=Readonly<{cohortId:string;stageId:string;stage:FishingStageNumber}>;
export type FishingDue=Readonly<{
 id:string;index:1|2|3;dueAt:string;currency:"USD";amountCents:number;
 state:"pending"|"action_required"|"failed"|"part_paid"|"paid"|"reconciliation_required";
 paidCents:number;
}>;
export type FishingPurchaseLine=FishingStageRef&Readonly<{
 id:string;learnerId:PersonId;
 totalCents:number;discountBasis:string;
 // Immutable server evidence, not eligibility inferred from a browser flag.
 eligibility:Readonly<{kind:"ordinary"|"verified_founder"|"verified_sibling";evidenceId:string;policyVersion:string}>;
 dues:readonly FishingDue[];
 capacity:Readonly<{reservationId:string;revision:number;expiresAt:string}>;
}>&Readonly<
 |{sessions:12;mode:"prepay"|"installments";block?:never}
 |{sessions:4;mode:"monthly_block";block:{id:string;acceptanceId:string;occurrenceIds:readonly string[]}}
>;
export type ApprovedOffer=FishingSource&Readonly<{
 id:string;revision:number;workspaceId:WorkspaceId;program:FishingProgram;
 operatorAccountId:AccountId;householdId:string;payerAccountId:AccountId;
 currency:"USD";lines:readonly FishingPurchaseLine[];expiresAt:string;
 terms:Readonly<{version:string;acceptedBy:AccountId;acceptedAt:string}>;
}>;

/** Server/operator projection. A family response must use its own explicitly
 * authorized DTO; do not expose merchant facts or opaque provider IDs by spread.
 */
export type PaymentState=FishingSource&Readonly<{
 purchaseId:string;revision:number;workspaceId:WorkspaceId;offerId:string;
 providerAccountId:string;livemode:boolean;currency:"USD";originalTotalCents:number;
 paidCents:number;refundedCents:number;feesCents:number|null;
 state:"unpaid"|"pending"|"action_required"|"failed"|"part_paid"|"paid"|"refund_recorded"|"reconciliation_required";
 dues:readonly FishingDue[];
 settlements:readonly Readonly<{
  canonicalTransactionId:string;providerReceiptId:string;purchaseLineId:string;
  kind:"payment"|"refund"|"dispute";cents:number;occurredAt:string;recordedAt:string;
 }>[];
 // A refund is not permission to revive or rewrite the original debt.
 revisedDebt:Readonly<{proposalId:string;approvedBy:AccountId;approvedAt:string;cents:number}>|null;
}>;

/** Payment evidence alone never grants enrollment, classroom or child access. */
export type EnrollmentProjection=FishingStageRef&Readonly<{
 id:string;revision:number;workspaceId:WorkspaceId;program:FishingProgram;
 purchaseId:string;purchaseLineId:string;learnerId:PersonId;householdId:string;
 state:"pending_review"|"confirmed"|"suspended"|"revoked";
 // Absent only for historical/full-stage enrollment. Native purchase evidence
 // supplies this scope; a parent request cannot choose additional lessons.
 purchaseScope?:Readonly<{kind:'monthly_block';blockId:string;acceptanceId:string;occurrenceIds:readonly string[]}>|undefined;
 evidence:Readonly<{
  verifiedGuardianBindingId:string;capacityReservationId:string;fitDecisionId:string;
  acceptedTermsVersion:string;ownerActionId:string;
 }>;
 // Current authorized accounts, never an invitation or inferred guardian grant.
 authorizedAccountIds:readonly AccountId[];
}>;
export type OccurrenceAction="read"|"report_absence"|"request_makeup"|"record_attendance"|"revise"|"cancel";
export type OccurrenceProjection=FishingStageRef&Readonly<{
 id:string;revision:number;workspaceId:WorkspaceId;program:FishingProgram;
 templateVersion:string;ordinal:1|2|3|4|5|6|7|8|9|10|11|12;
 moduleId:string;moduleVersion:string;
 state:"draft"|"published"|"completed"|"cancelled";optional:boolean;
 time:Readonly<{kind:"scheduled";startsAt:string;endsAt:string;timeZone:string}>|Readonly<{kind:"undated";timeZone:string}>;
 location:string;directions:string;equipment:string;logisticalNote:string;
 instructor:Readonly<{accountId:AccountId;displayName:string}>;childCapacity:number;
 replacesOccurrenceId:string|null;changedBy:AccountId;changedAt:string;changeReason:string;
 // Calculated by the server for this actor/current relationship only.
 allowedActions:readonly OccurrenceAction[];
}>;
export type FishingNotice=FishingSource&Readonly<{
 id:string;workspaceId:WorkspaceId;enrollmentId:string;occurrenceId:string;
 originalOccurrenceRevision:number;originalStartsAt:string;receivedAt:string;
 reason:"ordinary_absence"|"unavoidable"|"operator_cancelled";
 state:"protected"|"best_effort"|"operator_review"|"operator_undelivered";
 entitlementId:string|null;replacementOccurrenceId:string|null;replacementReservationId:string|null;
 specificTripGuaranteed:false;
}>;

/** Adapter interfaces return null for unavailable or unauthorized objects without
 * revealing another household. Mutations remain explicit, separate services.
 * Every implementation revalidates the ordinary session and native authority;
 * a matching purchase ID, paid flag or cached Actor is insufficient.
 */
export interface FishingPaymentReadPort {
 resolveApprovedOffer(actor:Actor,offerId:string):Promise<ApprovedOffer|null>;
 readPayment(actor:Actor,purchaseId:string):Promise<PaymentState|null>;
}
export interface FishingEnrollmentReadPort {
 readEnrollment(actor:Actor,enrollmentId:string):Promise<EnrollmentProjection|null>;
}
export interface FishingOccurrenceReadPort {
 readOccurrences(actor:Actor,stage:FishingStageRef):Promise<readonly OccurrenceProjection[]>;
}
