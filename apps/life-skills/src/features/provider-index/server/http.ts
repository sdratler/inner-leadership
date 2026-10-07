import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, errorEnvelope } from "../../../lib/errors.ts";
import { readJson } from "../../../lib/http/json.ts";
import { verifyMutationOrigin, verifyCsrfToken } from "../../../lib/security/csrf.ts";
import { providerOwnerContext } from "./context.ts";
import { ProviderIndexStore } from "./store.ts";
import { ProviderReferralStore } from "../../provider-referrals/server/store.ts";
import { ProviderProblem } from "../core.ts";
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "Vary": "Cookie" };
const reasons = new Set(["POSSIBLE_DUPLICATE", "STALE_VERSION", "OPERATION_REUSED", "DIRECTORY_LIMIT", "REFERRAL_VIEW_LIMIT", "PROVIDER_ARCHIVED", "REFERRAL_SCOPE_IMMUTABLE", "FUTURE_VERIFICATION", "DECLARED_FIT_SOURCE_REQUIRED", "VERIFICATION_EVIDENCE_REQUIRED", "INVALID_URL", "SOURCE_REQUIRED"]);
/** POST also carries search terms, keeping provider/contact text out of URL logs.
 * All commands use existing owner sessions, origin/CSRF checks and bounded JSON.
 */
export async function handleProviderRequest(request: Request, surface: "directory" | "referrals"): Promise<Response> {
  const requestId = randomUUID();
  try {
    if (request.method !== "POST" || new URL(request.url).searchParams.size) throw new AppError("INVALID_REQUEST");
    const { token, identity, actor, gate } = await providerOwnerContext(request.headers);
    verifyMutationOrigin(request, identity.config.origin);
    verifyCsrfToken(request.headers.get("x-csrf-token"), identity.services.sessions.csrf(token));
    const body = await readJson(request, z.unknown(), 24000);
    const store = surface === "directory" ? new ProviderIndexStore(identity.store, identity.config, gate, identity.clock)
      : new ProviderReferralStore(identity.store, identity.config, gate, identity.clock);
    const data = await store.execute(actor, body, requestId);
    return NextResponse.json({ ok: true, data, requestId }, { headers: privateHeaders });
  } catch (error) {
    const safe = error instanceof ProviderProblem ? new AppError(error.code) : error instanceof AppError ? error : new AppError("UNAVAILABLE");
    const result = errorEnvelope(safe, requestId);
    const reason = error instanceof ProviderProblem && reasons.has(error.reason) ? error.reason : undefined;
    return NextResponse.json({ ...result.body, ...(reason ? { reason } : {}) }, { status: result.status, headers: privateHeaders });
  }
}

