import 'server-only';
import { configuredFishingOwnerBinding, isCurrentNativeFishingOwner } from './fishing-owner-boundary.ts';
import type { RateLimitStore } from './security/rate-limit.ts';
import type { FishingGroupPreparationOwnerHttpDeps } from './fishing-group-preparation-owner-http.ts';
import { GROUP_PREPARATION_PROGRAM, groupPreparationId } from '../features/fishing-billing/group-preparation-contract.ts';
import { FishingGroupPreparationStore, type GroupPreparationOwnerAuthority } from '../features/fishing-billing/group-preparation-store.ts';
import type { IdentityConfig } from '../features/identity/config.ts';
import type { IdentitySessions } from '../features/identity/session-adapter.ts';
import type { IdentityStore, SqlSession } from '../features/identity/store.ts';
import type { IdentityClock } from '../features/identity/types.ts';

type ServerEnvironment = Readonly<Record<string, string | undefined>>;
export type GroupPreparationIdentityRuntime = {
  config: Pick<IdentityConfig, 'origin' | 'workspaceId' | 'keyring' | 'lookupKey' | 'rateLimitKey'>;
  store: IdentityStore; clock: IdentityClock;
  services: { sessions: Pick<IdentitySessions, 'actor' | 'csrf'>; limits: RateLimitStore };
};

/** Reuse the existing configured Fishing owner boundary. Configuration never grants a role. */
export function configuredGroupPreparationOwnerAuthority(
  config: Pick<IdentityConfig, 'workspaceId'>, env: ServerEnvironment,
): GroupPreparationOwnerAuthority {
  const binding = Object.freeze({ ...configuredFishingOwnerBinding(config.workspaceId, env), programKey: GROUP_PREPARATION_PROGRAM });

  async function currentOwner(tx: SqlSession, scope: { workspaceId: string; accountId: string; programKey: string }) {
    if (scope.workspaceId !== binding.workspaceId || scope.accountId !== binding.accountId || scope.programKey !== binding.programKey) return false;
    // This account lock pins active role and conflicts with demo-marker FK insertion.
    // The reviewed store independently pins the real session/person and rechecks all guards at exit.
    return isCurrentNativeFishingOwner(tx, binding, 'update');
  }
  return Object.freeze({
    async isCurrentOwner(tx, scope) {
      if (!['create', 'edit', 'cancel', 'read'].includes(scope.action) || !groupPreparationId.safeParse(scope.groupId).success) return false;
      return currentOwner(tx, scope);
    },
    async canListPreparations(tx, scope) {
      if (scope.action !== 'list' || scope.groupId !== null) return false;
      return currentOwner(tx, scope);
    },
  } satisfies GroupPreparationOwnerAuthority);
}

/** Compose resolved native dependencies without loading providers, reading global env or creating storage. */
export function composeFishingGroupPreparationOwnerRuntime(
  runtime: GroupPreparationIdentityRuntime, env: ServerEnvironment,
): FishingGroupPreparationOwnerHttpDeps {
  const { config, services } = runtime;
  const authority = configuredGroupPreparationOwnerAuthority(config, env);
  return {
    origin: config.origin, actor: token => services.sessions.actor(token), csrf: token => services.sessions.csrf(token),
    limits: services.limits, rateLimitKey: config.rateLimitKey,
    store: new FishingGroupPreparationStore(runtime.store, config.workspaceId, config.keyring, config.lookupKey.toString('hex'), authority, runtime.clock),
  };
}
