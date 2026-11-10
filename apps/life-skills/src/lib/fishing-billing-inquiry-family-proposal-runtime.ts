import 'server-only';
import type { identityRuntime } from '../features/identity/runtime.ts';
import { FishingBillingInquiryFamilyProposals } from './fishing-billing-inquiry-family-proposal.ts';
import type { FishingInquiryFamilyProposalOwnerHttpDependencies } from './fishing-billing-inquiry-family-proposal-owner-http.ts';

type NativeRuntime = Pick<Awaited<ReturnType<typeof identityRuntime>>, 'config' | 'services' | 'store' | 'clock'>;

/** Bind existing native dependencies only. The store requires current Academy
 * cutover, owner, source and membership evidence in its transaction. This
 * composition neither initializes storage nor promotes a proposed association
 * to guardian, recipient or financial authority. */
export function composeFishingInquiryFamilyProposalOwnerRuntime(runtime: NativeRuntime): FishingInquiryFamilyProposalOwnerHttpDependencies {
  const { config, services, store, clock } = runtime;
  return {
    origin: config.origin, sessions: services.sessions, limits: services.limits, rateLimitKey: config.rateLimitKey,
    store: new FishingBillingInquiryFamilyProposals(store, config.workspaceId, config.keyring, config.lookupKey.toString('hex'), clock),
  };
}
