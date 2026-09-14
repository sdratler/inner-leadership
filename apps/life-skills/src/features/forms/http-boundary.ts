import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { failureResponse, successResponse } from "../../lib/http/json.ts";
import { writeAudit, type AuditSink } from "../../lib/audit.ts";
import { newRequestId, type RequestId } from "../../lib/ids.ts";
import { verifyCsrfToken, verifyMutationOrigin } from "../../lib/security/csrf.ts";
import { enforceRateLimit, opaqueRateLimitKey, type RateLimitStore } from "../../lib/security/rate-limit.ts";
import { SESSION_COOKIE } from "../../lib/security/session.ts";
import type { IdentityConfig } from "../identity/config.ts";
import type { IdentitySessions } from "../identity/session-adapter.ts";
import type { Actor, IdentityClock } from "../identity/types.ts";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface Ls050HttpRuntime {
  config: IdentityConfig;
  sessions: Pick<IdentitySessions, "actor" | "csrf">;
  limits: RateLimitStore;
  audit: AuditSink;
  clock: IdentityClock;
}

export interface Ls050HttpResult {
  data: unknown;
  status?: number;
}

function sessionCookie(request: Request): string {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) throw new AppError("UNAUTHENTICATED");
  const value = matches[0]!.slice(SESSION_COOKIE.length + 1);
  if (!TOKEN_PATTERN.test(value)) throw new AppError("UNAUTHENTICATED");
  return value;
}

function secure(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  return response;
}

/** Shared only by the three LS-050 APIs. Authentication facts always come from the server session. */
export class Ls050HttpBoundary {
  constructor(private readonly runtime: Ls050HttpRuntime) {}

  async handle(
    request: Request,
    methods: readonly string[],
    dispatch: (actor: Actor, requestId: RequestId, url: URL) => Promise<Ls050HttpResult>,
  ): Promise<Response> {
    const requestId = newRequestId();
    let actor: Actor | undefined;
    try {
      if (!methods.includes(request.method)) throw new AppError("NOT_FOUND");
      const url = new URL(request.url);
      if (!this.runtime.config.enabled || url.origin !== this.runtime.config.origin || url.hash) throw new AppError("INVALID_REQUEST");
      const token = sessionCookie(request);
      actor = await this.runtime.sessions.actor(token);
      await enforceRateLimit(
        this.runtime.limits,
        opaqueRateLimitKey(`ls050:${actor.id}`, this.runtime.config.rateLimitKey),
        150,
        15 * 60 * 1000,
      );
      if (request.method !== "GET") {
        verifyMutationOrigin(request, this.runtime.config.origin);
        verifyCsrfToken(request.headers.get("x-csrf-token"), this.runtime.sessions.csrf(token));
      }
      const result = await dispatch(actor, requestId, url);
      return secure(successResponse(result.data, requestId, result.status ?? 200));
    } catch (error) {
      if (actor && error instanceof AppError && ["NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED"].includes(error.code)) {
        try {
          await writeAudit(this.runtime.audit, {
            eventId: randomUUID(),
            workspaceId: actor.workspaceId,
            actorAccountId: actor.id,
            requestId,
            kind: "access_denied",
            outcome: "denied",
            occurredAt: this.runtime.clock.now().toISOString(),
          });
        } catch {
          return secure(failureResponse(new AppError("UNAVAILABLE"), requestId));
        }
      }
      return secure(failureResponse(error, requestId));
    }
  }
}
