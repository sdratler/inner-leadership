"use client";
import { sessionInfo } from "../identity/client.ts";
import { ProviderProblem } from "./core.ts";
export async function providerRequest<T>(surface: "provider-index" | "provider-referrals", command: unknown, signal?: AbortSignal): Promise<T> {
  const session = await sessionInfo();
  if (session.role !== "practitioner") throw new ProviderProblem("FORBIDDEN");
  let response: Response;
  try { response = await fetch(`/api/${surface}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken }, body: JSON.stringify(command), signal: signal ?? null }); }
  catch { throw new ProviderProblem("UNAVAILABLE"); }
  let body: { ok?: boolean; data?: T; error?: { code?: string }; reason?: string };
  try { body = await response.json(); } catch { throw new ProviderProblem("UNAVAILABLE"); }
  if (response.ok && body.ok === true && body.data !== undefined) return body.data;
  const code = body.error?.code === "CONFLICT" ? "CONFLICT" : body.error?.code === "INVALID_REQUEST" ? "INVALID_REQUEST" :
    body.error?.code === "FORBIDDEN" || body.error?.code === "NOT_FOUND" ? "FORBIDDEN" : "UNAVAILABLE";
  throw new ProviderProblem(code, body.reason ?? code);
}
