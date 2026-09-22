import { createHash } from "node:crypto";
import type { Transcript, PrivateAnalysis, CleanSegment } from "./types.ts";
import { invariant, nonempty } from "./policy.ts";
export const MAX_TRANSCRIPT_CHARS = 240000;
export function transcriptDigest(transcript: Transcript): string { return createHash("sha256").update(JSON.stringify(transcript)).digest("hex"); }
export function validateTranscript(transcript: Transcript): void {
    invariant(transcript.source === "machine_transcript" && Number.isInteger(transcript.version) && transcript.version >= 1, "TRANSCRIPT_VERSION");
    invariant(Number.isFinite(transcript.durationMs) && transcript.durationMs > 0 && transcript.durationMs <= 7200000, "TRANSCRIPT_DURATION");
    invariant(Array.isArray(transcript.languages) && transcript.languages.length > 0 && transcript.languages.every(x => x === "en" || x === "he"), "TRANSCRIPT_LANGUAGE");
    invariant(Array.isArray(transcript.segments) && transcript.segments.length > 0 && transcript.segments.length <= 20000, "TRANSCRIPT_SEGMENTS");
    let chars = 0, previousStart = -1;
    const ids = new Set<string>();
    for (const s of transcript.segments) {
        invariant(nonempty(s.id, 100) && !ids.has(s.id) && nonempty(s.speaker, 100), "TRANSCRIPT_SEGMENT_ID");
        ids.add(s.id);
        invariant(Number.isInteger(s.startMs) && Number.isInteger(s.endMs) && s.startMs >= 0 && s.endMs > s.startMs && s.endMs <= transcript.durationMs + 1000 && s.startMs >= previousStart, "TRANSCRIPT_TIMESTAMPS");
        invariant(nonempty(s.text, 16000), "TRANSCRIPT_TEXT");
        chars += s.text.length;
        previousStart = s.startMs;
    }
    invariant(chars <= MAX_TRANSCRIPT_CHARS, "TRANSCRIPT_SIZE");
}
/** Whitespace cleanup only. Semantic cleanup requires the separate evidence-linked AI pass. */
export function cleanWhitespace(transcript: Transcript): readonly CleanSegment[] {
    validateTranscript(transcript);
    return transcript.segments.map(s => ({ sourceSegmentId: s.id, text: s.text.replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() }));
}
export function validateCleanSegments(transcript: Transcript, cleaned: readonly CleanSegment[]): void {
    invariant(cleaned.length === transcript.segments.length, "CLEAN_TRANSCRIPT_COVERAGE");
    const seen = new Set<string>();
    for (const s of cleaned) {
        invariant(transcript.segments.some(v => v.id === s.sourceSegmentId) && !seen.has(s.sourceSegmentId) && nonempty(s.text, 16000), "CLEAN_TRANSCRIPT_REFERENCE");
        seen.add(s.sourceSegmentId);
    }
}
export function speakerNames(transcript: Transcript, assignments: Readonly<Record<string, string>>) {
    const speakers = new Set(transcript.segments.map(s => s.speaker));
    for (const [id, name] of Object.entries(assignments))
        invariant(speakers.has(id) && nonempty(name, 100), "SPEAKER_MAPPING");
    return transcript.segments.map(s => ({ ...s, displaySpeaker: assignments[s.speaker] ?? s.speaker }));
}
export function validateAnalysis(analysis: PrivateAnalysis, transcript: Transcript): void {
    invariant(analysis.schemaVersion === 1 && analysis.transcriptVersion === transcript.version && ["en", "he"].includes(analysis.locale), "ANALYSIS_VERSION");
    const allowed = ["schemaVersion", "locale", "transcriptVersion", "summary", "observations", "possibleInterpretations", "nextSessionTopics", "limitations"].sort().join();
    invariant(Object.keys(analysis).sort().join() === allowed, "ANALYSIS_EXTRA_FIELDS");
    for (const key of ["summary", "observations", "possibleInterpretations", "nextSessionTopics"] as const) {
        invariant(Array.isArray(analysis[key]) && analysis[key].length <= 30, "ANALYSIS_SECTION");
        for (const item of analysis[key]) {
            invariant(nonempty(item.text, 1800) && Array.isArray(item.evidence) && item.evidence.length > 0, "ANALYSIS_EVIDENCE_REQUIRED");
            for (const quote of item.evidence) {
                const source = transcript.segments.find(s => s.id === quote.segmentId);
                invariant(source && nonempty(quote.quote, 1600) && source.text.includes(quote.quote), "ANALYSIS_QUOTE_NOT_IN_SOURCE");
            }
        }
    }
    invariant(Array.isArray(analysis.limitations) && analysis.limitations.length <= 15 && analysis.limitations.every(s => nonempty(s, 800)), "ANALYSIS_LIMITATIONS");
    // Quote validation proves source linkage, not that an interpretation is clinically correct.
}
/** Adapter receipt from independently measured audio and completed provider/chunk jobs; never supplied by the language model. */
export interface TranscriptionCompletion {
    sourceDigest: string;
    sourceDurationMs: number;
    coveredDurationMs: number;
    expectedChunks: number;
    completedChunks: number;
    providerCompleted: boolean;
}
export function validateTranscriptionCompletion(transcript: Transcript, receipt: TranscriptionCompletion, sourceDurationMs: number, sourceDigest: string): void {
    invariant(receipt && receipt.providerCompleted === true && receipt.sourceDigest === sourceDigest, "TRANSCRIPT_COMPLETION_RECEIPT");
    invariant(Number.isInteger(sourceDurationMs) && sourceDurationMs > 0 && sourceDurationMs <= 7200000 && receipt.sourceDurationMs === sourceDurationMs, "AUDIO_MEASURED_DURATION");
    invariant(Number.isInteger(receipt.expectedChunks) && receipt.expectedChunks > 0 && receipt.expectedChunks <= 500 && receipt.completedChunks === receipt.expectedChunks, "TRANSCRIPT_CHUNKS_INCOMPLETE");
    invariant(Number.isFinite(receipt.coveredDurationMs) && Math.abs(receipt.coveredDurationMs - sourceDurationMs) <= 1000 && Math.abs(transcript.durationMs - sourceDurationMs) <= 1000, "TRANSCRIPT_DURATION_INCOMPLETE");
    // This verifies the adapter's completion contract, not whether every spoken word was recognized accurately.
}
