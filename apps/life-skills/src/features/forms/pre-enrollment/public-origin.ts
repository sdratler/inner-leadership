import { parseEnvironment } from "../../../lib/env/schema.ts";
import { AppError } from "../../../lib/errors.ts";
import { verifyMutationOrigin } from "../../../lib/security/csrf.ts";

/** Parent-only additional origin. Identity and its host-only cookies stay on
 * LS_APP_ORIGIN; this is not an identity, CORS or general API allowlist. */
export function intakePublicOrigin(input: Record<string, string | undefined>): string {
  const canonical = parseEnvironment(input).LS_APP_ORIGIN;
  const raw = input.LS_INTAKE_PUBLIC_ORIGIN;
  if (!raw) return canonical;
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError("UNAVAILABLE"); }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.port || url.hostname.includes("*")) {
    throw new AppError("UNAVAILABLE");
  }
  return url.origin;
}

/** Next's Node adapter can build request.url from its internal listen address.
 * Match the HTTP Host only against exact configured hosts; never use arbitrary
 * forwarded-host/protocol values to expand the allowlist. */
function configuredRequestOrigin(request: Request, input: Record<string, string | undefined>): string | null {
  const canonical = parseEnvironment(input).LS_APP_ORIGIN;
  const host = request.headers.get("host")?.toLowerCase();
  return [canonical, intakePublicOrigin(input)].find(origin => new URL(origin).host === host) ?? null;
}

/** Accept only a same-origin parent POST to either exact configured host. */
export function verifyIntakeMutationOrigin(request: Request, input: Record<string, string | undefined>): void {
  const origin = configuredRequestOrigin(request, input);
  const url = new URL(request.url);
  if (url.pathname !== "/api/intake" || url.search || url.hash ||
      !origin ||
      request.headers.get("sec-fetch-site") !== "same-origin") throw new AppError("FORBIDDEN");
  verifyMutationOrigin(request, origin);
}

/** A convenient staff entry without opening the full private application.
 * No POST/body forwarding, arbitrary destination, credential or query copying. */
export function intakeStaffEntry(request: Request, input: Record<string, string | undefined>): URL | null {
  if (!["GET", "HEAD"].includes(request.method)) return null;
  const canonical = parseEnvironment(input).LS_APP_ORIGIN;
  const origin = configuredRequestOrigin(request, input);
  const url = new URL(request.url);
  if (!origin) return null;
  if (url.pathname === "/" && !url.search) return new URL("/en/intake/staff", canonical);
  if (origin !== canonical && /^\/(en|he)\/intake\/staff\/?$/.test(url.pathname)) {
    const destination = new URL(url.pathname, canonical);
    const mode = url.searchParams.get("mode");
    if (url.search && (url.searchParams.size !== 1 || !["invite", "reset"].includes(mode ?? ""))) return null;
    if (mode) destination.searchParams.set("mode", mode);
    return destination;
  }
  return null;
}
