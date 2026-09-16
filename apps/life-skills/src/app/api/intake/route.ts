import { NextResponse } from "next/server";

/** Public intake is intentionally gated until W0's explicit real-data release.
 * The fragment token is never accepted in a GET/query string. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> { return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 }); }
export async function POST(): Promise<Response> { return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 }); }
