import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, errorEnvelope } from "@/lib/errors.ts";
import { readJson } from "@/lib/http/json.ts";
import { verifyCsrfToken, verifyMutationOrigin } from "@/lib/security/csrf.ts";
import { SESSION_COOKIE } from "@/lib/security/session.ts";
import { identityRuntime } from "@/features/identity/runtime.ts";
import { requestCommunityReply } from "@/features/community-reply/bridge.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const body = z.discriminatedUnion("mode", [
  z.object({ operationId: z.string().uuid(), mode: z.literal("generate"), question: z.string().trim().min(8).max(2000), originalUrl: z.string().url().max(1000).optional() }).strict(),
  z.object({ operationId: z.string().uuid(), mode: z.literal("revise_once"), question: z.string().trim().min(8).max(2000), originalUrl: z.string().url().max(1000).optional(), correction: z.string().trim().min(3).max(1000), previousReply: z.string().trim().min(10).max(3000) }).strict(),
]);
function fail(error: unknown) { const result = errorEnvelope(error instanceof AppError ? error : new AppError("UNAVAILABLE"), randomUUID()); return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }); }

export async function POST(request: Request) {
  try {
    const matches = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
    if (matches.length !== 1) throw new AppError("UNAUTHENTICATED");
    const token = matches[0]!.slice(SESSION_COOKIE.length + 1);
    const identity = await identityRuntime();
    const actor = await identity.services.sessions.actor(token);
    if (actor.role !== "practitioner") throw new AppError("FORBIDDEN");
    verifyMutationOrigin(request, identity.config.origin);
    verifyCsrfToken(request.headers.get("x-csrf-token"), identity.services.sessions.csrf(token));
    const command = await readJson(request, body, 65_536);
    const result = await requestCommunityReply(command);
    return NextResponse.json({ ok: true, data: result, requestId: randomUUID() }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return fail(error); }
}
