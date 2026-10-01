import { NextRequest, NextResponse } from "next/server";
import { parseEnvironment } from "./lib/env/schema.ts";
import { securityHeaders } from "./lib/security/headers.ts";
import { parseIdentityConfig } from "./features/identity/config.ts";
import { runtimePublicConsent } from "./features/forms/pre-enrollment/consent.ts";
import { ownerPreviewConfig } from "./features/forms/pre-enrollment/owner-preview.ts";
import { intakeStaffEntry } from "./features/forms/pre-enrollment/public-origin.ts";
import { clientReturnPath, parentReturnPath, practitionerDetailReturnPath, practitionerReturnPath } from "./features/identity/login-return.ts";
import { canonicalForwardedRequest } from "./features/integration/canonical-forwarded-request.ts";

const intakeIdentityRoutes = new Set([
  "/api/identity/csrf", "/api/identity/login", "/api/identity/session",
  "/api/identity/logout", "/api/identity/logout-all", "/api/identity/invites/accept",
  "/api/identity/reset/request", "/api/identity/reset/complete",
]);
const publicBrandAndFontAssets = new Set([
  "/intake-brand/life-skills-logo.png", "/intake-brand/bna-logo.png",
  "/intake-brand/Heebo-wght.ttf", "/intake-brand/FrankRuhlLibre-wght.ttf",
  "/fonts/Heebo-wght.ttf", "/fonts/FrankRuhlLibre-wght.ttf",
]);
const pwaPublicAssets = new Set(["/life-skills-sw.js","/pwa/icon-192.png","/pwa/icon-512.png"]);
export function publicStaticAsset(pathname: string, method: string): boolean {
  return (method === "GET" || method === "HEAD") &&
    (publicBrandAndFontAssets.has(pathname) || pwaPublicAssets.has(pathname) ||
      /^\/(he|en)\/pwa\/(parent|client|practitioner)\/manifest\.webmanifest$/.test(pathname));
}
/** This gate does not replace token, identity, role or CSRF checks in each route. */
export function intakeReleasePath(pathname: string, input: Record<string,string|undefined>): boolean {
  const allowed = /^\/(he|en)\/intake(?:\/staff)?\/?$/.test(pathname) ||
    pathname === "/auth/invite" || pathname === "/auth/reset" ||
    pathname === "/api/intake" || pathname === "/api/intake/staff" || intakeIdentityRoutes.has(pathname);
  if (!allowed) return false;
  try {
    const origin = new URL(input.LS_APP_ORIGIN ?? "");
    const synthetic = input.NODE_ENV === "development" && input.LS_INTAKE_SYNTHETIC_LOOPBACK === "true" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
    if (input.LS_INTAKE_REAL_DATA_RELEASE !== "true" && !synthetic) return false;
    parseIdentityConfig(input);
    runtimePublicConsent(input.LS_INTAKE_PUBLIC_CONSENT_JSON);
    return true;
  } catch { return false; }
}
function decorate(response: NextResponse, headers: Record<string,string>): NextResponse {
  for (const [key,value] of Object.entries(headers)) response.headers.set(key,value);
  return response;
}
function constantTimeEqual(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length,right.length);
  for (let index=0;index<length;index++) mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return mismatch === 0;
}
function isolatedPreviewAuthorized(request: NextRequest, expected: string | undefined): boolean {
  const header=request.headers.get("authorization");
  if (!expected || !header?.startsWith("Basic ")) return false;
  try {
    const decoded=atob(header.slice(6)); const separator=decoded.indexOf(":");
    return separator>0 && constantTimeEqual(decoded.slice(0,separator),"preview") && constantTimeEqual(decoded.slice(separator+1),expected);
  } catch { return false; }
}
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  let env: ReturnType<typeof parseEnvironment>;
  try { env = parseEnvironment(process.env); } catch {
    return decorate(NextResponse.json({ ok:false, error:{ code:"UNAVAILABLE" }, requestId:crypto.randomUUID() },{status:503}), securityHeaders(nonce,false,false));
  }
  const headers = securityHeaders(nonce, env.NODE_ENV === "development", env.LS_APP_ORIGIN.startsWith("https:"));
  const pathname = request.nextUrl.pathname;
  const canonicalOrigin = new URL(env.LS_APP_ORIGIN);
  const requestHost = (request.headers.get("host") ?? request.nextUrl.host).trim().toLowerCase();
  // These APIs depend on strict canonical HTTPS forwarding. Validate the original
  // transport before the request-header rewrite below can hide an invalid chain.
  // Forwarding never grants a session, role, case or audience permission.
  if (["/api/goals", "/api/commitments", "/api/home-practice", "/api/checkins"].includes(pathname)) {
    try {
      if (request.nextUrl.hash || requestHost !== canonicalOrigin.host.toLowerCase()) throw new Error("invalid transport");
      if (request.headers.has("x-forwarded-proto") || request.headers.has("x-forwarded-host")) {
        canonicalForwardedRequest(request.clone(), env.LS_APP_ORIGIN);
      } else if (request.nextUrl.protocol !== canonicalOrigin.protocol) throw new Error("invalid transport");
    } catch {
      return decorate(NextResponse.json({ ok: false, error: { code: "UNAVAILABLE" }, requestId: crypto.randomUUID() }, { status: 503 }), headers);
    }
  }
  if (process.env.LS_PRIVATE_APP_ENABLED !== "true" && intakeReleasePath("/en/intake/staff", process.env)) {
    try {
      const entry = intakeStaffEntry(request, process.env);
      if (entry) return decorate(NextResponse.redirect(entry), headers);
    } catch { return decorate(new NextResponse(null, { status: 503 }), headers); }
  }
  // Only named public assets bypass app gates. No wildcard, directory listing,
  // private record, image proxy or remote image fetch is opened.
  if (publicStaticAsset(pathname, request.method)) {
    return decorate(NextResponse.next(), headers);
  }
  const intakePath = intakeReleasePath(pathname, process.env);
  const ownerPreviewPath = /^\/(he|en)\/preview\/intake\/?$/.test(pathname) || pathname === "/api/intake-preview";
  if (ownerPreviewPath && !ownerPreviewConfig(process.env)) return decorate(new NextResponse(null,{status:404}),headers);
  if (intakePath && ["/auth/invite", "/auth/reset"].includes(pathname)) {
    if (request.nextUrl.search) return decorate(new NextResponse(null,{status:404}),headers);
    // A fragment is retained by the browser during this redirect; it never reaches the server.
    const destination = new URL("/he/login", env.LS_APP_ORIGIN);
    destination.searchParams.set("mode", pathname.endsWith("invite") ? "invite" : "reset");
    return decorate(NextResponse.redirect(destination),headers);
  }
  // Respondent credentials belong only in fragments, not query strings.
  if (/^\/(he|en)\/intake\/?$/.test(pathname) && request.nextUrl.search) {
    return decorate(new NextResponse(null,{status:404}),headers);
  }
  // The synthetic gallery is a development-only review surface. Deny it before
  // React streaming begins so production returns an actual 404 status.
  const developmentGallery = /^\/(he|en)\/dev\/ui(?:\/|$)/.test(pathname);
  if (developmentGallery && env.NODE_ENV !== "development") {
    return decorate(new NextResponse(null,{status:404}),headers);
  }
  // The private application has its own explicit server-side gate. Foundation
  // preview never opens authenticated application or domain API routes.
  const privatePath = pathname === "/api/private-notes" || /^\/api\/(?:private|identity|calendar|attendance|checkins|commitments|community-posts|community-reply|content-voice|forms|goals|home-practice|payments|progress|prospects|resources|sessions|updates)(?:\/|$)/.test(pathname) ||
    /^\/(he|en)(?:\/?$|\/(?:login|app|family|workspace|parent|client|practitioner|attendance|calendar|checkins|commitments|forms|goals|home-practice|payments|progress|resources|sample|updates)(?:\/|$))/.test(pathname);
  const privateMode = process.env.LS_PRIVATE_APP_ENABLED === "true";
  // Preserve the accepted standalone identity preview independently of the full
  // portal flag. Identity runtime configuration and all auth checks still apply.
  const identityPreview = /^\/api\/identity(?:\/|$)/.test(pathname) && env.LS_APP_MODE === "foundation_preview";
  const health = pathname === "/api/health";
  const robots = pathname === "/robots.txt";
  const isolatedPreview = env.LS_APP_MODE === "isolated_preview";
  const isolatedPreviewPage = pathname === "/" || /^\/(he|en)\/preview(?:\/|$)/.test(pathname);
  // Railway may retain its internal service hostname in nextUrl even when the
  // edge-routed Host is the registered custom domain. Host/proto select the
  // perimeter only; identity, role and case authorization still gate data.
  const requestProtocol = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.slice(0, -1)).split(",", 1)[0]!.trim().toLowerCase();
  const canonicalPrivateOrigin = requestProtocol === canonicalOrigin.protocol.slice(0, -1) &&
    requestHost === canonicalOrigin.host.toLowerCase();
  // Preserve the owner-review perimeter on the Railway/service hostname while
  // allowing the registered custom origin to use the real identity + role gate.
  const isolatedPreviewPerimeter = isolatedPreview && !canonicalPrivateOrigin;
  if (isolatedPreviewPerimeter && !intakePath && !ownerPreviewPath && !health && !robots && !isolatedPreviewAuthorized(request,env.LS_PREVIEW_ACCESS_KEY)) {
    const response=NextResponse.json({ok:false,error:{code:"UNAUTHENTICATED"},requestId:crypto.randomUUID()},{status:401});
    response.headers.set("WWW-Authenticate",'Basic realm="Life Skills private preview", charset="UTF-8"');
    return decorate(response,headers);
  }
  if (isolatedPreviewPerimeter && !intakePath && !ownerPreviewPath && !health && !robots && !privatePath && !isolatedPreviewPage) {
    return decorate(new NextResponse(null,{status:404}),headers);
  }
  if (isolatedPreview && canonicalPrivateOrigin && !ownerPreviewPath && /^\/(he|en)\/preview(?:\/|$)/.test(pathname)) {
    return decorate(new NextResponse(null,{status:404}),headers);
  }
  if (!intakePath && !ownerPreviewPath && ((privatePath && !privateMode && !identityPreview) || (!privatePath && pathname !== "/" && !health && !robots && env.LS_APP_MODE !== "foundation_preview" && !isolatedPreviewPerimeter))) {
    return decorate(NextResponse.json({ ok:false, error:{code:"UNAVAILABLE"}, requestId:crypto.randomUUID() }, {status:503}),headers);
  }
  if (pathname === "/") return decorate(NextResponse.redirect(new URL(isolatedPreviewPerimeter ? "/he/preview" : privateMode ? "/he/login" : "/he/foundation", request.url)),headers);
  const inbound = new Headers(request.headers);
  // Never forward a caller-supplied return path into the private layout.
  inbound.delete("x-ls-practitioner-return");
  inbound.delete("x-ls-parent-return");
  inbound.delete("x-ls-client-return");
  const practitionerPage = /^\/(he|en)\/app\/(calendar|clients|practice)\/?$/.exec(pathname);
  if (practitionerPage) {
    const locale = practitionerPage[1] as "he" | "en";
    const page = practitionerPage[2] as "calendar" | "clients" | "practice";
    const query: Record<string, string | undefined> = {};
    for (const key of page === "calendar" ? ["date", "view", "caseId", "context", "mode"] : page === "practice" ? ["caseId", "audienceId", "assignmentId", "section"] : ["section", "filter", "leadId", "personId", "mode", "page", "search", "stage", "language", "due"]) {
      const values = request.nextUrl.searchParams.getAll(key);
      query[key] = values.length === 1 ? values[0] : undefined;
    }
    inbound.set("x-ls-practitioner-return", practitionerReturnPath(locale, page, query));
  }
  const practitionerDetail=/^\/(he|en)\/app\/(?:reports|forms|resources|cases\/[^/]+\/sessions(?:\/[^/]+)?)$/.exec(pathname);
  if(practitionerDetail){
    const query:Record<string,string|undefined>={};
    for(const key of ['mode','date','view','caseId','audienceId','appointmentId','context','section']){const values=request.nextUrl.searchParams.getAll(key);query[key]=values.length===1?values[0]:undefined;}
    inbound.set('x-ls-practitioner-return',practitionerDetailReturnPath(practitionerDetail[1] as 'en'|'he',pathname,query));
  }
  const parentPage = /^\/(he|en)\/family(?:\/|$)/.exec(pathname);
  if (parentPage) {
    const query: Record<string, string | undefined> = {};
    for (const key of ["caseId", "date", "view", "audienceId", "assignmentId", "practiceVersionId", "section"]) {
      const values = request.nextUrl.searchParams.getAll(key);
      query[key] = values.length === 1 ? values[0] : undefined;
    }
    inbound.set("x-ls-parent-return", parentReturnPath(parentPage[1] as "he" | "en", pathname, query));
  }
  const clientPage = /^\/(he|en)\/client(?:\/|$)/.exec(pathname);
  if (clientPage) {
    const query: Record<string, string | undefined> = {};
    for (const key of ["caseId", "date", "view", "audienceId", "assignmentId", "section"]) {
      const values = request.nextUrl.searchParams.getAll(key);
      query[key] = values.length === 1 ? values[0] : undefined;
    }
    inbound.set("x-ls-client-return", clientReturnPath(clientPage[1] as "he" | "en", pathname, query));
  }
  // Do not trust caller-supplied nonce or request identifiers.
  inbound.set("x-nonce",nonce); inbound.set("Content-Security-Policy",headers["Content-Security-Policy"] ?? "default-src 'none'");
  inbound.set("x-request-id",crypto.randomUUID());
  const configuredOrigin = new URL(env.LS_APP_ORIGIN);
  inbound.set("x-forwarded-proto",configuredOrigin.protocol.slice(0,-1));
  inbound.set("x-forwarded-host",request.headers.get("host") ?? configuredOrigin.host);
  return decorate(NextResponse.next({ request: { headers: inbound } }),headers);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
