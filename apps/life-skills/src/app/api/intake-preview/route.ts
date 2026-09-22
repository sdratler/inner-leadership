import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ownerPreviewExchange } from "@/features/forms/pre-enrollment/owner-preview.ts";
import { readJson } from "@/lib/http/json.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bodySchema = z.strictObject({ action: z.literal("exchange"), token: z.string().max(128) });
function closed() { return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" }, requestId: randomUUID() }, { status: 404, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } }); }
export async function GET() { return closed(); }
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin !== new URL(process.env.LS_APP_ORIGIN ?? "").origin) return closed();
    const body = await readJson(request, bodySchema); const data = ownerPreviewExchange(process.env, body.token);
    if (!data) return closed();
    return NextResponse.json({ ok: true, data, requestId: randomUUID() }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch { return closed(); }
}
