import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {nativeProgramFixture,programRing,programKey,programClock} from './fishing-native-program-v3.ts';
import {FishingFulfillmentNativeV1} from '../../src/features/fishing-billing/fulfillment-native-v1.ts';
import {FULFILLMENT_V1,type FulfillmentCommandV1} from '../../src/features/fishing-billing/fulfillment-contract-v1.ts';
import {FishingServicePlanNativeV1} from '../../src/features/fishing-billing/service-plan-native-v1.ts';
import {SERVICE_PLAN_V1} from '../../src/features/fishing-billing/service-plan-contract-v1.ts';
import {FishingGuestServiceMaterialNativeV4} from '../../src/features/fishing-billing/guest-service-material-native-v4.ts';
import {FishingGuestServiceOwnerNativeV4,type ServiceOwnerIssueAuthorityV4} from '../../src/features/fishing-billing/guest-service-owner-native-v4.ts';
import {BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4,type ServiceAcceptCommandV4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {bindServiceDisplayBundleV4} from '../../src/features/fishing-billing/guest-service-material-v4.ts';
import {serviceGrantLifecycleV4Schema,FishingServiceGuestGrantResolverV4,type ServiceGuestGrantAuthorityV4} from '../../src/features/fishing-billing/guest-service-grant-resolver-v4.ts';
import {serviceGuestAadV4} from '../../src/features/fishing-billing/guest-service-aad-v4.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {digest} from '../../src/features/contact-ops/server/digests.ts';
import {tokenDigest,opaqueToken,seal} from '../../src/features/identity/crypto.ts';
import {AppError} from '../../src/lib/errors.ts';

/** Actual native family/source/schedule/V4 owner issuer and crypto. Guardian,
 * legal and GLOBAL reservation ports below are expressly synthetic/unapproved.
 * Grant row is RAW SEEDED for resolver tests: not an actual grant issuer,
 * genuine admission, guest acceptance, available-seat or financial proof. */
export async function serviceGuestFixtureV4(engine:PGlite){
 const f=await nativeProgramFixture(engine);await f.source().record(f.owner,f.group());
 const dates=['2035-01-31T21:30:00Z','2035-02-07T21:30:00Z','2035-02-14T21:30:00Z','2035-02-15T21:00:00Z',
  '2035-02-21T21:30:00Z','2035-02-22T21:00:00Z','2035-03-01T21:00:00Z','2035-03-08T21:00:00Z'];
 const lessons=dates.map(()=>randomUUID());for(const [i,date] of dates.entries())await f.source().record(f.owner,f.lesson(lessons[i]!,i+1,date));
 await f.source().record(f.owner,f.progression(0,'2035-01-31T00:00:00Z'));await f.source().record(f.owner,f.progression(1,'2035-02-15T00:00:00Z','verified_catchup'));
 const create=f.offer([lessons[0]!,lessons[3]!]),created=await f.billing().createAnchoredOffer(f.owner,create);
 const fulfillment=new FishingFulfillmentNativeV1(f.workspace,f.source(),f.billing(),programRing,programKey,programClock);
 function departure(date:string,tripKind:'keys'|'local'):Extract<FulfillmentCommandV1,{action:'record_departure'}>{return {version:FULFILLMENT_V1,action:'record_departure',id:randomUUID(),groupId:f.groupId,operationId:randomUUID(),expectedRevision:0,
  fields:{state:'scheduled',tripKind,startsAt:date+'T13:00:00Z',endsAt:date+'T23:00:00Z',timeZone:'America/New_York',fullDay:true,childCapacity:2,
   venueSource:{id:'SYNTHETIC-NOT-VENUE-APPROVAL',sha256:'a'.repeat(64)},capacitySource:{id:'SYNTHETIC-NOT-GLOBAL-RESERVATION',sha256:'b'.repeat(64)},
   planningContext:{location:'SYNTHETIC Florida site',details:'SYNTHETIC planning only, no operating permission.'}}};}
 const keys=departure('2035-02-18','keys'),local=departure('2035-02-25','local');await fulfillment.recordDeparture(f.owner,keys);await fulfillment.recordDeparture(f.owner,local);
 const trip=await fulfillment.preparePlan(f.owner,{version:FULFILLMENT_V1,action:'prepare_plan',quoteId:create.id,operationId:randomUUID(),expectedRevision:0,expectedQuoteRevision:1,
  children:created.quote.lines.map(l=>({lineId:l.id,keys:{id:keys.id,expectedRevision:1},local:{id:local.id,expectedRevision:1}}))});
 const plan={version:SERVICE_PLAN_V1,quoteId:create.id,expectedQuoteRevision:1,tripPlan:{expectedRevision:1,expectedDigest:trip.digest},children:created.quote.lines.map((l,i)=>({lineId:l.id,expectedProgressionRevision:1,
  lessons:(i===0?[0,1,2,4]:[3,5,6,7]).map(n=>({id:lessons[n]!,expectedRevision:1}))}))};
 const material=new FishingGuestServiceMaterialNativeV4(f.workspace,new FishingServicePlanNativeV1(f.workspace,f.source(),fulfillment,programKey));
 const request={version:BILLING_SERVICE_V4,action:'prepare_service_financial_draft',plan,policyKind:'selected_650_product_policy'},draft=await material.preview(f.owner,request);
 const families=new FishingBillingInquiryFamilyProposals(f.db,f.workspace,programRing,programKey,programClock);
 const refs={recipientBindingEvidenceId:randomUUID(),guardianAssuranceEvidenceId:randomUUID(),financialTermsReleaseEvidenceId:randomUUID(),admissionPolicy:{id:'SYNTHETIC-UNAPPROVED-GATE',sha256:'c'.repeat(64)},capacityEvidence:{id:'SYNTHETIC-NOT-ACTUAL-RESERVATION',sha256:'d'.repeat(64)}};
 const ownerAuthority:ServiceOwnerIssueAuthorityV4={target:async()=>{},current:async(c,r)=>{
  await families.readCurrentDataInTransaction(c.tx,{proposalId:f.family.id,reference:f.family.command.selection.reference,expectedEpoch:f.family.command.expectedEpoch,lock:'shared'});
  return {version:BILLING_SERVICE_V4,workspaceId:f.workspace,actorId:c.actor.id,quoteId:create.id,familyId:create.familyId,materialSha256:r.offer.sha256,locale:r.locale,...refs};
 }};
 const issuer=new FishingGuestServiceOwnerNativeV4(f.workspace,f.source(),f.billing(),material,ownerAuthority,programRing,programKey,programClock);
 const issued=await issuer.issue(f.owner,{version:BILLING_SERVICE_V4,action:'issue_service_offer_v4',operationId:randomUUID(),quoteId:create.id,expectedQuoteRevision:1,expectedDraftSha256:draft.sha256,locale:'en',material:request});
 if(issued.state!=='committed')throw Error('EXPECTED_ACTUAL_NATIVE_ISSUANCE');const quote=issued.result.quote;
 const bundle=bindServiceDisplayBundleV4(quote.offer,{version:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,id:randomUUID(),locale:'he',offerSnapshotSha256:quote.offer.sha256,
  serviceSnapshotSha256:digest(quote.offer.material.schedule.snapshot),financialTerms:{source:quote.definition.terms,displayedTextSha256:'e'.repeat(64),releaseEvidenceId:refs.financialTermsReleaseEvidenceId}});
 const token=opaqueToken(),grant=serviceGrantLifecycleV4Schema.shape.grant.parse({version:BILLING_SERVICE_V4,materialVersion:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,id:randomUUID(),
  offer:quote.offer,displayBundle:bundle,recipientBindingEvidenceId:refs.recipientBindingEvidenceId,admissionPolicy:refs.admissionPolicy,tokenDigest:tokenDigest(token),issuedAt:'2035-01-02T15:01:00.000Z',expiresAt:'2035-01-02T16:01:00.000Z',issuedByAccountId:f.owner.id});
 const lifecycle=serviceGrantLifecycleV4Schema.parse({version:BILLING_SERVICE_V4,grant,state:'active',revokedAt:null,use:null});
 await engine.query('INSERT INTO ls_fishing_billing.guest_grants(workspace_id,id,quote_id,action,token_digest,state,issued_at,expires_at,payload_ciphertext,material_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [f.workspace,grant.id,quote.id,SERVICE_FINANCIAL_ACTION_V4,grant.tokenDigest,'active',grant.issuedAt,grant.expiresAt,seal(JSON.stringify(lifecycle),serviceGuestAadV4('grant',f.workspace,grant.id),programRing),BILLING_SERVICE_V4]);
 const presentation={version:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,grantId:grant.id,displayBundleId:bundle.id,displayBundleSha256:bundle.sha256,locale:'he' as const,evidenceId:randomUUID(),
  affirmation:{version:'SYNTHETIC-UNAPPROVED-V4-TEXT',guardianAuthorityText:'SYNTHETIC guardian statement',financialTermsText:'SYNTHETIC financial statement',serviceScheduleText:'SYNTHETIC full schedule'}};
 const command:ServiceAcceptCommandV4={version:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,operationId:randomUUID(),expectedQuoteRevision:2,offerSnapshotSha256:quote.offer.sha256,displayBundleId:bundle.id,displayBundleSha256:bundle.sha256,
  displayChallenge:'A'.repeat(43),parent:{submittedName:'SYNTHETIC parent',guardianAuthorityAttested:true,financialTermsAffirmed:true,serviceScheduleAffirmed:true},recurring:{kind:'one_time_only'}};
 const flags={denyTarget:false,denyCurrent:false,badEvidence:false,badDisplay:false,denyDuringDisplay:false,now:new Date('2035-01-02T15:02:00Z'),displayCalls:0};
 const guestAuthority:ServiceGuestGrantAuthorityV4={target:async()=>{if(flags.denyTarget)throw new AppError('FORBIDDEN');},current:async(c,g)=>{
  if(flags.denyCurrent)throw new AppError('FORBIDDEN');
  const family=await families.readCurrentDataInTransaction(c.tx,{proposalId:f.family.id,reference:f.family.command.selection.reference,expectedEpoch:f.family.command.expectedEpoch,lock:'shared'});
  if(family.proposal.command.selection.familyId!==g.offer.material.financial.familyId)throw new AppError('FORBIDDEN');
  return {version:BILLING_SERVICE_V4,workspaceId:f.workspace,familyId:create.familyId,quoteId:quote.id,grantId:g.id,offerSnapshotSha256:g.offer.sha256,locale:g.displayBundle.locale,
   issuedByAccountId:f.owner.id,recipientBindingEvidenceId:flags.badEvidence?randomUUID():refs.recipientBindingEvidenceId,assuranceEvidenceId:refs.guardianAssuranceEvidenceId,financialTermsReleaseEvidenceId:refs.financialTermsReleaseEvidenceId,
   admissionPolicy:refs.admissionPolicy,capacityEvidence:refs.capacityEvidence};
 },display:async(_c,_g,challenge)=>{flags.displayCalls++;if(challenge!==command.displayChallenge)throw new AppError('FORBIDDEN');if(flags.denyDuringDisplay)flags.denyTarget=true;
  return {presentation:{...presentation,locale:flags.badDisplay?'en':'he'},recurringPresentation:null};}};
 // Explicitly separate source-origin integrity key from binary command HMAC.
 const commandKey=Buffer.alloc(32,17),clock={now:()=>new Date(flags.now)};
 const resolver=(authority=guestAuthority)=>new FishingServiceGuestGrantResolverV4(f.workspace,programRing,programKey,commandKey,clock,authority);
 return {...f,quote,grant,lifecycle,bundle,presentation,command,token,flags,guestAuthority,resolver,clock,commandKey,keys,local,lessons};
}
