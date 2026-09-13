import { AppError } from "../../lib/errors.ts";

const singleHeader = (value: string | null): string | null => {
  if (value === null || value.includes(",")) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

export function canonicalForwardedRequest(request: Request, configuredOrigin = process.env.LS_APP_ORIGIN): Request {
  try {
    const origin = new URL(configuredOrigin ?? "");
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("invalid origin");

    const protocol = singleHeader(request.headers.get("x-forwarded-proto"));
    const host = singleHeader(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
    if (protocol !== "https" || host !== origin.host.toLowerCase()) throw new Error("forwarding mismatch");

    const inbound = new URL(request.url);
    const canonical = new URL(`${inbound.pathname}${inbound.search}`, origin);
    return new Request(canonical, request);
  } catch {
    throw new AppError("UNAVAILABLE");
  }
}
