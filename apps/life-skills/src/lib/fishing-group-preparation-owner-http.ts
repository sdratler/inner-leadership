import 'server-only';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.ts';
import { failureResponse, readJson, successResponse } from './http/json.ts';
import { verifyCsrfToken, verifyMutationOrigin } from './security/csrf.ts';
import { SESSION_COOKIE } from './security/session.ts';
import { enforceRateLimit, opaqueRateLimitKey, type RateLimitStore } from './security/rate-limit.ts';
import { TOKEN_PATTERN } from '../features/identity/crypto.ts';
import type { Actor } from '../features/identity/types.ts';
import { canonicalForwardedRequest } from '../features/integration/canonical-forwarded-request.ts';
import {
  groupPreparationCommand, groupPreparationId, groupPreparationListPage, groupPreparationListQuery,
  groupPreparationRecord, groupPreparationRevision, type GroupPreparationCommand,
} from '../features/fishing-billing/group-preparation-contract.ts';
import type { FishingGroupPreparationStore } from '../features/fishing-billing/group-preparation-store.ts';

export const FISHING_GROUP_PREPARATION_OWNER_PATH = '/api/private/fishing-group-preparations';
export type FishingGroupPreparationOwnerHttpDeps = {
  origin: string; actor(token: string): Promise<Actor>; csrf(token: string): string;
  limits: RateLimitStore; rateLimitKey: string;
  store: Pick<FishingGroupPreparationStore, 'save' | 'read' | 'list'>;
};

function sessionToken(request: Request) {
  const cookies = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim())
    .filter(value => value.split('=', 1)[0]?.trim() === SESSION_COOKIE);
  if (cookies.length !== 1 || !cookies[0]!.startsWith(SESSION_COOKIE + '=')) throw new AppError('UNAUTHENTICATED');
  const token = cookies[0]!.slice(SESSION_COOKIE.length + 1);
  if (!TOKEN_PATTERN.test(token)) throw new AppError('UNAUTHENTICATED');
  return token;
}

function integer(value: string) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new AppError('INVALID_REQUEST');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new AppError('INVALID_REQUEST');
  return number;
}

function query(url: URL) {
  const params = url.searchParams, kind = params.get('kind');
  const allowed = kind === 'list' ? ['kind', 'version', 'limit', 'cursor'] : ['kind', 'groupId', 'revision'];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new AppError('INVALID_REQUEST');
  }
  if (kind === 'list') {
    const parsed = groupPreparationListQuery.safeParse({
      version: params.get('version'),
      ...(params.has('limit') ? { limit: integer(params.get('limit')!) } : {}),
      ...(params.has('cursor') ? { cursor: params.get('cursor') } : {}),
    });
    if (!parsed.success) throw new AppError('INVALID_REQUEST');
    return { kind, input: parsed.data } as const;
  }
  const id = groupPreparationId.safeParse(params.get('groupId'));
  if (kind !== 'record' || !id.success) throw new AppError('INVALID_REQUEST');
  const revision = params.has('revision') ? integer(params.get('revision')!) : undefined;
  if (revision !== undefined && !groupPreparationRevision.safeParse(revision).success) throw new AppError('INVALID_REQUEST');
  return { kind, groupId: id.data, revision } as const;
}

function record(value: unknown, actor: Actor, groupId: string, revision?: number) {
  const parsed = groupPreparationRecord.safeParse(value);
  if (!parsed.success || parsed.data.workspaceId !== actor.workspaceId || parsed.data.groupId !== groupId ||
      (revision !== undefined && parsed.data.revision !== revision)) throw new AppError('UNAVAILABLE');
  return parsed.data;
}

function savedRecord(value: Awaited<ReturnType<FishingGroupPreparationStore['save']>>, actor: Actor, command: GroupPreparationCommand) {
  const saved = record(value.record, actor, command.groupId, command.expectedRevision + 1);
  if (typeof value.replayed !== 'boolean' || saved.action !== command.action || saved.operationId !== command.operationId ||
      saved.recordedBy !== actor.id) throw new AppError('UNAVAILABLE');
  return { kind: 'saved' as const, replayed: value.replayed, record: saved };
}

/** Unmounted private adapter. Server composition supplies native session and current owner authority.
 * The store rechecks access inside its transaction. Saved preparation records grant no offer or seat authority. */
export async function fishingGroupPreparationOwnerHttp(
  request: Request, load: () => Promise<FishingGroupPreparationOwnerHttpDeps>,
): Promise<Response> {
  const requestId = randomUUID();
  let response: Response;
  try {
    const token = sessionToken(request), d = await load();
    if (new URL(request.url).hash) throw new AppError('NOT_FOUND');
    const canonical = canonicalForwardedRequest(request, d.origin), url = new URL(canonical.url);
    if (url.origin !== d.origin || url.pathname !== FISHING_GROUP_PREPARATION_OWNER_PATH) throw new AppError('NOT_FOUND');
    if (request.method !== 'GET' && request.method !== 'POST') throw new AppError('INVALID_REQUEST');
    const actor = Object.freeze({ ...await d.actor(token) });
    if (actor.role !== 'practitioner' || actor.state !== 'active') throw new AppError('FORBIDDEN');
    const key = opaqueRateLimitKey('fishing-group-preparation-owner:' + actor.workspaceId + ':' + actor.id, d.rateLimitKey);
    if (request.method === 'GET') {
      const read = query(url);
      await enforceRateLimit(d.limits, key, 60, 60_000);
      if (read.kind === 'record') {
        const found = record(await d.store.read(actor, read.groupId, read.revision), actor, read.groupId, read.revision);
        response = successResponse({ kind: 'record', record: found }, requestId);
      } else {
        const parsed = groupPreparationListPage.safeParse(await d.store.list(actor, read.input));
        if (!parsed.success) throw new AppError('UNAVAILABLE');
        const page = parsed.data;
        if (page.items.length > read.input.limit || (page.nextCursor !== null && page.items.length !== read.input.limit) ||
            page.items.some((item, index) => item.workspaceId !== actor.workspaceId ||
              (index > 0 && item.groupId <= page.items[index - 1]!.groupId))) throw new AppError('UNAVAILABLE');
        response = successResponse({ kind: 'list', page }, requestId);
      }
    } else {
      if (url.search) throw new AppError('INVALID_REQUEST');
      verifyMutationOrigin(canonical, d.origin);
      verifyCsrfToken(request.headers.get('x-csrf-token'), d.csrf(token));
      await enforceRateLimit(d.limits, key, 20, 60_000);
      const input = await readJson(request, groupPreparationCommand);
      const saved = await d.store.save(actor, input);
      try {
        // A successful save may be durable even when validation or serialization of its response fails.
        response = successResponse(savedRecord(saved, actor, input), requestId);
      } catch { throw new AppError('UNAVAILABLE'); }
    }
  } catch (error) {
    response = failureResponse(error instanceof AppError ? error : new AppError('UNAVAILABLE'), requestId);
  }
  response.headers.set('Vary', 'Cookie');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return response;
}
