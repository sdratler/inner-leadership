import { z } from "zod";
import { AppError, errorEnvelope, type Envelope } from "../errors.ts";
export const MAX_JSON_BYTES = 16_384;
/** Bound the actual byte stream, not just the caller-supplied Content-Length. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>, maxBytes = MAX_JSON_BYTES): Promise<T> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new AppError("INTERNAL");
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new AppError("UNSUPPORTED_MEDIA_TYPE");
  if (!request.body) throw new AppError("INVALID_REQUEST");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new AppError("PAYLOAD_TOO_LARGE"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_REQUEST");
  } finally { reader.releaseLock(); }
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new AppError("INVALID_REQUEST"); }
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError("INVALID_REQUEST");
  return result.data;
}
export function successResponse<T>(data: T, requestId: string, status = 200): Response {
  const body: Envelope<T> = { ok: true, data, requestId };
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function failureResponse(error: unknown, requestId: string): Response {
  const result = errorEnvelope(error, requestId);
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
}
