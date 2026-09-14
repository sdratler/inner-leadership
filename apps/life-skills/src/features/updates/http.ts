import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAudit, type AuditSink } from "../../lib/audit.ts";
import { AppError } from "../../lib/errors.ts";
import { failureResponse, readJson, successResponse } from "../../lib/http/json.ts";
import { asId, newRequestId } from "../../lib/ids.ts";
import { verifyCsrfToken, verifyMutationOrigin } from "../../lib/security/csrf.ts";
import { enforceRateLimit, opaqueRateLimitKey, type RateLimitStore } from "../../lib/security/rate-limit.ts";
import { SESSION_COOKIE } from "../../lib/security/session.ts";
import type { IdentityConfig } from "../identity/config.ts";
import { TOKEN_PATTERN } from "../identity/crypto.ts";
import type { IdentitySessions } from "../identity/session-adapter.ts";
import type { Actor, IdentityClock } from "../identity/types.ts";
import type { UpdateService } from "./service.ts";

const id = <K extends string>(kind: K) => z.string().uuid().transform(value => asId(value, kind));
const caseId = id("case");
const audienceId = id("audience");
const practiceVersionId = id("practice_version");
const reportId = id("parent_report");
const replyId = id("update_reply");
const body = z.string().trim().min(1).max(8_000);
const idempotencyKey = z.string().uuid();

export const updateActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit_report"), caseId, audienceId, practiceVersionId, body, eventAt: z.iso.datetime({ offset: true }).nullable().optional(), idempotencyKey }).strict(),
  z.object({ action: z.literal("review"), reportId }).strict(),
  z.object({ action: z.literal("reply"), reportId, body, publish: z.boolean(), supersedesReplyId: replyId.optional(), idempotencyKey }).strict(),
  z.object({ action: z.literal("publish_reply"), replyId }).strict(),
  z.object({ action: z.literal("adapt"), reportId, adaptedInstructions: body, idempotencyKey }).strict(),
]);

export interface Ls080HttpServices {
  sessions: IdentitySessions;
  limits: RateLimitStore;
  audit: AuditSink;
  updates: UpdateService;
}

function cookie(request: Request): string | undefined {
  const matches = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(SESSION_COOKIE + "="));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(SESSION_COOKIE.length + 1);
  return TOKEN_PATTERN.test(value) ? value : undefined;
}

function secure(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  return response;
}

function exactListQuery(url: URL) {
  if ([...url.searchParams.keys()].length !== 2 || !url.searchParams.has("caseId") || !url.searchParams.has("audienceId")) throw new AppError("INVALID_REQUEST");
  const result = z.object({ caseId, audienceId }).strict().safeParse(Object.fromEntries(url.searchParams));
  if (!result.success) throw new AppError("INVALID_REQUEST");
  return result.data;
}

export class Ls080Http {
  constructor(private readonly config: IdentityConfig, private readonly clock: IdentityClock, private readonly services: Ls080HttpServices) {}

  async handle(request: Request): Promise<Response> {
    const requestId = newRequestId();
    let actor: Actor | undefined;
    try {
      if (!this.config.enabled) throw new AppError("UNAVAILABLE");
      const url = new URL(request.url);
      if (url.origin !== this.config.origin || url.pathname !== "/api/updates" || !["GET", "POST"].includes(request.method)) throw new AppError("NOT_FOUND");
      if (request.method === "POST" && url.search) throw new AppError("INVALID_REQUEST");
      const token = cookie(request);
      if (!token) throw new AppError("UNAUTHENTICATED");
      actor = await this.services.sessions.actor(token);
      await enforceRateLimit(this.services.limits, opaqueRateLimitKey(`ls080:${actor.id}`, this.config.rateLimitKey), 120, 900_000);
      let data: unknown;
      if (request.method === "GET") {
        const query = exactListQuery(url);
        data = await this.services.updates.list(actor, query.caseId, query.audienceId);
      } else {
        verifyMutationOrigin(request, this.config.origin);
        verifyCsrfToken(request.headers.get("x-csrf-token"), this.services.sessions.csrf(token));
        const input = await readJson(request, updateActionSchema);
        if (input.action === "submit_report") data = await this.services.updates.submitParentReport(actor, input, requestId);
        else if (input.action === "review") data = await this.services.updates.review(actor, input.reportId, requestId);
        else if (input.action === "reply") data = await this.services.updates.replyToReport(actor, input, requestId);
        else if (input.action === "publish_reply") data = await this.services.updates.publishReply(actor, input.replyId, requestId);
        else data = await this.services.updates.adapt(actor, input, requestId);
      }
      return secure(successResponse(data, requestId, request.method === "POST" ? 201 : 200));
    } catch (error) {
      if (actor && error instanceof AppError && ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) {
        try {
          await writeAudit(this.services.audit, { eventId: randomUUID(), requestId, workspaceId: actor.workspaceId, actorAccountId: actor.id, kind: "access_denied", outcome: "denied", occurredAt: this.clock.now().toISOString() });
        } catch { return secure(failureResponse(new AppError("UNAVAILABLE"), requestId)); }
      }
      return secure(failureResponse(error, requestId));
    }
  }
}
