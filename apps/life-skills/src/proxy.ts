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
  // Private paths never become available merely by enabling a visual preview.
  const privatePath = pathname.startsWith("/api/private/") || /^\/(he|en)\/(app|workspace|parent|client|practitioner)(\/|$)/.test(pathname);
  const health = pathname === "/api/health";
  const robots = pathname === "/robots.txt";
  if (privatePath || (!health && !robots && env.LS_APP_MODE !== "foundation_preview")) {
    return decorate(NextResponse.json({ ok:false, error:{code:"UNAVAILABLE"}, requestId:crypto.randomUUID() }, {status:503}),headers);
  }
  if (pathname === "/") return decorate(NextResponse.redirect(new URL("/he/foundation", request.url)),headers);
  const inbound = new Headers(request.headers);
  // Do not trust caller-supplied nonce or request identifiers.
  inbound.set("x-nonce",nonce); inbound.set("Content-Security-Policy",headers["Content-Security-Policy"] ?? "default-src 'none'");
  inbound.set("x-request-id",crypto.randomUUID());
  return decorate(NextResponse.next({ request: { headers: inbound } }),headers);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
