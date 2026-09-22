import type { Transcript, PrivateAnalysis, ProcessingJob } from "./types.ts";
import { invariant, WorkflowError } from "./policy.ts";
import { transcriptDigest, validateAnalysis, validateTranscript, validateTranscriptionCompletion, type TranscriptionCompletion, cleanWhitespace } from "./transcript.ts";
export interface Lease {
    job: ProcessingJob;
    fencingToken: string;
}
export interface TranscriptReceipt {
    version: number;
    digest: string;
    durable: true;
    completeVerified: true;
}
export interface ProcessingStore {
    /** Exclusive, expiring lease with fencing token; expired ownership cannot commit. */
    claim(jobId: string): Promise<Lease | null>;
    /** Recheck live account/case authority + consent; never rely only on upload-time authorization. */
    assertCurrentPermission(lease: Lease): Promise<void>;
    checkpoint(lease: Lease, patch: Partial<Pick<ProcessingJob, "state" | "audioState" | "transcriptVersion" | "transcriptDigest" | "providerRequestId" | "failureCode" | "transcriptCompleteVerified">>): Promise<void>;
    /** Atomically persist transcript, cleaned segments, provider receipt AND job transcript pointer/state. */
    saveTranscript(lease: Lease, transcript: Transcript, cleaned: ReturnType<typeof cleanWhitespace>, providerRequestId: string, completion: TranscriptionCompletion): Promise<TranscriptReceipt>;
    readTranscript(lease: Lease): Promise<Transcript>;
    saveAnalysis(lease: Lease, analysis: PrivateAnalysis): Promise<void>;
    complete(lease: Lease): Promise<void>;
    fail(lease: Lease, code: string): Promise<void>;
    release(lease: Lease): Promise<void>;
}
export interface AudioStore {
    /** Opaque, bound upload ID. Implementations must reject arbitrary paths/URLs and verify checksum. */
    readVerified(lease: Lease): Promise<Uint8Array>;
    /** Remove original and chunks. Do not remove unrelated files, transcripts or evidence. */
    deleteAndVerify(lease: Lease): Promise<"deleted" | "already_absent">;
}
export interface Transcriber {
    transcribe(input: {
        bytes: Uint8Array;
        attemptId: string;
        sourceDigest: string;
        languages: readonly [
            "he",
            "en"
        ];
        speakerIdentification: "labels_only";
    }): Promise<{
        transcript: Transcript;
        requestId: string;
        completion: TranscriptionCompletion;
    }>;
}
export interface SessionAnalyst {
    analyze(transcript: Transcript, locale: "en" | "he"): Promise<PrivateAnalysis>;
}
export interface ProcessingBudget {
    /** Reserve before provider call; a receipt/unknown outcome remains recorded, never charged twice by blind retry. */
    reserve(attemptId: string, phase: "transcription" | "analysis"): Promise<void>;
}
export interface ProcessingPorts {
    store: ProcessingStore;
    audio: AudioStore;
    transcriber: Transcriber;
    analyst: SessionAnalyst;
    budget: ProcessingBudget;
}
/**
 * Real orchestration over explicitly supplied persistence/provider adapters.
 * No adapter is silently constructed; importing this module performs no network or database work.
 * Transcript persists and reads back BEFORE raw-audio deletion. AI never publishes outward content.
 */
export async function processSession(jobId: string, ports: ProcessingPorts, summaryLocale: "en" | "he" = "en") {
    const lease = await ports.store.claim(jobId);
    if (!lease)
        return { status: "already_running_or_complete" as const };
    let uncertainPhase: "transcription" | "analysis" | null = null;
    try {
        await ports.store.assertCurrentPermission(lease);
        invariant(lease.job.state !== "canceled" && lease.job.state !== "ready", "JOB_NOT_PROCESSABLE");
        let transcript: Transcript;
        if (lease.job.transcriptVersion !== null) {
            invariant(lease.job.transcriptCompleteVerified === true, "TRANSCRIPT_COMPLETENESS_NOT_VERIFIED");
            transcript = await ports.store.readTranscript(lease);
            validateTranscript(transcript);
            invariant(transcriptDigest(transcript) === lease.job.transcriptDigest, "TRANSCRIPT_READBACK_FAILED");
        }
        else {
            // A lost response is not permission to re-send audio. Reconciliation chooses a new authorized attempt.
            invariant(lease.job.state !== "transcribing" && lease.job.failureCode !== "PROVIDER_OUTCOME_UNKNOWN", "PROVIDER_OUTCOME_UNKNOWN");
            await ports.budget.reserve(lease.job.attemptId, "transcription");
            await ports.store.checkpoint(lease, { state: "transcribing", failureCode: null });
            const bytes = await ports.audio.readVerified(lease);
            try {
                await ports.store.assertCurrentPermission(lease);
                uncertainPhase = "transcription";
                const result = await ports.transcriber.transcribe({ bytes, attemptId: lease.job.attemptId, sourceDigest: lease.job.sourceDigest, languages: ["he", "en"], speakerIdentification: "labels_only" });
                transcript = result.transcript;
                validateTranscript(transcript);
                validateTranscriptionCompletion(transcript, result.completion, lease.job.sourceDurationMs, lease.job.sourceDigest);
                await ports.store.assertCurrentPermission(lease);
                const receipt = await ports.store.saveTranscript(lease, transcript, cleanWhitespace(transcript), result.requestId, result.completion);
                invariant(receipt.durable === true && receipt.completeVerified === true && receipt.digest === transcriptDigest(transcript) && receipt.version === transcript.version, "TRANSCRIPT_SAVE_FAILED");
                const stored = await ports.store.readTranscript(lease);
                invariant(transcriptDigest(stored) === receipt.digest, "TRANSCRIPT_READBACK_FAILED");
                await ports.store.checkpoint(lease, { state: "transcript_saved", transcriptVersion: receipt.version, transcriptDigest: receipt.digest, providerRequestId: result.requestId, transcriptCompleteVerified: true, audioState: "delete_pending" });
                lease.job.transcriptCompleteVerified = true;
                lease.job.transcriptVersion = receipt.version;
                lease.job.transcriptDigest = receipt.digest;
                uncertainPhase = null;
            }
            finally {
                bytes.fill(0);
            }
        }
        // Immediate after durable transcription, not after eventual Share update or manual review.
        await ports.store.checkpoint(lease, { audioState: "delete_pending" });
        try {
            await ports.audio.deleteAndVerify(lease);
            await ports.store.checkpoint(lease, { audioState: "deleted" });
        }
        catch {
            await ports.store.checkpoint(lease, { audioState: "deletion_failed" });
            throw new WorkflowError("AUDIO_DELETION_FAILED");
        }
        await ports.store.assertCurrentPermission(lease);
        invariant(lease.job.state !== "analyzing" && lease.job.failureCode !== "ANALYSIS_OUTCOME_UNKNOWN", "ANALYSIS_OUTCOME_UNKNOWN");
        await ports.budget.reserve(`${lease.job.attemptId}:analysis:${transcript.version}:${summaryLocale}`, "analysis");
        await ports.store.checkpoint(lease, { state: "analyzing" });
        uncertainPhase = "analysis";
        const analysis = await ports.analyst.analyze(transcript, summaryLocale);
        validateAnalysis(analysis, transcript);
        await ports.store.assertCurrentPermission(lease);
        await ports.store.saveAnalysis(lease, analysis);
        await ports.store.complete(lease);
        uncertainPhase = null;
        return { status: "private_analysis_ready" as const };
    }
    catch (error) {
        // No stack, provider error body, transcript, names or payloads enter failure metadata.
        const code = uncertainPhase === "transcription" ? "PROVIDER_OUTCOME_UNKNOWN" : uncertainPhase === "analysis" ? "ANALYSIS_OUTCOME_UNKNOWN" : error instanceof WorkflowError ? error.code : "PROCESSING_FAILED";
        await ports.store.fail(lease, code);
        return { status: "failed" as const, code };
    }
    finally {
        await ports.store.release(lease);
    }
}
