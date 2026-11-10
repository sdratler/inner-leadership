import 'server-only';
import { z } from 'zod';
import { AppError } from './errors.ts';
import { privateDigest } from '../features/contact-ops/server/digests.ts';
import { AcademyCrmStore } from '../features/contact-ops/server/academy-crm-store.ts';
import { ContactCutoverStore } from '../features/contact-ops/server/cutover-store.ts';
import { readCutoverState } from '../features/contact-ops/server/cutover-state.ts';
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
  const applications = new PublicGroupApplicationStore(db, config.workspaceId, ring, key, clock, false, undefined, ACADEMY_CRM_PROGRAM);
  const item = await applications.readForOwner(actor, reference);
  if (!isTrip390Interest(item.fields) || !isCurrentTrip390Interest(item.fields)) throw new AppError('NOT_FOUND');
  if (privateDigest({ workspaceId: config.workspaceId, record: item }, key) !== preview.sourceDigest) throw new AppError('CONFLICT');
  let association: FishingInquiryFamilyProposal | null = null;
  try { association = await new FishingBillingInquiryFamilyProposals(db, config.workspaceId, ring, key, clock).read(actor, { reference, expectedEpoch: state.epoch }); }
  catch (error) { if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error; }
  const data = nativeFamilyOwnerSourceSchema.parse({ version: NATIVE_FAMILY_OWNER_SOURCE_VERSION, kind: 'family_source', reference,
    expectedEpoch: state.epoch, sourceDigest: preview.sourceDigest, guardianName: item.fields.guardianName, messageLanguage: item.fields.messageLanguage,
    children: item.fields.children.map(({ id, name, ageYears }) => ({ id, name, ageYears })), contactAdmission: preview.existingPersonId === null ? 'required' : 'admitted', association });
  const initializationId = state.academy.operationId;
  // Optional absence may have aborted its inner transaction before any
  // terminal guard. Always finish with a successful guarded READ ONLY TX:
  // verify source/cutover again, then the compositor's configured owner and
  // actual session/non-demo check runs after all IO before any PII is returned.
  return db.transaction(async tx => {
    await tx.query('SET TRANSACTION READ ONLY');
    const current = await readCutoverState(tx, config.workspaceId, ring, false);
    if (current.phase !== 'academy_native' || current.epoch !== state.epoch || current.academy?.operationId !== initializationId) throw new AppError('CONFLICT');
    const inquiry = await applications.readForOwnerInTransaction(tx, actor, reference);
    if (privateDigest({ workspaceId: config.workspaceId, record: inquiry }, key) !== preview.sourceDigest) throw new AppError('CONFLICT');
    return data;
  });
}
