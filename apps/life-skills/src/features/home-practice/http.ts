import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAudit, type AuditSink } from "../../lib/audit.ts";
import { AppError } from "../../lib/errors.ts";
import { failureResponse, readJson, successResponse } from "../../lib/http/json.ts";
import { asId, newRequestId } from "../../lib/ids.ts";
import { verifyCsrfToken, verifyMutationOrigin } from "../../lib/security/csrf.ts";
import { SESSION_COOKIE } from "../../lib/security/session.ts";
import { enforceRateLimit, opaqueRateLimitKey, type RateLimitStore } from "../../lib/security/rate-limit.ts";
import { completionModes, completionStatuses, occurrencePeriods } from "./types.ts";
import type { IdentityConfig } from "../identity/config.ts";
import { TOKEN_PATTERN } from "../identity/crypto.ts";
import type { IdentitySessions } from "../identity/session-adapter.ts";
import type { Actor, IdentityClock } from "../identity/types.ts";
import type { GoalService } from "../goals/service.ts";
import type { CommitmentService } from "../commitments/service.ts";
import type { CheckInService } from "../checkins/service.ts";
import type { HomePracticeService } from "./service.ts";

const id = <K extends string>(kind: K) => z.string().uuid().transform(value => asId(value, kind));
const caseId = id("case"), audienceId = id("audience"), goalId = id("goal"), commitmentId = id("commitment");
const assignmentId = id("practice_assignment"), versionId = id("practice_version"), occurrenceId = id("occurrence");
const completionReportId = id("completion_report");
const title = z.string().trim().min(1).max(200);
const instructions = z.string().trim().min(1).max(8_000);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instantValue = z.iso.datetime({ offset: true });
const accountIds = z.array(id("account")).min(1).max(2);
const createGoal = z.object({ caseId, audienceId, title }).strict();
const createCommitment = z.object({ caseId, audienceId, goalId, title }).strict();
const homeAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_draft"), caseId, audienceId, goalId: goalId.optional(), commitmentId: commitmentId.optional(), templateKey: z.string().trim().min(1).max(100), templateVersion: z.string().trim().min(1).max(100), instructions, startsOn: calendarDate, endsOn: calendarDate.nullable().optional() }).strict(),
  z.object({ action: z.literal("revise"), assignmentId, instructions, startsOn: calendarDate, endsOn: calendarDate.nullable().optional() }).strict(),
  z.object({ action: z.literal("publish"), assignmentId, versionId }).strict(),
  z.object({ action: z.literal("coordinate"), assignmentId, assigneeAccountIds: accountIds, completionMode: z.enum(completionModes), reminderCandidateAccountIds: z.array(id("account")).max(2), effectiveFrom: instantValue }).strict(),
  z.object({ action: z.literal("schedule"), assignmentId, occursOn: calendarDate, period: z.enum(occurrencePeriods) }).strict(),
]);
const checkIn = z.object({ occurrenceId, status: z.enum(completionStatuses), idempotencyKey: z.string().uuid(), correctsReportId: completionReportId.optional() }).strict();

export interface Ls040HttpServices {
  sessions: IdentitySessions;
  limits: RateLimitStore;
  audit: AuditSink;
  goals: GoalService;
  commitments: CommitmentService;
  practice: HomePracticeService;
  checkins: CheckInService;
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

function exactQuery(url: URL, keys: readonly string[]): Record<string, string> {
  if ([...url.searchParams.keys()].length !== keys.length || keys.some(key => !url.searchParams.has(key))) throw new AppError("INVALID_REQUEST");
  return Object.fromEntries(url.searchParams);
}

export class Ls040Http {
  constructor(private readonly config: IdentityConfig, private readonly clock: IdentityClock, private readonly services: Ls040HttpServices) {}

  async handle(request: Request): Promise<Response> {
    const requestId = newRequestId(); let actor: Actor | undefined;
    try {
      if (!this.config.enabled) throw new AppError("UNAVAILABLE");
      const url = new URL(request.url);
      if (url.origin !== this.config.origin || !["/api/goals", "/api/commitments", "/api/home-practice", "/api/checkins"].includes(url.pathname)) throw new AppError("NOT_FOUND");
      if (!['GET', 'POST'].includes(request.method)) throw new AppError("NOT_FOUND");
      if (request.method === "POST" && url.search) throw new AppError("INVALID_REQUEST");
      const token = cookie(request);
      if (!token) throw new AppError("UNAUTHENTICATED");
      actor = await this.services.sessions.actor(token);
      await enforceRateLimit(this.services.limits, opaqueRateLimitKey(`ls040:${actor.id}`, this.config.rateLimitKey), 150, 900_000);
      if (request.method === "POST") {
        verifyMutationOrigin(request, this.config.origin);
        verifyCsrfToken(request.headers.get("x-csrf-token"), this.services.sessions.csrf(token));
      }
      let data: unknown;
      if (url.pathname === "/api/goals") {
        if (request.method === "GET") {
          const parsed = createGoal.pick({ caseId: true, audienceId: true }).safeParse(exactQuery(url, ["caseId", "audienceId"]));
          if (!parsed.success) throw new AppError("INVALID_REQUEST");
          data = await this.services.goals.list(actor, parsed.data.caseId, parsed.data.audienceId);
        } else data = await this.services.goals.create(actor, await readJson(request, createGoal), requestId);
      } else if (url.pathname === "/api/commitments") {
        if (request.method === "GET") {
          const parsed = createGoal.pick({ caseId: true, audienceId: true }).safeParse(exactQuery(url, ["caseId", "audienceId"]));
          if (!parsed.success) throw new AppError("INVALID_REQUEST");
          data = await this.services.commitments.list(actor, parsed.data.caseId, parsed.data.audienceId);
        } else data = await this.services.commitments.create(actor, await readJson(request, createCommitment), requestId);
      } else if (url.pathname === "/api/home-practice") {
        if (request.method === "GET") {
          const parsed = createGoal.pick({ caseId: true, audienceId: true }).safeParse(exactQuery(url, ["caseId", "audienceId"]));
          if (!parsed.success) throw new AppError("INVALID_REQUEST");
          data = await this.services.practice.list(actor, parsed.data.caseId, parsed.data.audienceId);
        } else {
          const input = await readJson(request, homeAction);
          if (input.action === "create_draft") data = await this.services.practice.createDraft(actor, input, requestId);
          else if (input.action === "revise") data = await this.services.practice.revise(actor, input, requestId);
          else if (input.action === "publish") data = await this.services.practice.publish(actor, input.assignmentId, input.versionId, requestId);
          else if (input.action === "coordinate") data = await this.services.practice.coordinate(actor, input, requestId);
          else data = await this.services.practice.schedule(actor, input, requestId);
        }
      } else if (url.pathname === "/api/checkins") {
        if (request.method === "GET") {
          const parsed = z.object({ occurrenceId }).strict().safeParse(exactQuery(url, ["occurrenceId"]));
          if (!parsed.success) throw new AppError("INVALID_REQUEST");
          data = await this.services.checkins.list(actor, parsed.data.occurrenceId);
        } else data = await this.services.checkins.submit(actor, await readJson(request, checkIn), requestId);
      } else throw new AppError("NOT_FOUND");
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
