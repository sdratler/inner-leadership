import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, errorEnvelope } from "../../../lib/errors.ts";
import { SESSION_COOKIE } from "../../../lib/security/session.ts";
import { identityRuntime } from "../../../features/identity/runtime.ts";
import { readCommunitySettings } from "../../../features/community-reply/settings-bridge.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  try {
    const matches = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
    if (matches.length !== 1) throw new AppError("UNAUTHENTICATED");
    const identity = await identityRuntime();
    const actor = await identity.services.sessions.actor(matches[0]!.slice(SESSION_COOKIE.length + 1));
    if (actor.role !== "practitioner") throw new AppError("FORBIDDEN");
    return NextResponse.json({ ok: true, data: await readCommunitySettings(), requestId: randomUUID() }, { headers });
  } catch (error) {
    const result = errorEnvelope(error instanceof AppError ? error : new AppError("UNAVAILABLE"), randomUUID());
    return NextResponse.json(result.body, { status: result.status, headers });
  }
}
