import 'server-only';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.ts';
import { failureResponse, readJson, successResponse } from './http/json.ts';
import { verifyCsrfToken, verifyMutationOrigin } from './security/csrf.ts';
import { SESSION_COOKIE } from './security/session.ts';
import { enforceRateLimit, opaqueRateLimitKey, type RateLimitStore } from './security/rate-limit.ts';
import { TOKEN_PATTERN } from '../features/identity/crypto.ts';
import type { IdentitySessions } from '../features/identity/session-adapter.ts';
import { canonicalForwardedRequest } from '../features/integration/canonical-forwarded-request.ts';
import { billingId } from '../features/fishing-billing/contracts.ts';
import { PROGRAM_SOURCE_V3, programSourceCommandV3Schema } from '../features/fishing-billing/program-source-contract-v3.ts';
import { PROGRAM_SOURCE_OWNER_PATH, programSourceGroupDataV3Schema, programSourceRecordedDataV3Schema, programSourceNativeOutcomeV3Schema, programSourceRejectedDataV3Schema, type ProgramSourceSaveDataV3 } from '../features/fishing-billing/program-source-owner-contract-v3.ts';
import type { FishingProgramSourceNativeV3 } from '../features/fishing-billing/program-source-native-v3.ts';
import { OWNER_LOCATION_PLANNING_PREFIX, ownerLocationPlanningSource } from '../features/fishing-billing/owner-location-planning-source.ts';

export type FishingProgramSourceOwnerHttpDependencies = {
  origin: string; sessions: Pick<IdentitySessions, 'actor' | 'csrf'>; limits: RateLimitStore; rateLimitKey: string;
  store: Pick<FishingProgramSourceNativeV3, 'readGroup' | 'record'> & Partial<Pick<FishingProgramSourceNativeV3, 'recordOutcome'>>;
};

/** Scheduling facts only; never a group activation, paid seat, readiness or send. */
export async function fishingProgramSourceOwnerHttp(request: Request, load: () => Promise<FishingProgramSourceOwnerHttpDependencies>): Promise<Response> {
  const requestId = randomUUID(); let response: Response, invoked = false;
  try {
    const cookies = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.split('=', 1)[0]?.trim() === SESSION_COOKIE);
    if (cookies.length !== 1 || !cookies[0]!.startsWith(SESSION_COOKIE + '=')) throw new AppError('UNAUTHENTICATED');
    const token = cookies[0]!.slice(SESSION_COOKIE.length + 1);
    if (!TOKEN_PATTERN.test(token)) throw new AppError('UNAUTHENTICATED');
    if (new URL(request.url).hash) throw new AppError('NOT_FOUND');
    const d = await load(), canonical = canonicalForwardedRequest(request, d.origin), url = new URL(canonical.url);
    if (url.origin !== d.origin || url.pathname !== PROGRAM_SOURCE_OWNER_PATH) throw new AppError('NOT_FOUND');
    if (request.method !== 'GET' && request.method !== 'POST') throw new AppError('INVALID_REQUEST');
    const actor = Object.freeze({ ...await d.sessions.actor(token) });
    if (actor.role !== 'practitioner' || actor.state !== 'active') throw new AppError('FORBIDDEN');
    const rateKey = opaqueRateLimitKey(`fishing-program-source:${actor.workspaceId}:${actor.id}:${request.method}`, d.rateLimitKey);
    if (request.method === 'GET') {
      const parsed = billingId.safeParse(url.searchParams.get('groupId'));
      if (url.searchParams.size !== 1 || url.searchParams.getAll('groupId').length !== 1 || !parsed.success || parsed.data !== parsed.data.toLowerCase()) throw new AppError('INVALID_REQUEST');
      await enforceRateLimit(d.limits, rateKey, 60, 60_000);
      const data = programSourceGroupDataV3Schema.parse({ ...await d.store.readGroup(actor, parsed.data), kind: 'group_source' });
      if (data.group.record.workspaceId !== actor.workspaceId || data.group.record.command.groupId !== parsed.data) throw new AppError('UNAVAILABLE');
      response = successResponse(data, requestId);
    } else {
      if (url.search) throw new AppError('INVALID_REQUEST');
      verifyMutationOrigin(canonical, d.origin); verifyCsrfToken(request.headers.get('x-csrf-token'), d.sessions.csrf(token));
      await enforceRateLimit(d.limits, rateKey, 20, 60_000);
      const command = await readJson(request, programSourceCommandV3Schema);
      if (command.kind === 'group' && command.fields.venueSource.id.startsWith(OWNER_LOCATION_PLANNING_PREFIX)) {
        const source = await ownerLocationPlanningSource({ workspaceId: actor.workspaceId, ownerAccountId: actor.id, groupId: command.groupId, operationId: command.operationId, location: command.fields.location });
        if (source.id !== command.fields.venueSource.id || source.sha256 !== command.fields.venueSource.sha256) throw new AppError('INVALID_REQUEST');
      }
      invoked = true;
      let data: ProgramSourceSaveDataV3;
      if (d.store.recordOutcome) {
        const outcome = programSourceNativeOutcomeV3Schema.parse(await d.store.recordOutcome(actor, command));
        if (outcome.workspaceId !== actor.workspaceId || outcome.actorId !== actor.id || JSON.stringify(outcome.command) !== JSON.stringify(command)) throw new AppError('UNAVAILABLE');
        if (outcome.state === 'rejected') {
          // Explicit known rollback from the native provenance boundary only.
          // Keep it distinct from ordinary HTTP errors/uncertain transport.
          data = programSourceRejectedDataV3Schema.parse({ version: outcome.version, kind: 'rejected_source', workspaceId: outcome.workspaceId, actorId: outcome.actorId, command: outcome.command, code: outcome.code });
        } else data = programSourceRecordedDataV3Schema.parse({ ...outcome.receipt, version: PROGRAM_SOURCE_V3, kind: 'recorded_source' });
      } else data = programSourceRecordedDataV3Schema.parse({ ...await d.store.record(actor, command), version: PROGRAM_SOURCE_V3, kind: 'recorded_source' });
      if (data.kind === 'recorded_source' && (data.record.workspaceId !== actor.workspaceId || data.record.recordedBy !== actor.id || JSON.stringify(data.record.command) !== JSON.stringify(command))) throw new AppError('UNAVAILABLE');
      response = successResponse(data, requestId);
    }
  } catch (error) {
    response = failureResponse(invoked ? new AppError('UNAVAILABLE') : error instanceof AppError ? error : new AppError('UNAVAILABLE'), requestId);
  }
  response.headers.set('Vary', 'Cookie'); response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff'); response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return response;
}
