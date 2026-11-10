import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {Actor,WorkspaceId} from '../identity/types.ts';
import {billingId,type PublishedOffer} from './contracts.ts';
import {servicePlanPreviewV1Schema} from './service-plan-contract-v1.ts';
import {FishingServicePlanNativeV1} from './service-plan-native-v1.ts';
import {BILLING_SERVICE_V4,type ServicePolicyV4} from './guest-service-contract-v4.ts';
import {bindServiceFinancialDraftV4} from './guest-service-material-v4.ts';

export const serviceMaterialPreviewV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.literal('prepare_service_financial_draft'),
 plan:servicePlanPreviewV1Schema,policyKind:z.enum(['selected_650_product_policy','custom_terms_document']),
}).strict();
function policy(definition:PublishedOffer,kind:ServicePolicyV4['kind']):ServicePolicyV4{
 const p=definition.policies;if(!p.cancellation||!p.weather||!p.renewal||!p.service_period)throw new AppError('UNAVAILABLE');
 const refs={cancellation:p.cancellation,weather:p.weather,renewal:p.renewal,servicePeriod:p.service_period};
 if(kind==='custom_terms_document')return {...refs,kind,refundDisposition:'owner_review_under_exact_released_terms'};
 if(definition.unitAmountMinor!==65000)throw new AppError('CONFLICT');
 return {...refs,kind,rulesVersion:'JLFA-OWNER-FULLSTACK-PACKAGE-20261110-01',preAttendanceNoticeHours:24,preAttendanceRetentionMinor:10000,
  oneLessonBeforeTripRetentionTotalMinor:20000,afterLessonAndTrip:'no_refund_subject_to_mandatory_rights',retentionBasis:'actual_paid_child_period_only',
  absenceNoticeHours:24,absenceCredit:'affected_activity_subject_to_capacity',weatherOutcome:'preserve_undelivered_without_second_fee',unspecifiedCase:'owner_review_no_invented_penalty'};
}
/** Actual native prospective adapter, not an issuer. It reads the existing
 * pristine source quote and complete service plan in ONE authentic native TX.
 * No financial grant, signature, hold clock, obligation or provider is minted.
 * Root's future V4 issuer/admission must re-resolve genuine guardian/recipient,
 * released exact terms, selected language, shared capacity and source versions.
 * Existing V3 quote/token/AAD/decoder/evidence paths remain byte-compatible. */
export class FishingGuestServiceMaterialNativeV4{
 constructor(private readonly workspaceId:WorkspaceId,private readonly service:FishingServicePlanNativeV1){billingId.parse(workspaceId);}
 async preview(actor:Actor,raw:unknown){
  const command=serviceMaterialPreviewV4Schema.parse(raw);
  return this.service.withPreview(actor,command.plan,async(c,data,preview)=>{
   if(c.workspaceId!==this.workspaceId||c.actor.workspaceId!==this.workspaceId)throw new AppError('FORBIDDEN');
   return bindServiceFinancialDraftV4({version:BILLING_SERVICE_V4,kind:'prospective_service_financial_draft',basis:data.quote,
    schedule:{snapshot:preview.snapshot,sourceDigest:preview.digest},policy:policy(data.quote.definition,command.policyKind)});
  });
 }
}
