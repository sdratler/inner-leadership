import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, errorEnvelope } from "../../../lib/errors.ts";
import { readJson } from "../../../lib/http/json.ts";
import { verifyCsrfToken, verifyMutationOrigin } from "../../../lib/security/csrf.ts";
import { SESSION_COOKIE } from "../../../lib/security/session.ts";
import { identityRuntime } from "../../../features/identity/runtime.ts";
import { controlsCommand, readCommunitySettings, saveCommunitySettings } from "../../../features/community-reply/settings-bridge.ts";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
async function context(request: Request) {
  const matches = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) throw new AppError("UNAUTHENTICATED");
  const token = matches[0]!.slice(SESSION_COOKIE.length + 1), identity = await identityRuntime(), actor = await identity.services.sessions.actor(token);
  if (actor.role !== "practitioner") throw new AppError("FORBIDDEN");
  return { token, identity, actor };
}
function fail(error: unknown) { const result = errorEnvelope(error instanceof AppError ? error : new AppError("UNAVAILABLE"), randomUUID()); return NextResponse.json(result.body, { status: result.status, headers }); }
export async function GET(request: Request) { try {
  const { actor } = await context(request);
  if (new URL(request.url).searchParams.size) throw new AppError("INVALID_REQUEST");
  return NextResponse.json({ ok: true, data: await readCommunitySettings(actor.id), requestId: randomUUID() }, { headers });
} catch (error) { return fail(error); } }
export async function PUT(request: Request) { try {
  const { token, identity, actor } = await context(request);
  verifyMutationOrigin(request, identity.config.origin); verifyCsrfToken(request.headers.get("x-csrf-token"), identity.services.sessions.csrf(token));
  if (new URL(request.url).searchParams.size) throw new AppError("INVALID_REQUEST");
  const value = await readJson(request, controlsCommand, 40_000);
  return NextResponse.json({ ok: true, data: await saveCommunitySettings(actor.id, value), requestId: randomUUID() }, { headers });
} catch (error) { return fail(error); } }
