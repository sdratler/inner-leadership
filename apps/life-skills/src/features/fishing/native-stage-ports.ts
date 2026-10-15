/** MAIN-owned native integration input. No default/synthetic implementation.
 * These callbacks read/write native facts through the SAME supplied transaction.
 * They must never fetch a provider, trust browser authority or infer enrollment
 * from payment. Missing authority/resource/seat proof must deny, not return zero.
 */
import type {AccountFacts,Actor} from "../identity/types.ts";
import type {SqlSession} from "../identity/store.ts";
import type {FishingStageRef} from "./contract.ts";
import type {
 ApprovedStageTemplate,CanonicalOccurrence,EnrollmentProjection,FreshStageContext,
} from "../fishing-stage/contract.ts";

export const nativeStagePortsVersion="rm-fishing-native-stage-ports-v1" as const;

/** The store supplies the verified account/session, never a hook or request.
 * Parent/child selection is explicit; null is NOT "pick the first child".
 */
export type NativeStageAuthorityFacts=Readonly<Omit<FreshStageContext,"actor"|"sessionRevoked">>;
export type NativeStageHookContext=Readonly<{
 actor:AccountFacts;scope:FreshStageContext["scope"];now:Date;
 selectedEnrollmentId:string|null;
}>;
export type NativeStageSelection=Readonly<{selectedEnrollmentId:string|null}>;

export interface FishingStageNativeHooks {
 /** Recheck native operator, guardian/child, cohort, terms, fit and capacity
  * evidence under lock. A different selected enrollment is not interchangeable.
  */
 resolveContext(tx:SqlSession,actor:AccountFacts,reference:FishingStageRef,
  selection:NativeStageSelection,now:Date):Promise<NativeStageAuthorityFacts|null>;
 resolveApprovedTemplate(tx:SqlSession,context:NativeStageHookContext,
  version:string):Promise<ApprovedStageTemplate|null>;
 readEnrollment(tx:SqlSession,context:NativeStageHookContext,
  enrollmentId:string):Promise<EnrollmentProjection|null>;
 /** Count actual confirmed AND reserved places under shared native locks.
  * This must include enrollment/offer holds and makeups in the SAME seat ledger.
  */
 occupiedSeats(tx:SqlSession,context:NativeStageHookContext,occurrenceId:string):Promise<number>;
 /** Reuse the actual app calendar's resource ownership/availability. Reserve
  * instructor/venue once per canonical occurrence, not once per child. No
  * clinical appointment/case, invented date, external sync or provider send.
  * A later failed plan/receipt commit must roll back every resource effect.
  */
 reconcileResources(tx:SqlSession,context:NativeStageHookContext,
  before:readonly CanonicalOccurrence[],after:readonly CanonicalOccurrence[]):Promise<void>;
 replacementSuitable(tx:SqlSession,context:NativeStageHookContext,
  enrollment:EnrollmentProjection,target:CanonicalOccurrence):Promise<boolean>;
 /** Atomically recheck revision/suitability/capacity; one entitlement and one
  * learner/target reservation across the shared ledger. A reservation is not
  * attendance, service delivery, payment, refund or another makeup credit.
  */
 reserveMakeup(tx:SqlSession,context:NativeStageHookContext,input:Readonly<{
  enrollment:EnrollmentProjection;target:CanonicalOccurrence;
  entitlementId:string;expectedRevision:number;
 }>):Promise<string>;
}

/** Construction requires an ordinary server-resolved session. The native
 * adapter must lock/reload it with freshActor in each transaction, independently
 * of hooks, and bind all returned context to that account/workspace/selection.
 */
export type NativeStagePrincipal=Readonly<{actor:Actor;selection:NativeStageSelection}>;
