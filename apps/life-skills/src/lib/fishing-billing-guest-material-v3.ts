import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {familyOfferSchema,BILLING_DTO_VERSION} from '../features/fishing-billing/contracts.ts';
import {guestOfferBindingSchema,guestIssuedMaterialSchema,guestDisplayBundleSchema,guestFinancialAcceptanceSchema,guestGrantRecordSchema,guestFamilyOfferSchema,
 guestPayableBasisSchema,BILLING_GUEST_V3,type GuestPayableBasis,
 type GuestOfferBinding,type GuestDisplayBundle,type GuestFinancialAcceptance,type GuestGrantRecord,type GuestFamilyOffer} from './fishing-billing-guest-contract-v3.ts';

function canonical(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
}
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export function bindGuestIssuedMaterial(raw:unknown):GuestOfferBinding{
 const material=guestIssuedMaterialSchema.parse(raw);return {material,sha256:hash(material)};
}
/** The actual native grant/quote resolver must call this in addition to schema
 * parsing. A matching hash proves integrity, not native or legal authority. */
export function verifyGuestIssuedMaterial(raw:unknown):GuestOfferBinding{
 const binding=guestOfferBindingSchema.parse(raw);if(hash(binding.material)!==binding.sha256)throw new AppError('UNAVAILABLE');return binding;
}
export function bindGuestDisplayBundle(raw:unknown):GuestDisplayBundle{
 const {sha256,...shape}=guestDisplayBundleSchema.shape;void sha256;
 const material=z.object(shape).strict().parse(raw);
 return guestDisplayBundleSchema.parse({...material,sha256:hash(material)});
}
export function verifyGuestDisplayBundle(raw:unknown):GuestDisplayBundle{
 const bundle=guestDisplayBundleSchema.parse(raw),{sha256,...material}=bundle;
 if(hash(material)!==sha256)throw new AppError('UNAVAILABLE');return bundle;
}
export function verifyGuestFinancialAcceptance(raw:unknown):GuestFinancialAcceptance{
 const acceptance=guestFinancialAcceptanceSchema.parse(raw);verifyGuestIssuedMaterial(acceptance.offer);verifyGuestDisplayBundle(acceptance.displayed);return acceptance;
}
export function verifyGuestGrantRecord(raw:unknown):GuestGrantRecord{
 const grant=guestGrantRecordSchema.parse(raw);verifyGuestIssuedMaterial(grant.offer);verifyGuestDisplayBundle(grant.displayBundle);return grant;
}
export function verifyGuestFamilyOffer(raw:unknown):GuestFamilyOffer{
 const quote=guestFamilyOfferSchema.parse(raw);if(quote.acceptance)verifyGuestFinancialAcceptance(quote.acceptance);return quote;
}
/** Pure read projection of an existing account acceptance. Caller must obtain
 * the original snapshot through an authenticated native decoder/journal. This
 * does not write, migrate or re-accept it, or infer account/family authority. */
export function projectHistoricalAccountPayableBasis(raw:unknown):GuestPayableBasis{
 const quote=familyOfferSchema.parse(raw),a=quote.acceptance;if(!a||!quote.issuedAt)throw new AppError('UNAVAILABLE');
 const offer=bindGuestIssuedMaterial({workspaceId:quote.workspaceId,familyId:quote.familyId,quoteId:quote.id,issuedRevision:a.quoteRevision,
  definition:quote.definition,lines:quote.lines,createdAt:quote.createdAt,issuedAt:quote.issuedAt,override:quote.override});
 return guestPayableBasisSchema.parse({version:BILLING_GUEST_V3,workspaceId:quote.workspaceId,familyId:quote.familyId,quoteId:quote.id,offer,obligationLineIds:quote.lines.map(l=>l.id),
  acceptance:{kind:'historical_account',quoteSourceVersion:BILLING_DTO_VERSION,originalQuoteSha256:hash(quote),actorAccountId:a.actorId,acceptedAt:a.acceptedAt,quoteRevision:a.quoteRevision,terms:a.terms}});
}
export function verifyGuestPayableBasis(raw:unknown,originalAccountSnapshot?:unknown):GuestPayableBasis{
 const basis=guestPayableBasisSchema.parse(raw);verifyGuestIssuedMaterial(basis.offer);
 if(basis.acceptance.kind==='guest_successor')verifyGuestFinancialAcceptance(basis.acceptance.evidence);
 else if(canonical(projectHistoricalAccountPayableBasis(originalAccountSnapshot))!==canonical(basis))throw new AppError('UNAVAILABLE');
 return basis;
}
