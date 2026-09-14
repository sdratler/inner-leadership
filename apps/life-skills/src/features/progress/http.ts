import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { asId, type CaseId } from "../../lib/ids.ts";
import { readJson } from "../../lib/http/json.ts";
import type { Actor } from "../identity/types.ts";
import { Ls050HttpBoundary, type Ls050HttpRuntime } from "../forms/http-boundary.ts";
import { contextualTargetInputSchema, qualitativePublishInputSchema, qualitativeReviewInputSchema } from "./schema.ts";
import { ProgressService } from "./service.ts";

const methods = Object.freeze({
  "/api/progress/targets": ["GET", "POST"],
  "/api/progress/reviews": ["GET", "POST"],
  "/api/progress/reviews/publish": ["POST"],
} satisfies Record<string, readonly string[]>);
const caseId = z.uuid().transform((value) => asId(value, "case"));

function readCaseId(url: URL): CaseId {
  const parsed = z.strictObject({ caseId }).safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success || [...url.searchParams.keys()].length !== 1) throw new AppError("INVALID_REQUEST");
  return parsed.data.caseId;
}

export class ProgressHttp {
  private readonly boundary: Ls050HttpBoundary;
  constructor(runtime: Ls050HttpRuntime, private readonly progress: ProgressService) { this.boundary = new Ls050HttpBoundary(runtime); }

  handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const allowed = (methods as Record<string, readonly string[]>)[path] ?? [];
    return this.boundary.handle(request, allowed, (actor, requestId, url) => this.dispatch(actor, requestId, url, path, request));
  }

  private async dispatch(actor: Actor, requestId: string, url: URL, path: string, request: Request) {
    if (path === "/api/progress/targets") {
      if (request.method === "GET") return { data: await this.progress.listTargets(actor, readCaseId(url)) };
      if (url.search) throw new AppError("INVALID_REQUEST");
      return { data: await this.progress.createTarget(actor, await readJson(request, contextualTargetInputSchema), requestId), status: 201 };
    }
    if (path === "/api/progress/reviews") {
      if (request.method === "GET") return { data: await this.progress.listReviews(actor, readCaseId(url)) };
      if (url.search) throw new AppError("INVALID_REQUEST");
      return { data: await this.progress.createReview(actor, await readJson(request, qualitativeReviewInputSchema), requestId), status: 201 };
    }
    if (path === "/api/progress/reviews/publish") {
      if (url.search) throw new AppError("INVALID_REQUEST");
      const input = await readJson(request, qualitativePublishInputSchema);
      return { data: await this.progress.publishReview(actor, input.reviewId, requestId) };
    }
    throw new AppError("NOT_FOUND");
  }
}
