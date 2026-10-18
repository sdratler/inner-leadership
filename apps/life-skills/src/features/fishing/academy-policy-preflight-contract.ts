/** Root-owned Source03 preflight seam, intentionally unmounted.
 * These readonly snapshots describe facts a FUTURE native adapter must resolve
 * and revalidate in its authorized transaction. Never accept them from a browser
 * as evidence, deserialize them into authority, or infer payment/credit rights.
 * Pure helper results only identify missing or inconsistent facts for review.
 */
import type {ApprovedOffer, FishingStageNumber} from "./contract.ts";

export const academyPolicyPreflightVersion = "JLFA-POLICY-PREFLIGHT-20261018-03-v1" as const;
export const academyCompletedIntakeVersion = "JLFA-ENROLLMENT-20261018-03-v1" as const;
export const academyOrdinarySessionMinutes = 180 as const;

export type AcademyInquiryReference = Readonly<{
  workspaceId: string;
  applicationId: string;
  fieldsDigest: string;
}>;
/** Persisted validation must include the existing base inquiry and permission,
 * not merely the optional academyIntake subobject. No child names/contact data.
 */
export type AcademyCompletedIntakeFacts = AcademyInquiryReference & Readonly<{
  state: "complete" | "ordinary_inquiry" | "invalid";
  version: string;
  learnerCount: number;
}>;
export type AcademyOfferLearnerFacts = Readonly<{
  learnerIndex: number;
  learnerId: string;
  cohortId: string;
  stageId: string;
  stage: FishingStageNumber;
  fit: Readonly<{decisionId: string; state: "suitable" | "unsuitable" | "unknown"}>;
  capacity: Readonly<{reservationId: string; revision: number; expiresAt: string}>;
  schedule: Readonly<{evidenceId: string; state: "suitable" | "unsuitable" | "unknown"}>;
  location: Readonly<{evidenceId: string; state: "suitable" | "unsuitable" | "unknown"}>;
}>;
export type AcademyInquiryOfferLinkFacts = AcademyInquiryReference & Readonly<{
  householdId: string;
  payerAccountId: string;
  guardianBindingId: string;
  acceptedTermsVersion: string;
  approvedOfferId: string;
  learners: readonly AcademyOfferLearnerFacts[];
}>;
export type AcademyPaymentPreflightInput = Readonly<{
  version: typeof academyPolicyPreflightVersion;
  now: string;
  intake: AcademyCompletedIntakeFacts | null;
  link: AcademyInquiryOfferLinkFacts | null;
  offer: ApprovedOffer | null;
}>;
export type AcademyPaymentPreflightReason =
  | "invalid_input" | "intake_missing" | "intake_incomplete" | "intake_version"
  | "link_missing" | "inquiry_binding_mismatch" | "household_payer_mismatch"
  | "guardian_missing" | "terms_mismatch" | "offer_missing" | "offer_invalid"
  | "offer_binding_mismatch" | "offer_expired" | "learner_mapping_invalid"
  | "fit_incomplete" | "capacity_incomplete" | "schedule_incomplete" | "location_incomplete";
/** No identifiers, input fragments, exception messages or PII in results/logs.
 * ready_for_native_review is NOT permission to expose a payment route.
 */
export type AcademyPaymentPreflightResult = Readonly<{
  version: typeof academyPolicyPreflightVersion;
  status: "incomplete" | "ready_for_native_review";
  reasons: readonly AcademyPaymentPreflightReason[];
  learnerCount: number;
  mappedLearnerCount: number;
  mayCharge: false;
  mayReserveFounding: false;
}>;

export type AcademySessionKind = "ordinary" | "keys" | "offshore" | "unclassified";
export type AcademySessionDurationInput = Readonly<{
  version: typeof academyPolicyPreflightVersion;
  sessionKind: AcademySessionKind;
  time: Readonly<{kind: "scheduled"; startsAt: string; endsAt: string; timeZone: string}>
    | Readonly<{kind: "undated"; timeZone: string}>;
}>;
export type AcademySessionDurationResult = Readonly<{
  version: typeof academyPolicyPreflightVersion;
  status: "ordinary_duration_matches" | "duration_review_required" | "undated" | "exception_review_required";
  reason: "ordinary_180_minutes" | "ordinary_duration_mismatch" | "invalid_input" | "undated" | "separate_exception_terms";
  elapsedMinutes: number | null;
  mayBook: false;
}>;

/** Website09/Florida START: only Foundation's first two original meetings are
 * two-hour preparation. This separate advisory seam does not reinterpret the
 * Source03 ordinary/Keys/offshore classifiers or confer native credit rights.
 * A future native caller must reload the stage/ordinal from the actual original
 * obligation, never infer them from a browser or a replacement's position. */
export const academyFoundationPreparationPolicyVersion="JLFA-FOUNDATION-PREPARATION-20261018-09-v1" as const;
export const academyFoundationPreparationMinutes=120 as const;
export type AcademyFoundationPreparationDurationInput=Readonly<{
 version:typeof academyFoundationPreparationPolicyVersion;
 sessionKind:"foundation_preparation";
 stage:1;
 originalOrdinal:1|2;
 time:AcademySessionDurationInput["time"];
}>;
export type AcademyFoundationPreparationDurationResult=Readonly<{
 version:typeof academyFoundationPreparationPolicyVersion;
 status:"foundation_preparation_duration_matches"|"duration_review_required"|"undated";
 reason:"foundation_preparation_120_minutes"|"foundation_preparation_duration_mismatch"|"invalid_input"|"undated";
 elapsedMinutes:number|null;
 mayBook:false;
 mayIssueCredit:false;
 mayMarkDelivered:false;
}>;

/** Immutable original obligation. A replacement occurrence/reservation never
 * replaces this identity. Per-child and per-original-session, not a stage cap.
 * ordinal is the original week within the purchased 12-session stage.
 */
export type AcademyOriginalSessionAnchor = Readonly<{
  workspaceId: string;
  learnerId: string;
  cohortId: string;
  stageId: string;
  occurrenceId: string;
  ordinal: number;
  moduleId: string;
  moduleVersion: string;
  activityId: string;
}>;
export type AcademyPurchasedObligationFacts = Readonly<{
  anchor: AcademyOriginalSessionAnchor;
  evidenceId: string;
  state: "purchased_undelivered" | "delivered" | "unpurchased" | "unknown";
}>;
export type AcademyOutstandingCreditFacts = Readonly<{
  anchor: AcademyOriginalSessionAnchor;
  creditId: string;
  state: "outstanding" | "replacement_reserved" | "delivered" | "unknown";
}>;
/** over_60 deliberately has no invented numeric cap. A future native adapter
 * needs an independently recorded actual maximum before comparing that family.
 */
export type AcademyRecordedDriveLimit = "up_to_30" | "up_to_45" | "up_to_60" | "over_60";
export type AcademyTravelChangeInput = Readonly<{
  version: typeof academyPolicyPreflightVersion;
  original: AcademyOriginalSessionAnchor;
  obligation: AcademyPurchasedObligationFacts | null;
  existingCredit: AcademyOutstandingCreditFacts | null;
  sessionKind: AcademySessionKind;
  change: Readonly<{
    anchor: AcademyOriginalSessionAnchor;
    kind: "academy_venue" | "academy_schedule" | "academy_weather_cancelled" | "parent_absence" | "other";
    evidenceId: string;
    weatherQualification: "qualifying" | "not_qualifying" | "unknown";
    recordedDriveLimit: AcademyRecordedDriveLimit;
    revisedOneWayMinutes: number | null;
    familyCannotAttend: boolean | null;
  }>;
}>;
export type AcademyTravelChangeReason =
  | "invalid_input" | "original_anchor_mismatch" | "obligation_missing"
  | "obligation_unknown" | "obligation_not_purchased" | "obligation_delivered"
  | "credit_anchor_mismatch" | "credit_delivered" | "credit_unknown"
  | "change_evidence_missing" | "drive_limit_requires_facts" | "attendance_requires_facts"
  | "weather_requires_review" | "separate_exception_terms" | "existing_absence_policy"
  | "no_qualifying_change" | "within_recorded_limit" | "family_can_attend"
  | "academy_change_exceeds_limit" | "qualifying_weather_cancellation" | "same_outstanding_credit";
export type AcademyTravelChangeResult = Readonly<{
  version: typeof academyPolicyPreflightVersion;
  status: "replacement_review_required" | "retain_existing_credit" | "no_new_credit" | "facts_required";
  reason: AcademyTravelChangeReason;
  /** No credit IDs/anchors returned or minted. This is classification only. */
  mayIssueCredit: false;
  mayBook: false;
  mayMarkDelivered: false;
  specificDateOrSeatGuaranteed: false;
}>;
