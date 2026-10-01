import { expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seal } from "../../src/features/identity/crypto.ts";
import { privateRecordAad, sealPrivateRecord, unsealPrivateRecord, readPrivateTranscript, readPrivateAnalysis, type StoredTranscriptRow } from "../../src/features/session-workflow/private-records.ts";
import { transcriptDigest, cleanWhitespace, speakerNames } from "../../src/features/session-workflow/transcript.ts";
import { blankMetrics } from "../../src/features/session-workflow/metrics.ts";
import { PractitionerSessionDesk, type SessionDeskModel, type SessionDeskActions } from "../../src/ui/revamp/session-desk.tsx";
import type { Transcript, PrivateAnalysis } from "../../src/features/session-workflow/types.ts";
const scope = { workspaceId: "123e4567-e89b-42d3-a456-426614174000", caseId: "223e4567-e89b-42d3-a456-426614174000", sessionId: "323e4567-e89b-42d3-a456-426614174000" }, jobId = "423e4567-e89b-42d3-a456-426614174000";
const ring = { activeKeyId: "current", keys: { current: randomBytes(32) } }, at = new Date("2026-09-28T09:00:00.000Z");
// Deliberately different property order from the validating schema.
const transcript: Transcript = { source: "machine_transcript", segments: [{ text: "DEMO —  Synthetic source בלבד", endMs: 1000, id: "s1", speaker: "constructor", startMs: 0 }], languages: ["en", "he"], durationMs: 1000, version: 1 };
const body: PrivateAnalysis = { schemaVersion: 1, locale: "en", transcriptVersion: 1, summary: [{ text: "DEMO — Private bounded summary", evidence: [{ segmentId: "s1", quote: "Synthetic source" }] }], observations: [], possibleInterpretations: [], nextSessionTopics: [], limitations: ["DEMO — Synthetic read fixture, not a verified provider workflow."] };
const encode = (kind: Parameters<typeof privateRecordAad>[0], value: unknown, version: number | string = 1, identity?: string) => sealPrivateRecord(value, privateRecordAad(kind, scope, version, identity), ring);
function stored(): StoredTranscriptRow { return { version: 1, jobId, sourceCiphertext: encode("transcript", transcript), cleanedCiphertext: encode("cleaned-transcript", cleanWhitespace(transcript)), speakerMappingCiphertext: null, contentDigest: transcriptDigest(transcript), sourceKind: "machine_transcript", createdAt: at, completeVerified: true, jobTranscriptVersion: 1, jobTranscriptDigest: transcriptDigest(transcript), sourceDigest: "a".repeat(64), durationMs: 1000, completionReceiptCiphertext: encode("transcript-completion", { sourceDigest: "a".repeat(64), sourceDurationMs: 1000, coveredDurationMs: 1000, expectedChunks: 1, completedChunks: 1, providerCompleted: true }, 1, jobId) }; }
it("reads exact source order, own-AAD, cleaned coverage and completion without changing source", () => {
  const row = stored(), before = JSON.stringify(row), saved = readPrivateTranscript(row, scope, ring);
  expect(JSON.stringify(saved.transcript)).toBe(JSON.stringify(transcript)); expect(saved.metadata).toMatchObject({ version: 1, digest: row.contentDigest, completeVerified: true, speakers: {}, createdAt: at.toISOString() });
  expect(saved.metadata.cleaned[0]!.text).toBe("DEMO — Synthetic source בלבד"); expect(JSON.stringify(row)).toBe(before);
});
it("uses only own speaker mappings and preserves unknown/prototype-named source labels", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const value = { ...transcript, segments: [{ ...transcript.segments[0]!, speaker: name }] };
    expect(speakerNames(value, {})[0]!.displaySpeaker).toBe(name);
    const own = Object.fromEntries([[name, "DEMO — Actual saved label"]]); expect(speakerNames(value, own)[0]!.displaySpeaker).toBe(own[name]);
    const row = { ...stored(), sourceCiphertext: encode("transcript", value), contentDigest: transcriptDigest(value), jobTranscriptDigest: transcriptDigest(value), speakerMappingCiphertext: encode("speakers", own) }; expect(readPrivateTranscript(row, scope, ring).metadata.speakers[name]).toBe(own[name]);
  }
  const row = stored(); row.speakerMappingCiphertext = encode("speakers", { constructor: "DEMO — Saved speaker" }); expect(readPrivateTranscript(row, scope, ring).metadata.speakers.constructor).toBe("DEMO — Saved speaker");
  row.speakerMappingCiphertext = encode("speakers", { unknown: "Invented" }); expect(() => readPrivateTranscript(row, scope, ring)).toThrow("UNAVAILABLE");
});
it("rejects cross-case/session/workspace/version/job AAD and corruption, never trying a fallback", () => {
  const row = stored();
  for (const field of ["workspaceId", "caseId", "sessionId"] as const) expect(() => readPrivateTranscript(row, { ...scope, [field]: jobId }, ring)).toThrow("UNAVAILABLE");
  for (const change of [{ jobId: scope.caseId }, { version: 2 }, { sourceCiphertext: "not-an-envelope" }, { sourceCiphertext: encode("transcript", { ...transcript, privateExtra: "no" }) }, { contentDigest: "b".repeat(64), jobTranscriptDigest: "b".repeat(64) }]) expect(() => readPrivateTranscript({ ...row, ...change }, scope, ring)).toThrow("UNAVAILABLE");
});
it("rejects incomplete, mismatched and partial receipts before showing a stored transcript", () => {
  const row = stored();
  for (const change of [{ completeVerified: false }, { jobTranscriptVersion: 2 }, { jobTranscriptDigest: "b".repeat(64) }, { completionReceiptCiphertext: null }, { durationMs: 4000 }, { completionReceiptCiphertext: encode("transcript-completion", { sourceDigest: "a".repeat(64), sourceDurationMs: 1000, coveredDurationMs: 1000, expectedChunks: 2, completedChunks: 1, providerCompleted: true }, 1, jobId) }, { cleanedCiphertext: encode("cleaned-transcript", []) }]) expect(() => readPrivateTranscript({ ...row, ...change }, scope, ring)).toThrow("UNAVAILABLE");
});
it("keeps ciphertext/decoded-envelope bounds and does not accept extra fields or noncanonical chunks", () => {
  const aad = privateRecordAad("transcript", scope, 1);
  expect(() => unsealPrivateRecord("x".repeat(20021), aad, ring, 10)).toThrow("UNAVAILABLE");
  const valid = JSON.parse(encode("transcript", transcript));
  for (const change of [{ ...valid, extra: true }, { v: 1, chunks: [] }, { v: 1, chunks: Array(2).fill(valid.chunks[0]) }, { v: 1, chunks: [seal("not+base64", `${aad}:0`, ring)] }]) expect(() => unsealPrivateRecord(JSON.stringify(change), aad, ring, 1000)).toThrow("UNAVAILABLE");
  expect(() => unsealPrivateRecord(encode("transcript", transcript), aad, ring, 10)).toThrow("UNAVAILABLE");
});
it("reads only the requested locale and exact transcript revision with source-linked analysis", () => {
  const row = { transcriptVersion: 1, locale: "en" as const, revision: 2, bodyCiphertext: encode("analysis", body, "en:2"), promptVersion: "DEMO-prompt-v3", modelVersion: "DEMO-model", createdAt: at };
  expect(readPrivateAnalysis(row, scope, ring, transcript, "en")).toMatchObject({ analysis: body, metadata: { locale: "en", revision: 2, transcriptVersion: 1, promptVersion: "DEMO-prompt-v3", createdAt: at.toISOString() } });
  for (const changed of [{ ...row, locale: "he" as const }, { ...row, transcriptVersion: 2 }, { ...row, revision: 3 }, { ...row, promptVersion: " " }, { ...row, bodyCiphertext: encode("analysis", { ...body, attendance: "present" }, "en:2") }, { ...row, bodyCiphertext: encode("analysis", { ...body, summary: [{ text: "Made up", evidence: [{ segmentId: "s1", quote: "not in source" }] }] }, "en:2") }]) expect(() => readPrivateAnalysis(changed, scope, ring, transcript, "en")).toThrow("UNAVAILABLE");
  expect(() => readPrivateAnalysis(row, scope, ring, transcript, "he")).toThrow("UNAVAILABLE");
});
const unavailableCommand = { async execute() { throw Error("NO_PROVIDER"); }, async reconcile() { throw Error("NO_PROVIDER"); } };
const actions: SessionDeskActions = { async upload() { throw Error("NO_PROVIDER"); }, async refresh() {}, selectAnalysisLanguage() {}, saveRecap: unavailableCommand, speakers: unavailableCommand, metrics: unavailableCommand, share: unavailableCommand };
it("shows real private provenance and collapsed evidence without inventing scores or provider completion", () => {
  const model: SessionDeskModel = { ...scope, clientDisplayName: "DEMO — Synthetic client", selectedAppointmentId: jobId, appointments: [], processing: { state: null, audioState: null, message: "No recording uploaded.", permissionToRecord: false }, transcript, analysis: body, privateRecords: { analysisLocale: "en", transcript: readPrivateTranscript(stored(), scope, ring).metadata, analysis: { locale: "en", transcriptVersion: 1, revision: 2, promptVersion: "DEMO-prompt-v3", modelVersion: "DEMO-model", createdAt: at.toISOString() } }, metrics: blankMetrics(), metricsRevision: 0, recap: null, recapDigest: null, recipients: [] };
  for (const locale of ["en", "he"] as const) { const html = renderToStaticMarkup(createElement(PractitionerSessionDesk, { locale, model, actions })); expect(html).toContain(body.summary[0]!.text); expect(html).toContain("DEMO-prompt-v3"); expect(html).toContain("DEMO-model"); expect(html).toContain('<details><summary>'); expect(html).not.toContain("ciphertext"); expect(html).not.toContain("object_reference"); }
  const wrong = renderToStaticMarkup(createElement(PractitionerSessionDesk, { locale: "he", model: { ...model, analysis: { ...body, locale: "he" }, privateRecords: { ...model.privateRecords!, analysisLocale: "he" } }, actions })); expect(wrong).not.toContain(body.summary[0]!.text);
});
