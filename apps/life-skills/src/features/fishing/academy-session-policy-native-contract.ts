/** Root-owned candidate seam. Unmounted; no production/schema admission.
 * References from a browser are never facts or authorization. The required
 * Root authority resolves current native records inside the supplied transaction.
 * Missing evidence denies. A pure preflight status cannot authorize a credit.
 */
import type {AccountFacts,Actor,IdentityClock} from "../identity/types.ts";
import type {Keyring} from "../identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import type {AcademyInquiryReference,AcademyOriginalSessionAnchor,AcademySessionDurationInput,
 AcademyTravelChangeInput,AcademyTravelChangeReason} from "./academy-policy-preflight-contract.ts";

export const academySessionPolicyNativeVersion="JLFA-SESSION-POLICY-NATIVE-20261018-03-v1" as const;
export type AcademySessionCreditCommand=Readonly<{
 operationId:string;enrollmentId:string;originalOccurrenceId:string;
 expectedStageRevision:number;sourceEvidenceId:string;expectedEvidenceRevision:number;
}>;
export type AcademySessionCreditSelection=Readonly<{selectedEnrollmentId:string}>;
export type AcademySessionCreditState="outstanding"|"replacement_reserved"|"delivered";
export type AcademySessionCreditRecord=Readonly<{
 id:string;anchor:AcademyOriginalSessionAnchor;enrollmentId:string;purchaseId:string;purchaseLineId:string;
 state:AcademySessionCreditState;replacementReservationId:string|null;
}>;
export type AcademySessionCreditNativeContext=Readonly<{
 actor:AccountFacts;now:Date;selection:AcademySessionCreditSelection;
}>;
/** Resolver verifies paid original obligation AND no service delivery. Payment,
 * a seat reservation, a group completion flag or attendance alone is insufficient.
 * The source change, recorded preference and cannot-attend declaration must be
 * bound to the same original child/session and current authorized guardian.
 */
export type AcademySessionCreditNativeFacts=Readonly<{
 anchor:AcademyOriginalSessionAnchor;enrollmentId:string;purchaseId:string;purchaseLineId:string;
 householdId:string;guardianBindingId:string;acceptedTermsVersion:string;
 inquiry:AcademyInquiryReference&Readonly<{learnerIndex:number;drivePreferenceDigest:string}>;
 stageRevision:number;sourceEvidenceId:string;evidenceRevision:number;evidenceDigest:string;
 duration:AcademySessionDurationInput;
 travel:Omit<AcademyTravelChangeInput,"existingCredit">;
 /** Only an unambiguously bound original entitlement may be reused. A different
  * existing ID/anchor/state is a conflict, never permission to merge or delete.
  */
 legacyCredit:AcademySessionCreditRecord|null;
}>;
export interface AcademySessionPolicyNativeAuthority {
 /** After freshActor + workspace lock, recheck operator/current selected parent,
  * enrollment, every original anchor field, purchase/delivery and immutable
  * source evidence. Run BEFORE reading a cached command receipt on every call.
  */
 resolveCreditFacts(tx:SqlSession,context:AcademySessionCreditNativeContext,
  command:AcademySessionCreditCommand):Promise<AcademySessionCreditNativeFacts|null>;
 /** Revalidate the exact selected child on every private read. No default first
  * child, list-all household fallback or authority from a prior browser DTO.
  */
 resolveSelectedEnrollment(tx:SqlSession,context:AcademySessionCreditNativeContext):Promise<Readonly<{
  enrollmentId:string;workspaceId:string;learnerId:string;
 }> | null>;
}
export type AcademySessionPolicyNativeDependencies=Readonly<{
 database:IdentityStore;keyring:Keyring;principal:Actor;selection:AcademySessionCreditSelection;
 authority:AcademySessionPolicyNativeAuthority;clock:IdentityClock;
}>;
export type AcademySessionCreditCommandResult=Readonly<{
 version:typeof academySessionPolicyNativeVersion;
 outcome:"issued"|"retained"|"no_credit"|"facts_required";
 reason:AcademyTravelChangeReason;credit:AcademySessionCreditRecord|null;replayed:boolean;
 mayBook:false;mayMarkDelivered:false;specificDateOrSeatGuaranteed:false;
}>;
/** A server-authorized selected-child projection only, not a browser evidence
 * input. A reserved replacement remains undelivered; no expiry/cap is invented.
 */
export type AcademySessionCreditFamilySummary=Readonly<{
 version:typeof academySessionPolicyNativeVersion;enrollmentId:string;learnerId:string;
 credits:readonly AcademySessionCreditRecord[];
}>;
// Storage envelope purposes (append identity components with '/'; no raw PII):
// ls_fishing_stage/academy_evidence/v1/<workspace>/<evidence-row-id>
// ls_fishing_stage/academy_credit_event/v1/<workspace>/<actor>/<operation>
// Facts, credit and operation/event receipt commit in ONE SqlSession transaction.
// No dependency/default may discover credentials, a provider or an app mount.
