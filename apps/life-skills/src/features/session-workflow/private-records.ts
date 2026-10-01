import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { seal, unseal, type Keyring } from "../identity/crypto.ts";
import { transcriptDigest, validateTranscript, validateCleanSegments, validateAnalysis, validateTranscriptionCompletion, speakerNames } from "./transcript.ts";
import type { CleanSegment, Locale, PrivateAnalysis, Transcript } from "./types.ts";

export interface PrivateSessionScope { workspaceId: string; caseId: string; sessionId: string; }
export interface TranscriptReadMetadata { version: number; digest: string; createdAt: string; completeVerified: true; cleaned: readonly CleanSegment[]; speakers: Readonly<Record<string, string>>; }
export interface AnalysisReadMetadata { locale: Locale; transcriptVersion: number; revision: number; promptVersion: string; modelVersion: string; createdAt: string; }
export interface PrivateSessionReadMetadata { analysisLocale: Locale; transcript: TranscriptReadMetadata | null; analysis: AnalysisReadMetadata | null; }
export interface StoredTranscriptRow {
  version: number; jobId: string; sourceCiphertext: string; cleanedCiphertext: string; speakerMappingCiphertext: string | null; contentDigest: string; sourceKind: string; createdAt: Date;
  completeVerified: boolean; jobTranscriptVersion: number | null; jobTranscriptDigest: string | null; sourceDigest: string; durationMs: number; completionReceiptCiphertext: string | null;
}
export interface StoredAnalysisRow { transcriptVersion: number; locale: Locale; revision: number; bodyCiphertext: string; promptVersion: string; modelVersion: string; createdAt: Date; }
const positiveVersion = z.number().int().min(1).max(2147483647), digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const transcriptSchema = z.strictObject({ version: positiveVersion, durationMs: z.number().int().min(1).max(7200000), languages: z.array(z.enum(["en", "he"])).min(1).max(2), source: z.literal("machine_transcript"), segments: z.array(z.strictObject({ id: text(100), speaker: text(100), startMs: z.number().int().min(0), endMs: z.number().int().min(1), text: text(16000) })).min(1).max(20000) });
const cleanedSchema = z.array(z.strictObject({ sourceSegmentId: text(100), text: text(16000) })).min(1).max(20000);
const mappingSchema = z.record(text(100), text(100));
const completionSchema = z.strictObject({ sourceDigest: digest, sourceDurationMs: z.number().int().min(1).max(7200000), coveredDurationMs: z.number().min(0).max(7201000), expectedChunks: z.number().int().min(1).max(500), completedChunks: z.number().int().min(1).max(500), providerCompleted: z.literal(true) });
const analysisItem = z.strictObject({ text: text(1800), evidence: z.array(z.strictObject({ segmentId: text(100), quote: text(1600) })).min(1).max(30) });
const analysisSchema = z.strictObject({ schemaVersion: z.literal(1), locale: z.enum(["en", "he"]), transcriptVersion: positiveVersion, summary: z.array(analysisItem).max(30), observations: z.array(analysisItem).max(30), possibleInterpretations: z.array(analysisItem).max(30), nextSessionTopics: z.array(analysisItem).max(30), limitations: z.array(text(800)).max(15) });

/** The same v1 chunk envelope as existing session records. No fallback AAD or legacy decryption guess. */
export function privateRecordAad(kind: "transcript" | "cleaned-transcript" | "speakers" | "analysis" | "transcript-completion", scope: PrivateSessionScope, version: number | string, identity = scope.sessionId): string {
  for (const value of [scope.workspaceId, scope.caseId, scope.sessionId, identity]) if (!z.string().uuid().safeParse(value).success) throw new AppError("UNAVAILABLE");
  return `session:${kind}:${scope.workspaceId}:${scope.caseId}:${identity}:${version}`;
}
export function sealPrivateRecord(value: unknown, aad: string, ring: Keyring): string {
  const bytes = Buffer.from(JSON.stringify(value), "utf8"), chunks: string[] = [];
  if (!bytes.length || bytes.length > 4000000) throw new AppError("INVALID_REQUEST");
  for (let offset = 0; offset < bytes.length; offset += 32000) chunks.push(seal(bytes.subarray(offset, offset + 32000).toString("base64url"), `${aad}:${chunks.length}`, ring));
  return JSON.stringify({ v: 1, chunks });
}
export function unsealPrivateRecord(encoded: string, aad: string, ring: Keyring, maxBytes: number): unknown {
  try {
    if (typeof encoded !== "string" || encoded.length > maxBytes * 2 + 20000) throw new Error();
    const envelope = z.strictObject({ v: z.literal(1), chunks: z.array(z.string().min(1).max(100000)).min(1).max(Math.ceil(maxBytes / 32000)) }).parse(JSON.parse(encoded));
    let size = 0;
    const chunks = envelope.chunks.map((chunk, index) => {
      const plain = unseal(chunk, `${aad}:${index}`, ring);
      if (!/^[A-Za-z0-9_-]+$/.test(plain)) throw new Error();
      const bytes = Buffer.from(plain, "base64url"); size += bytes.length;
      if (bytes.toString("base64url") !== plain || bytes.length > 32000 || size > maxBytes) throw new Error();
      return bytes;
    });
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new AppError("UNAVAILABLE"); }
}
function savedTime(value: Date): string { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new AppError("UNAVAILABLE"); return value.toISOString(); }
export function readPrivateTranscript(row: StoredTranscriptRow, scope: PrivateSessionScope, ring: Keyring): { transcript: Transcript; metadata: TranscriptReadMetadata } {
  try {
    if (!positiveVersion.safeParse(row.version).success || row.sourceKind !== "machine_transcript" || !row.completeVerified || row.jobTranscriptVersion !== row.version || row.jobTranscriptDigest !== row.contentDigest || !digest.safeParse(row.contentDigest).success || !row.completionReceiptCiphertext) throw new Error();
    const source = unsealPrivateRecord(row.sourceCiphertext, privateRecordAad("transcript", scope, row.version), ring, 4000000);
    transcriptSchema.parse(source);
    // Validate without reordering keys: the existing source digest authenticates
    // the provider's exact serialized object, not a schema-normalized copy.
    const transcript = source as Transcript;
    validateTranscript(transcript);
    if (transcript.version !== row.version || transcriptDigest(transcript) !== row.contentDigest) throw new Error();
    const completion = completionSchema.parse(unsealPrivateRecord(row.completionReceiptCiphertext, privateRecordAad("transcript-completion", scope, 1, row.jobId), ring, 10000));
    validateTranscriptionCompletion(transcript, completion, row.durationMs, row.sourceDigest);
    const cleaned = cleanedSchema.parse(unsealPrivateRecord(row.cleanedCiphertext, privateRecordAad("cleaned-transcript", scope, row.version), ring, 4000000));
    validateCleanSegments(transcript, cleaned);
    const mapping = row.speakerMappingCiphertext ? unsealPrivateRecord(row.speakerMappingCiphertext, privateRecordAad("speakers", scope, row.version), ring, 2000000) : {};
    mappingSchema.parse(mapping);
    const speakers = mapping as Record<string, string>;
    if (Object.keys(speakers).length > 20000) throw new Error();
    speakerNames(transcript, speakers);
    return { transcript, metadata: { version: row.version, digest: row.contentDigest, createdAt: savedTime(row.createdAt), completeVerified: true, cleaned, speakers } };
  } catch { throw new AppError("UNAVAILABLE"); }
}
export function readPrivateAnalysis(row: StoredAnalysisRow, scope: PrivateSessionScope, ring: Keyring, transcript: Transcript, locale: Locale): { analysis: PrivateAnalysis; metadata: AnalysisReadMetadata } {
  try {
    if (row.locale !== locale || row.transcriptVersion !== transcript.version || !positiveVersion.safeParse(row.revision).success || !text(200).safeParse(row.promptVersion).success || !text(200).safeParse(row.modelVersion).success) throw new Error();
    const analysis = analysisSchema.parse(unsealPrivateRecord(row.bodyCiphertext, privateRecordAad("analysis", scope, `${row.locale}:${row.revision}`), ring, 8000000));
    if (analysis.locale !== locale) throw new Error();
    validateAnalysis(analysis, transcript);
    return { analysis, metadata: { locale, transcriptVersion: transcript.version, revision: row.revision, promptVersion: row.promptVersion, modelVersion: row.modelVersion, createdAt: savedTime(row.createdAt) } };
  } catch { throw new AppError("UNAVAILABLE"); }
}
