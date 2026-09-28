import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, errorEnvelope } from "../../../../lib/errors.ts";
import { readJson } from "../../../../lib/http/json.ts";
import { verifyCsrfToken, verifyMutationOrigin } from "../../../../lib/security/csrf.ts";
import { SESSION_COOKIE } from "../../../../lib/security/session.ts";
import { identityRuntime } from "../../../../features/identity/runtime.ts";
import { VoiceRuleLedger, type RuleChange, type RuleRequest } from "../../../../features/content-voice/rule-ledger.ts";
import { readContentVoiceSource, type ContentVoiceSnapshot } from "../../../../features/content-voice/source.ts";
import { writeContentVoiceIfUnchanged } from "../../../../features/content-voice/drive-cas.ts";
import { requestCommunityReply } from "../../../../features/community-reply/bridge.ts";
import { communityRulesInGuide } from "../../../../features/content-voice/rule-editor.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const fullRequestSchema = z.object({
  operationId: z.string().uuid(), correction: z.string().trim().min(3).max(1000),
  rule: z.string().trim().min(8).max(400), language: z.enum(["he", "en", "both"]),
  targetRuleId: z.string().regex(/^CR-[0-9a-f]{32}$/).nullable().optional(),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/), sourceRevision: z.string().regex(/^\d+$/),
  question: z.string().trim().min(8).max(2000), originalUrl: z.string().url().max(1000).optional(),
  previousReply: z.string().trim().min(10).max(3000),
}).strict();
const requestSchema = z.union([fullRequestSchema, z.object({ operationId: z.string().uuid() }).strict()]);
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
function fail(error: unknown) {
  const result = errorEnvelope(error instanceof AppError ? error : new AppError("UNAVAILABLE"), randomUUID());
  return NextResponse.json(result.body, { status: result.status, headers });
}
async function context(request: Request) {
  const matches = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim())
    .filter(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) throw new AppError("UNAUTHENTICATED");
  const token = matches[0]!.slice(SESSION_COOKIE.length + 1);
  const identity = await identityRuntime();
  const actor = await identity.services.sessions.actor(token);
  if (actor.role !== "practitioner" || actor.state !== "active" || actor.workspaceId !== identity.config.workspaceId)
    throw new AppError("FORBIDDEN");
  return { token, identity, actor, ledger: new VoiceRuleLedger(identity.store, identity.config.workspaceId,
    identity.config.keyring, identity.config.lookupKey) };
}
const metadata = (snapshot: ContentVoiceSnapshot | null) => snapshot ? ({
  declaredVersion: snapshot.declaredVersion, driveRevision: snapshot.driveRevision,
  modifiedAt: snapshot.modifiedAt, checkedAt: snapshot.checkedAt, sha256: snapshot.sha256,
}) : null;
function safe(change: RuleChange, source: ContentVoiceSnapshot | null) {
  return { operationId: change.operationId, status: change.status, ruleId: change.affectedRuleId,
    draftSourceConflict: change.status === "draft_conflict",
    before: change.before, after: change.after, savedAt: change.savedAt, revisedAt: change.revisedAt,
    source: metadata(source), sourceAfterSha256: change.sourceAfterSha256,
    sourceAfterRevision: change.sourceAfterRevision, draft: change.draftResult,
    draftInput: change.draftResult ? { question: change.request.question, originalUrl: change.request.originalUrl ?? "" } : null };
}

export async function GET(request: Request) {
  try {
    const { actor, ledger } = await context(request);
    const query = new URL(request.url).searchParams;
    if (query.get("list") === "1") {
      const source = await readContentVoiceSource();
      return NextResponse.json({ ok: true, data: { source: metadata(source), rules: communityRulesInGuide(source.text) } }, { headers });
    }
    const operationId = query.get("operationId");
    if (!operationId || !z.string().uuid().safeParse(operationId).success) throw new AppError("NOT_FOUND");
    const change = await ledger.get(actor, operationId);
    if (!change) throw new AppError("NOT_FOUND");
    const source = await readContentVoiceSource().catch(() => null);
    return NextResponse.json({ ok: true, data: safe(change, source) }, { headers });
  } catch (error) { return fail(error); }
}

/** One owner click; pending writes reconcile against the canonical file before retry. */
export async function POST(request: Request) {
  try {
    const { token, identity, actor, ledger } = await context(request);
    verifyMutationOrigin(request, identity.config.origin);
    verifyCsrfToken(request.headers.get("x-csrf-token"), identity.services.sessions.csrf(token));
    const input = await readJson(request, requestSchema, 65_536);
    const stored = await ledger.get(actor, input.operationId);
    if (!("rule" in input) && !stored) throw new AppError("NOT_FOUND");
    const command = "rule" in input ? input as RuleRequest : stored!.request;
    let source: ContentVoiceSnapshot | null = await readContentVoiceSource();
    let change = await ledger.getForRequest(actor, command);
    if (!change) {
      const prepared = await ledger.prepare(actor, command, source);
      if ("state" in prepared) {
        return NextResponse.json({ ok: true, data: { operationId: command.operationId, status: prepared.state,
          ruleId: prepared.ruleId, before: prepared.before, after: prepared.after,
          source: metadata(source), draft: null } }, { headers });
      }
      change = prepared;
    }
    if (change.status === "draft_conflict")
      return NextResponse.json({ ok: true, data: safe(change, source) }, { headers });
    if (!["saved", "draft_pending", "complete"].includes(change.status)) {
      if (!change.desiredText) throw new AppError("UNAVAILABLE");
      const outcome = await writeContentVoiceIfUnchanged(
        { sha256: change.request.sourceSha256, driveRevision: change.request.sourceRevision }, change.desiredText);
      source = outcome.snapshot;
      change = await ledger.markSourceResult(actor, change.operationId,
        outcome.state === "saved" || outcome.state === "already_saved" ? "saved" : outcome.state,
        outcome.snapshot);
    }
    if (change.status === "saved" || change.status === "draft_pending") {
      change = await ledger.markDraft(actor, change.operationId, null);
      if (source?.sha256 === change.sourceAfterSha256 && source.driveRevision === change.sourceAfterRevision) {
        try {
          const reply = await requestCommunityReply({ operationId: change.draftOperationId, mode: "revise_once",
            question: change.request.question, ...(change.request.originalUrl ? { originalUrl: change.request.originalUrl } : {}),
            correction: change.request.correction, previousReply: change.request.previousReply });
          change = await ledger.markDraft(actor, change.operationId, reply);
        } catch {
          // Source save remains durable; a draft failure is an explicit retryable
          // state, never a false claim that either the source or reply was saved.
        }
      } else if (source) {
        change = await ledger.markDraftSourceConflict(actor, change.operationId, source);
      }
    }
    if (!source || source.sha256 !== change.sourceAfterSha256) source = await readContentVoiceSource().catch(() => null);
    return NextResponse.json({ ok: true, data: safe(change, source) }, { headers });
  } catch (error) { return fail(error); }
}
