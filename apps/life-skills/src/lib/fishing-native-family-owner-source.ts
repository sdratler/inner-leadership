import 'server-only';
import { z } from 'zod';
import { AppError } from './errors.ts';
import { privateDigest } from '../features/contact-ops/server/digests.ts';
import { AcademyCrmStore } from '../features/contact-ops/server/academy-crm-store.ts';
import { ContactCutoverStore } from '../features/contact-ops/server/cutover-store.ts';
import { ACADEMY_CRM_PROGRAM } from '../features/contact-ops/core/academy-crm.ts';
import { PublicGroupApplicationStore } from '../features/group-application/store.ts';
import { isCurrentTrip390Interest } from '../features/group-application/academy-trip390-contract.ts';
import { isTrip390Interest } from '../features/group-application/contract.ts';
import type { FishingInquiryFamilyProposal } from '../features/fishing-billing/inquiry-family-contract-v1.ts';
import type { GroupPreparationIdentityRuntime } from './fishing-group-preparation-owner-runtime.ts';
import type { Actor } from '../features/identity/types.ts';
import type { IdentityStore } from '../features/identity/store.ts';
import { FishingBillingInquiryFamilyProposals } from './fishing-billing-inquiry-family-proposal.ts';
import { NATIVE_FAMILY_OWNER_SOURCE_VERSION, nativeFamilyOwnerSourceSchema } from '../features/fishing-billing/native-family-owner-source-contract.ts';

/** Current owner display context, not a guardian, recipient or financial grant.
 * Each supplied guarded DB transaction rechecks the actual configured owner at
 * exit. The original digest/epoch must still match at the later explicit save. */
export async function readFishingNativeFamilyOwnerSource(
  db: IdentityStore, runtime: Pick<GroupPreparationIdentityRuntime, 'config' | 'clock'>, actor: Actor, reference: string,
) {
  if (!z.uuid().safeParse(reference).success || reference !== reference.toLowerCase()) throw new AppError('INVALID_REQUEST');
  const { config, clock } = runtime, key = config.lookupKey.toString('hex'), ring = config.keyring;
  const state = await new ContactCutoverStore(db, ring, key, clock).read(actor);
  if (state.phase !== 'academy_native' || !state.academy) throw new AppError('UNAVAILABLE');
  const preview = await new AcademyCrmStore(db, ring, key, clock).previewInquiry(actor, reference, state.epoch);
  const item = await new PublicGroupApplicationStore(db, config.workspaceId, ring, key, clock, false, undefined, ACADEMY_CRM_PROGRAM).readForOwner(actor, reference);
  if (!isTrip390Interest(item.fields) || !isCurrentTrip390Interest(item.fields)) throw new AppError('NOT_FOUND');
  if (privateDigest({ workspaceId: config.workspaceId, record: item }, key) !== preview.sourceDigest) throw new AppError('CONFLICT');
  let association: FishingInquiryFamilyProposal | null = null;
  try { association = await new FishingBillingInquiryFamilyProposals(db, config.workspaceId, ring, key, clock).read(actor, { reference, expectedEpoch: state.epoch }); }
  catch (error) { if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error; }
  return nativeFamilyOwnerSourceSchema.parse({ version: NATIVE_FAMILY_OWNER_SOURCE_VERSION, kind: 'family_source', reference,
    expectedEpoch: state.epoch, sourceDigest: preview.sourceDigest, guardianName: item.fields.guardianName, messageLanguage: item.fields.messageLanguage,
    children: item.fields.children.map(({ id, name, ageYears }) => ({ id, name, ageYears })), contactAdmission: preview.existingPersonId === null ? 'required' : 'admitted', association });
}
