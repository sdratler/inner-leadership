import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { readJson } from "../../lib/http/json.ts";
import { Ls050HttpBoundary, type Ls050HttpRuntime } from "../forms/http-boundary.ts";
import { PrivateNotesService } from "./service.ts";
const caseId = z.string().uuid().transform((value) => asId(value, "case"));
const saveSchema = z.strictObject({ caseId, body: z.string().max(8_000), expectedRevision: z.number().int().min(0), idempotencyKey: z.string().uuid() });
export class PrivateNotesHttp {
  private readonly boundary: Ls050HttpBoundary;
  constructor(runtime: Ls050HttpRuntime, private readonly notes: PrivateNotesService) { this.boundary = new Ls050HttpBoundary(runtime); }
  handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    return this.boundary.handle(request, ["GET", "POST"], async (actor, requestId, url) => {
      if (path !== "/api/private-notes") throw new AppError("NOT_FOUND");
      if (request.method === "GET") return { data: await this.notes.read(actor, caseId.parse(url.searchParams.get("caseId"))) };
      if (url.search) throw new AppError("INVALID_REQUEST");
      return { data: await this.notes.save(actor, await readJson(request, saveSchema), requestId), status: 201 };
    });
  }
}
