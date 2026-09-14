import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { asId, type CaseId } from "../../lib/ids.ts";
import { readJson } from "../../lib/http/json.ts";
import type { Actor } from "../identity/types.ts";
import { Ls050HttpBoundary, type Ls050HttpRuntime } from "../forms/http-boundary.ts";
import { resourceAssignmentInputSchema, resourceCompletionInputSchema, resourceInputSchema } from "./schema.ts";
import { ResourcesService } from "./service.ts";

const methods = Object.freeze({
  "/api/resources": ["POST"],
  "/api/resources/assignments": ["GET", "POST"],
  "/api/resources/completions": ["POST"],
} satisfies Record<string, readonly string[]>);
const caseId = z.uuid().transform((value) => asId(value, "case"));

export class ResourcesHttp {
  private readonly boundary: Ls050HttpBoundary;
  constructor(runtime: Ls050HttpRuntime, private readonly resources: ResourcesService) { this.boundary = new Ls050HttpBoundary(runtime); }

  handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const allowed = (methods as Record<string, readonly string[]>)[path] ?? [];
    return this.boundary.handle(request, allowed, (actor, requestId, url) => this.dispatch(actor, requestId, url, path, request));
  }

  private async dispatch(actor: Actor, requestId: string, url: URL, path: string, request: Request) {
    if (path === "/api/resources") {
      if (url.search) throw new AppError("INVALID_REQUEST");
      return { data: await this.resources.create(actor, await readJson(request, resourceInputSchema), requestId), status: 201 };
    }
    if (path === "/api/resources/assignments") {
      if (request.method === "GET") {
        const result = z.strictObject({ caseId }).safeParse(Object.fromEntries(url.searchParams));
        if (!result.success || [...url.searchParams.keys()].length !== 1) throw new AppError("INVALID_REQUEST");
        return { data: await this.resources.list(actor, result.data.caseId as CaseId) };
      }
      if (url.search) throw new AppError("INVALID_REQUEST");
      return { data: await this.resources.assign(actor, await readJson(request, resourceAssignmentInputSchema), requestId), status: 201 };
    }
    if (path === "/api/resources/completions") {
      if (url.search) throw new AppError("INVALID_REQUEST");
      const input = await readJson(request, resourceCompletionInputSchema);
      return { data: await this.resources.complete(actor, input.assignmentId, input.idempotencyKey, requestId), status: 201 };
    }
    throw new AppError("NOT_FOUND");
  }
}
