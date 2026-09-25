import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AppError, errorEnvelope } from "../../../lib/errors.ts";
import { SESSION_COOKIE } from "../../../lib/security/session.ts";
import { identityRuntime } from "../../../features/identity/runtime.ts";
import { readCommunityInbox } from "../../../features/community-inbox/bridge.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  try {
    const matches = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
    if (matches.length !== 1) throw new AppError("UNAUTHENTICATED");
    const token = matches[0]!.slice(SESSION_COOKIE.length + 1);
    const identity = await identityRuntime();
    const actor = await identity.services.sessions.actor(token);
    if (actor.role !== "practitioner") throw new AppError("FORBIDDEN");
    const url = new URL(request.url);
    const result = await readCommunityInbox(url.searchParams.get("status") ?? "all", url.searchParams.get("cursor") ?? "");
    return NextResponse.json({ ok: true, data: result, requestId: randomUUID() }, { headers });
  } catch (error) {
    const result = errorEnvelope(error instanceof AppError ? error : new AppError("UNAVAILABLE"), randomUUID());
    return NextResponse.json(result.body, { status: result.status, headers });
  }
}
