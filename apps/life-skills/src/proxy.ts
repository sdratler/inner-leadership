import { NextRequest, NextResponse } from "next/server";
import { parseEnvironment } from "./lib/env/schema.ts";
import { securityHeaders } from "./lib/security/headers.ts";
function decorate(response: NextResponse, headers: Record<string,string>): NextResponse {
  for (const [key,value] of Object.entries(headers)) response.headers.set(key,value);
  return response;
}
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  let env: ReturnType<typeof parseEnvironment>;
  try { env = parseEnvironment(process.env); } catch {
    return decorate(NextResponse.json({ ok:false, error:{ code:"UNAVAILABLE" }, requestId:crypto.randomUUID() },{status:503}), securityHeaders(nonce,false,false));
  }
  const headers = securityHeaders(nonce, env.NODE_ENV === "development", env.LS_APP_ORIGIN.startsWith("https:"));
  const pathname = request.nextUrl.pathname;
  // The synthetic gallery is a development-only review surface. Deny it before
  // React streaming begins so production returns an actual 404 status.
  const developmentGallery = /^\/(he|en)\/dev\/ui(?:\/|$)/.test(pathname);
  if (developmentGallery && env.NODE_ENV !== "development") {
    return decorate(new NextResponse(null,{status:404}),headers);
  }
  // The private application has its own explicit server-side gate. Foundation
  // preview never opens authenticated application or domain API routes.
  const privatePath = /^\/api\/(?:private|identity|calendar|attendance|checkins|commitments|forms|goals|home-practice|payments|progress|resources|updates)(?:\/|$)/.test(pathname) ||
    /^\/(he|en)\/(?:app|family|workspace|parent|client|practitioner|attendance|calendar|checkins|commitments|forms|goals|home-practice|payments|progress|resources|updates)(?:\/|$)/.test(pathname);
  const privateMode = process.env.LS_PRIVATE_APP_ENABLED === "true";
  // Preserve the accepted standalone identity preview independently of the full
  // portal flag. Identity runtime configuration and all auth checks still apply.
  const identityPreview = /^\/api\/identity(?:\/|$)/.test(pathname) && env.LS_APP_MODE === "foundation_preview";
  const health = pathname === "/api/health";
  const robots = pathname === "/robots.txt";
  if ((privatePath && !privateMode && !identityPreview) || (!privatePath && !health && !robots && env.LS_APP_MODE !== "foundation_preview")) {
    return decorate(NextResponse.json({ ok:false, error:{code:"UNAVAILABLE"}, requestId:crypto.randomUUID() }, {status:503}),headers);
  }
  if (pathname === "/") return decorate(NextResponse.redirect(new URL(privateMode ? "/he/app" : "/he/foundation", request.url)),headers);
  const inbound = new Headers(request.headers);
  // Do not trust caller-supplied nonce or request identifiers.
  inbound.set("x-nonce",nonce); inbound.set("Content-Security-Policy",headers["Content-Security-Policy"] ?? "default-src 'none'");
  inbound.set("x-request-id",crypto.randomUUID());
  const configuredOrigin = new URL(env.LS_APP_ORIGIN);
  inbound.set("x-forwarded-proto",configuredOrigin.protocol.slice(0,-1));
  inbound.set("x-forwarded-host",request.headers.get("host") ?? configuredOrigin.host);
  return decorate(NextResponse.next({ request: { headers: inbound } }),headers);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
