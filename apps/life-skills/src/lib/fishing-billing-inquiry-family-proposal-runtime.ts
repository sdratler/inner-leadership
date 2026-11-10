import 'server-only';
import type { GroupPreparationIdentityRuntime } from './fishing-group-preparation-owner-runtime.ts';
import type { Actor } from '../features/identity/types.ts';
import type { IdentityStore } from '../features/identity/store.ts';
import { FishingBillingInquiryFamilyProposals } from './fishing-billing-inquiry-family-proposal.ts';
import type { FishingInquiryFamilyProposalOwnerHttpDependencies } from './fishing-billing-inquiry-family-proposal-owner-http.ts';
import { assertCurrentFishingOwner, boundFishingOwner, configuredFishingOwnerBinding, type FishingOwnerEnvironment } from './fishing-owner-boundary.ts';
import { readFishingNativeFamilyOwnerSource } from './fishing-native-family-owner-source.ts';

type NativeRuntime = GroupPreparationIdentityRuntime;

/** Bind existing native dependencies only. The store requires current Academy
 * cutover, owner, source and membership evidence in its transaction. This
 * composition neither initializes storage nor promotes a proposed association
 * to guardian, recipient or financial authority. */
export function composeFishingInquiryFamilyProposalOwnerRuntime(runtime: NativeRuntime, env: FishingOwnerEnvironment): FishingInquiryFamilyProposalOwnerHttpDependencies {
  const { config, services, store, clock } = runtime;
  const binding = configuredFishingOwnerBinding(config.workspaceId, env);
  function guardedDatabase(actor: Actor, intent: 'read' | 'write'): IdentityStore {
    const owner = boundFishingOwner(binding, actor);
    const guarded: IdentityStore = { transaction: work => store.transaction(async tx => {
      // The native class first establishes its READ ONLY/write transaction and
      // completes all existing cutover/source checks. Do not add writes before it.
      const result = await work(tx);
      await assertCurrentFishingOwner(tx, binding, owner, intent, clock);
      return result;
    }) };
    return guarded;
  }
  function guardedStore(actor: Actor, intent: 'read' | 'write') {
    return new FishingBillingInquiryFamilyProposals(guardedDatabase(actor, intent), config.workspaceId, config.keyring, config.lookupKey.toString('hex'), clock);
  }
  return {
    origin: config.origin, sessions: {
      async actor(token) {
        const owner = boundFishingOwner(binding, await services.sessions.actor(token));
        await store.transaction(async tx => {
          await tx.query('SET TRANSACTION READ ONLY');
          await assertCurrentFishingOwner(tx, binding, owner, 'read', clock);
        });
        return owner;
      },
      csrf: token => services.sessions.csrf(token),
    }, limits: services.limits, rateLimitKey: config.rateLimitKey,
    source: (actor, reference) => readFishingNativeFamilyOwnerSource(guardedDatabase(actor, 'read'), runtime, actor, reference),
    store: {
      read: (actor, input) => guardedStore(actor, 'read').read(actor, input),
      preview: (actor, input) => guardedStore(actor, 'read').preview(actor, input),
      propose: (actor, input) => guardedStore(actor, 'write').propose(actor, input),
      createNativeFamily: (actor, input) => guardedStore(actor, 'write').createNativeFamily(actor, input),
    },
  };
}
