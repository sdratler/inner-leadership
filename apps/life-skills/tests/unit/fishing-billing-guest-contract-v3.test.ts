import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {syntheticDraft,syntheticId,syntheticGuardian,syntheticAccepted} from '../../src/features/fishing-billing/fixtures.ts';
import {issueFamilyOffer} from '../../src/features/fishing-billing/domain.ts';
import {projectBalanceV2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {familyOfferSchema,BILLING_DTO_VERSION} from '../../src/features/fishing-billing/contracts.ts';
import {BILLING_GUEST_V3,guestFinancialBundleSchema,guestCompletionBundleSchema,guestFinancialAcceptanceSchema,guestFamilyOfferSchema,
 guestGrantRecordSchema,guestAcceptCommandSchema,guestCompletionCommandSchema,guestAcceptanceReceiptSchema,guestCompletionReceiptSchema,guestPayableBasisSchema,guestOwnerSnapshotV3Schema} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,verifyGuestIssuedMaterial,bindGuestDisplayBundle,verifyGuestDisplayBundle,verifyGuestFinancialAcceptance,verifyGuestGrantRecord,verifyGuestFamilyOffer,projectHistoricalAccountPayableBasis,verifyGuestPayableBasis} from '../../src/lib/fishing-billing-guest-material-v3.ts';

function setup(){
 const old=issueFamilyOffer(syntheticDraft(),1,'2035-01-02T15:00:00.000Z'),{id,workspaceId,familyId,revision,definition,lines,createdAt,issuedAt,override}=old;
 const offer=bindGuestIssuedMaterial({workspaceId,familyId,quoteId:id,issuedRevision:revision,definition,lines,createdAt,issuedAt,override});
 const bundle=bindGuestDisplayBundle({id:syntheticId(950),version:'SYNTHETIC_ONLY',locale:'he',offerSnapshotSha256:offer.sha256,
  documents:[{purpose:'financial_terms',source:definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:syntheticId(951)}]});
 const acceptance={version:BILLING_GUEST_V3,id:syntheticId(952),kind:'guest_grant' as const,grantId:syntheticId(953),offer,displayed:bundle,
  parent:{submittedName:'SYNTHETIC ONLY',guardianAuthorityAttested:true as const,financialTermsAffirmed:true as const,statementSha256:'c'.repeat(64),privateEvidenceId:syntheticId(954)},
  assuranceEvidenceId:syntheticId(955),operationId:syntheticId(956),acceptedAt:'2035-01-02T15:01:00.000Z'};
 const guest={...old,version:BILLING_GUEST_V3,revision:3,state:'accepted' as const,acceptance};
 const grant={version:BILLING_GUEST_V3,id:acceptance.grantId,action:'accept_financial_offer' as const,offer,displayBundle:bundle,
  recipientBindingEvidenceId:syntheticId(957),admissionPolicy:definition.source,tokenDigest:'d'.repeat(64),issuedAt:'2035-01-02T15:00:10.000Z',expiresAt:'2035-01-03T15:00:00.000Z',issuedByAccountId:syntheticId(1)};
 const command={operationId:acceptance.operationId,expectedVersion:2,displayBundleId:bundle.id,displayBundleSha256:bundle.sha256,displayChallenge:'x'.repeat(43),parent:{submittedName:'SYNTHETIC ONLY',guardianAuthorityAttested:true,financialTermsAffirmed:true}};
 const basis={version:BILLING_GUEST_V3,workspaceId,familyId,quoteId:id,offer,obligationLineIds:lines.map(l=>l.id),acceptance:{kind:'guest_successor' as const,evidence:acceptance}};
 return {old,offer,bundle,acceptance,guest,grant,command,basis};
}
describe('explicit guest successor contracts and immutable material integrity',()=>{
 it('retains real guest identity without an account actorId and keeps legacy parsers separate',()=>{
  const f=setup(),q=verifyGuestFamilyOffer(f.guest);expect(q.acceptance!.kind).toBe('guest_grant');expect('actorId' in q.acceptance!).toBe(false);
  expect(familyOfferSchema.safeParse(f.guest).success).toBe(false);expect(familyOfferSchema.parse(f.old)).toEqual(f.old);expect(guestFamilyOfferSchema.safeParse(f.old).success).toBe(false);
 });
 it('binds canonical material independent of object key insertion order',()=>{
  const f=setup(),m=f.offer.material;expect(bindGuestIssuedMaterial({...m,definition:{...m.definition}}).sha256).toBe(f.offer.sha256);expect(verifyGuestIssuedMaterial(f.offer)).toEqual(f.offer);
 });
 it.each(['workspaceId','familyId','quoteId'] as const)('rejects mutated %s under its original material hash',key=>{
  const f=setup();expect(()=>verifyGuestIssuedMaterial({...f.offer,material:{...f.offer.material,[key]:syntheticId(999)}})).toThrow();
 });
 it('rejects changed child amount or order under the original material hash',()=>{
  const f=setup();expect(()=>verifyGuestIssuedMaterial({...f.offer,material:{...f.offer.material,lines:[...f.offer.material.lines].reverse()}})).toThrow();
  const material=structuredClone(f.offer.material);material.lines[0]!.amountMinor--;expect(()=>verifyGuestIssuedMaterial({...f.offer,material})).toThrow();
 });
 it('requires an exact financial purpose, not an empty or privacy-only display',()=>{
  const f=setup();expect(guestFinancialBundleSchema.safeParse({...f.bundle,documents:[]}).success).toBe(false);
  expect(guestFinancialBundleSchema.safeParse({...f.bundle,documents:f.bundle.documents.map(d=>({...d,purpose:'privacy_for_completion'}))}).success).toBe(false);
  expect(guestCompletionBundleSchema.safeParse(f.bundle).success).toBe(false);
 });
 it('rejects duplicate document purposes, wrong terms and a wrong offer hash',()=>{
  const f=setup();expect(guestFinancialBundleSchema.safeParse({...f.bundle,documents:[...f.bundle.documents,...f.bundle.documents]}).success).toBe(false);
  const a=structuredClone(f.acceptance);a.displayed.documents[0]!.source.id='OTHER';expect(guestFinancialAcceptanceSchema.safeParse(a).success).toBe(false);
  expect(guestFinancialAcceptanceSchema.safeParse({...f.acceptance,displayed:{...f.bundle,offerSnapshotSha256:'e'.repeat(64)}}).success).toBe(false);
 });
 it.each(['locale','version'] as const)('authenticates the displayed bundle %s',key=>{
  const f=setup();expect(()=>verifyGuestDisplayBundle({...f.bundle,[key]:key==='locale'?'en':'OTHER'})).toThrow();
 });
 it('checks actual document byte-hash/release references in bundle integrity',()=>{
  const f=setup(),bundle=structuredClone(f.bundle);bundle.documents[0]!.displayedTextSha256='e'.repeat(64);expect(()=>verifyGuestDisplayBundle(bundle)).toThrow();
  bundle.documents[0]!.displayedTextSha256=f.bundle.documents[0]!.displayedTextSha256;bundle.documents[0]!.releaseEvidenceId=syntheticId(999);expect(()=>verifyGuestDisplayBundle(bundle)).toThrow();
 });
 it('checks both nested hashes before returning an acceptance or persisted grant',()=>{
  const f=setup();expect(verifyGuestFinancialAcceptance(f.acceptance)).toEqual(f.acceptance);expect(verifyGuestGrantRecord(f.grant)).toEqual(f.grant);
  const a=structuredClone(f.acceptance);a.offer.sha256='e'.repeat(64);a.displayed.offerSnapshotSha256=a.offer.sha256;expect(()=>verifyGuestFinancialAcceptance(a)).toThrow();
  const grant=structuredClone(f.grant);grant.displayBundle.sha256='f'.repeat(64);expect(()=>verifyGuestGrantRecord(grant)).toThrow();
 });
 it('does not accept a financial record with missing policies or due dates',()=>{
  const f=setup(),a=structuredClone(f.acceptance);a.offer.material.definition.policies.renewal=null;expect(guestFinancialAcceptanceSchema.safeParse(a).success).toBe(false);
  a.offer.material.definition.policies.renewal=f.offer.material.definition.policies.renewal;a.offer.material.lines[0]!.dueAt=null;expect(guestFinancialAcceptanceSchema.safeParse(a).success).toBe(false);
 });
 it.each(['workspaceId','familyId','id'] as const)('keeps accepted quote %s joined to the exact issued material',key=>{
  const f=setup();expect(guestFamilyOfferSchema.safeParse({...f.guest,[key]:syntheticId(999)}).success).toBe(false);
 });
 it('retains acceptance through later cash/state revisions without altering material',()=>{
  const f=setup();expect(verifyGuestFamilyOffer({...f.guest,revision:9,paused:true,state:'cancelled'}).acceptance).toEqual(f.acceptance);
  const quote=structuredClone(f.guest);quote.lines[0]!.dueAt='2035-01-06T22:00:00Z';expect(guestFamilyOfferSchema.safeParse(quote).success).toBe(false);
 });
 it('never creates accepted/null or rewrites a guest principal into actorId',()=>{
  const f=setup();expect(guestFamilyOfferSchema.safeParse({...f.guest,acceptance:null}).success).toBe(false);
  expect(guestFamilyOfferSchema.safeParse({...f.guest,acceptance:{actorId:syntheticGuardian,acceptedAt:f.acceptance.acceptedAt,terms:f.old.definition.terms,quoteRevision:2}}).success).toBe(false);
  expect(guestFinancialAcceptanceSchema.safeParse({...f.acceptance,actorId:syntheticGuardian}).success).toBe(false);
 });
 it('requires acceptance after issue and a successor quote revision',()=>{
  const f=setup();expect(guestFinancialAcceptanceSchema.safeParse({...f.acceptance,acceptedAt:'2034-01-01T00:00:00Z'}).success).toBe(false);expect(guestFamilyOfferSchema.safeParse({...f.guest,revision:2}).success).toBe(false);
 });
 it('separates a completion grant from financial document authority and requires explicit expiry',()=>{
  const f=setup();expect(guestGrantRecordSchema.safeParse({...f.grant,action:'submit_private_completion'}).success).toBe(false);
  expect(guestGrantRecordSchema.safeParse({...f.grant,expiresAt:undefined}).success).toBe(false);expect(guestGrantRecordSchema.safeParse({...f.grant,expiresAt:f.grant.issuedAt}).success).toBe(false);
  expect(guestGrantRecordSchema.safeParse({...f.grant,token:'x'.repeat(43)}).success).toBe(false);
 });
 it('keeps financial affirmation out of completion commands and receipts',()=>{
  const f=setup(),command={operationId:f.command.operationId,displayBundleId:f.bundle.id,displayBundleSha256:f.bundle.sha256,displayChallenge:f.command.displayChallenge,privateSubmissionEvidenceId:syntheticId(960)};
  expect(guestCompletionCommandSchema.parse(command)).toEqual(command);expect(guestCompletionCommandSchema.safeParse({...command,parent:f.command.parent}).success).toBe(false);
  expect(guestCompletionReceiptSchema.safeParse({version:BILLING_GUEST_V3,operationId:f.command.operationId,id:syntheticId(961),recordedAt:f.acceptance.acceptedAt,replayed:false,financialAcceptanceId:syntheticId(952)}).success).toBe(false);
 });
 it('rejects family/account/action overrides and missing parent affirmations in the financial command',()=>{
  const f=setup();expect(guestAcceptCommandSchema.parse(f.command)).toEqual(f.command);
  for(const extra of [{familyId:syntheticId(999)},{actorId:syntheticGuardian},{action:'submit_private_completion'}])expect(guestAcceptCommandSchema.safeParse({...f.command,...extra}).success).toBe(false);
  expect(guestAcceptCommandSchema.safeParse({...f.command,parent:{...f.command.parent,financialTermsAffirmed:false}}).success).toBe(false);
 });
 it('labels the immutable receipt unpaid-at-acceptance, without a current balance or delivery claim',()=>{
  const f=setup(),r={version:BILLING_GUEST_V3,operationId:f.command.operationId,acceptanceId:f.acceptance.id,quoteId:f.old.id,acceptedRevision:3,acceptedAt:f.acceptance.acceptedAt,replayed:false,paymentStateAtAcceptance:'unpaid'};
  expect(guestAcceptanceReceiptSchema.parse(r)).toEqual(r);expect(guestAcceptanceReceiptSchema.safeParse({...r,paymentStateAtAcceptance:'paid'}).success).toBe(false);expect(guestAcceptanceReceiptSchema.safeParse({...r,emailSent:true}).success).toBe(false);
 });
 it('requires explicit workspace/offer provenance and exact obligation identities in the common payable basis',()=>{
  const f=setup();expect(guestPayableBasisSchema.parse(f.basis)).toEqual(f.basis);
  expect(guestPayableBasisSchema.safeParse({...f.basis,workspaceId:undefined}).success).toBe(false);expect(guestPayableBasisSchema.safeParse({...f.basis,workspaceId:syntheticId(999)}).success).toBe(false);
  expect(guestPayableBasisSchema.safeParse({...f.basis,obligationLineIds:[f.basis.obligationLineIds[0],f.basis.obligationLineIds[0]]}).success).toBe(false);
 });
 it('preserves explicit historical account provenance instead of manufacturing a guest bridge',()=>{
  const f=setup(),basis={...f.basis,acceptance:{kind:'historical_account',quoteSourceVersion:BILLING_DTO_VERSION,originalQuoteSha256:'a'.repeat(64),actorAccountId:syntheticGuardian,acceptedAt:f.acceptance.acceptedAt,quoteRevision:2,terms:f.old.definition.terms}};
  expect(guestPayableBasisSchema.parse(basis).acceptance.kind).toBe('historical_account');expect(guestPayableBasisSchema.safeParse({...basis,acceptance:{...basis.acceptance,quoteSourceVersion:BILLING_GUEST_V3}}).success).toBe(false);
 });
 it('derives account provenance from the actual original snapshot without mutating or reaccepting it',()=>{
  const original=syntheticAccepted(),before=JSON.stringify(original),basis=projectHistoricalAccountPayableBasis(original);
  expect(basis.acceptance).toMatchObject({kind:'historical_account',actorAccountId:syntheticGuardian});expect(verifyGuestPayableBasis(basis,original)).toEqual(basis);expect(JSON.stringify(original)).toBe(before);
  expect(()=>verifyGuestPayableBasis(basis)).toThrow();expect(()=>projectHistoricalAccountPayableBasis(setup().old)).toThrow();
 });
 it('cannot replace an original accepting account or immutable snapshot hash through the common projection',()=>{
  const original=syntheticAccepted(),basis=projectHistoricalAccountPayableBasis(original);if(basis.acceptance.kind!=='historical_account')throw Error('fixture');
  expect(()=>verifyGuestPayableBasis({...basis,acceptance:{...basis.acceptance,actorAccountId:syntheticId(999)}},original)).toThrow();expect(()=>verifyGuestPayableBasis({...basis,acceptance:{...basis.acceptance,originalQuoteSha256:'f'.repeat(64)}},original)).toThrow();
 });
 it('authenticates guest basis material and evidence without synthesizing an old account snapshot',()=>{
  const f=setup();expect(verifyGuestPayableBasis(f.basis)).toEqual(f.basis);const basis=structuredClone(f.basis);basis.offer.sha256='f'.repeat(64);basis.acceptance.evidence.offer.sha256='f'.repeat(64);basis.acceptance.evidence.displayed.offerSnapshotSha256='f'.repeat(64);expect(()=>verifyGuestPayableBasis(basis)).toThrow();
 });
 it('requires the explicit guest read version and joined current quote/balance scope',()=>{
  const f=setup(),balance={...projectBalanceV2(syntheticAccepted(),[]),version:BILLING_GUEST_V3},current={quote:f.guest,balance,receiptId:null};
  expect(guestOwnerSnapshotV3Schema.parse(current)).toEqual(current);expect(guestOwnerSnapshotV3Schema.safeParse({...current,balance:{...balance,version:'JLFA-FISHING-BILLING-DTO-v2'}}).success).toBe(false);
  expect(guestOwnerSnapshotV3Schema.safeParse({...current,balance:{...balance,familyId:syntheticId(999)}}).success).toBe(false);
 });
 it('withholds a stale balance or mismatched child/period line in a guest read',()=>{
  const f=setup(),balance={...projectBalanceV2(syntheticAccepted(),[]),version:BILLING_GUEST_V3},current={quote:f.guest,balance,receiptId:null};
  expect(guestOwnerSnapshotV3Schema.safeParse({...current,balance:{...balance,revision:2}}).success).toBe(false);
  const tampered=structuredClone(current);tampered.balance.lines[0]!.childId=syntheticId(999);expect(guestOwnerSnapshotV3Schema.safeParse(tampered).success).toBe(false);
 });
});
