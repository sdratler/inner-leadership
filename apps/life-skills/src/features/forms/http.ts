import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { readJson } from "../../lib/http/json.ts";
import type { Actor } from "../identity/types.ts";
import { formAssignmentInputSchema, formSubmissionInputSchema, formTemplateInputSchema, formReviewInputSchema } from "./schema.ts";
import type { FormAssignmentId } from "./service.ts";
import { FormsService } from "./service.ts";
import { Ls050HttpBoundary, type Ls050HttpRuntime } from "./http-boundary.ts";

const methods = Object.freeze({
  "/api/forms/templates": ["GET", "POST"],
  "/api/forms/assignments": ["GET", "POST"],
  "/api/forms/submissions": ["GET", "POST"],
  "/api/forms/submissions/review": ["PATCH"],
} satisfies Record<string, readonly string[]>);
const caseId = z.uuid().transform((value) => asId(value, "case"));
const assignmentId = z.uuid().transform((value) => asId(value, "form_assignment"));
const locale = z.enum(["he", "en"]);

function exactQuery(url: URL, schema: z.ZodType<Record<string, unknown>>): Record<string, unknown> {
  const values = Object.fromEntries(url.searchParams);
  const result = schema.safeParse(values);
  if (!result.success || [...url.searchParams.keys()].length !== Object.keys(values).length) throw new AppError("INVALID_REQUEST");
  return result.data;
}

export class FormsHttp {
  private readonly boundary: Ls050HttpBoundary;
  constructor(runtime: Ls050HttpRuntime, private readonly forms: FormsService) { this.boundary = new Ls050HttpBoundary(runtime); }

  handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const allowed = (methods as Record<string, readonly string[]>)[path] ?? [];
    return this.boundary.handle(request, allowed, (actor, requestId, url) => this.dispatch(actor, requestId, url, path, request));
  }

  private async dispatch(actor: Actor, requestId: string, url: URL, path: string, request: Request) {
    if (path === "/api/forms/templates") {
      if (request.method === "GET") {
        const query = exactQuery(url, z.strictObject({ locale })) as { locale: "he" | "en" };
        return { data: await this.forms.listTemplates(actor, query.locale) };
      }
      if (url.search) throw new AppError("INVALID_REQUEST");
      const input = await readJson(request, formTemplateInputSchema);
      return { data: await this.forms.createTemplate(actor, input, requestId), status: 201 };
    }
    if (path === "/api/forms/assignments") {
      if (request.method === "GET") {
        const query = exactQuery(url, z.strictObject({ caseId })) as { caseId: ReturnType<typeof asId<"case">> };
        return { data: await this.forms.listAssignments(actor, query.caseId) };
      }
      if (url.search) throw new AppError("INVALID_REQUEST");
      const input = await readJson(request, formAssignmentInputSchema);
      return { data: await this.forms.assign(actor, input, requestId), status: 201 };
    }
    if (path === "/api/forms/submissions") {
      if (request.method === "GET") {
        const query = exactQuery(url, z.strictObject({ caseId, assignmentId })) as { caseId: ReturnType<typeof asId<"case">>; assignmentId: FormAssignmentId };
        return { data: await this.forms.listProtectedSubmissions(actor, query.caseId, query.assignmentId) };
      }
      if (url.search) throw new AppError("INVALID_REQUEST");
      const input = await readJson(request, formSubmissionInputSchema);
      return { data: await this.forms.submit(actor, input, requestId), status: 201 };
    }
    if (path === "/api/forms/submissions/review") {
      if (url.search) throw new AppError("INVALID_REQUEST");
      const input = await readJson(request, formReviewInputSchema);
      await this.forms.markReviewed(actor, input.submissionId, requestId);
      return { data: { accepted: true } };
    }
    throw new AppError("NOT_FOUND");
  }
}
