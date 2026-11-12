import 'server-only';
import { asId } from './ids.ts';
import type { GroupPreparationIdentityRuntime } from './fishing-group-preparation-owner-runtime.ts';
import type { FishingProgramSourceOwnerHttpDependencies } from './fishing-program-source-owner-http.ts';
import { assertCurrentFishingOwner, boundFishingOwner, configuredFishingOwnerBinding, type FishingOwnerEnvironment } from './fishing-owner-boundary.ts';
import { FishingProgramSourceNativeV3 } from '../features/fishing-billing/program-source-native-v3.ts';

export function composeFishingProgramSourceOwnerRuntime(runtime: GroupPreparationIdentityRuntime, env: FishingOwnerEnvironment): FishingProgramSourceOwnerHttpDependencies {
  const { config, services, store, clock } = runtime, binding = configuredFishingOwnerBinding(config.workspaceId, env);
  return {
    origin: config.origin, rateLimitKey: config.rateLimitKey, limits: services.limits,
    sessions: {
      async actor(token) {
        const owner = boundFishingOwner(binding, await services.sessions.actor(token));
        await store.transaction(async tx => {
          await tx.query('SET TRANSACTION READ ONLY');
          await assertCurrentFishingOwner(tx, binding, owner, 'read', clock);
        });
        return owner;
      },
      csrf: token => services.sessions.csrf(token),
    },
    store: new FishingProgramSourceNativeV3(store, config.workspaceId, config.keyring, config.lookupKey.toString('hex'), asId(binding.accountId, 'account'), clock),
  };
}
