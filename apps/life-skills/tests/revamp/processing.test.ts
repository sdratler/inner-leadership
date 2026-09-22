/* eslint-disable @typescript-eslint/no-unused-vars */
import { test } from "node:test";
import assert from "node:assert/strict";
import { processSession, type ProcessingPorts, type Lease } from "../../src/features/session-workflow/processing.ts";
import { transcriptDigest } from "../../src/features/session-workflow/transcript.ts";
import { WorkflowError } from "../../src/features/session-workflow/policy.ts";
import { job, transcript, analysis, clone } from "./fixtures.ts";
function fixture() {
    const state = { job: clone(job), log: [] as string[], transcript: null as typeof transcript | null, analysis: null as typeof analysis | null, locked: false, raw: new Uint8Array([1, 2, 3]) };
    const ports: ProcessingPorts = { store: { async claim() {
                if (state.locked || state.job.state === "ready")
                    return null;
                state.locked = true;
                state.log.push("claim");
                return { job: state.job, fencingToken: "fence1" };
            }, async assertCurrentPermission() { state.log.push("authorize"); }, async checkpoint(_lease, patch) { void _lease; Object.assign(state.job, patch); state.log.push("checkpoint:" + JSON.stringify(patch)); }, async saveTranscript(_lease, t, _clean, request) { state.transcript = clone(t); state.job.transcriptCompleteVerified = true; state.job.transcriptVersion = t.version; state.job.transcriptDigest = transcriptDigest(t); state.job.providerRequestId = request; state.job.state = "transcript_saved"; state.log.push("durable_transcript"); return { version: t.version, digest: transcriptDigest(t), durable: true, completeVerified: true }; }, async readTranscript() {
                state.log.push("readback");
                if (!state.transcript)
                    throw new Error("missing");
                return clone(state.transcript);
            }, async saveAnalysis(_lease, a) { state.analysis = clone(a); state.log.push("analysis_saved"); }, async complete() { state.job.state = "ready"; state.log.push("complete"); }, async fail(_lease, code) { state.job.state = "failed"; state.job.failureCode = code; state.log.push("fail:" + code); }, async release() { state.locked = false; } }, audio: { async readVerified() { state.log.push("audio_read"); return state.raw; }, async deleteAndVerify() { state.log.push("delete_audio"); return "deleted"; } }, transcriber: { async transcribe() { state.log.push("transcribe"); return { transcript: clone(transcript), requestId: "request1", completion: { sourceDigest: job.sourceDigest, sourceDurationMs: 60000, coveredDurationMs: 60000, expectedChunks: 1, completedChunks: 1, providerCompleted: true } }; } }, analyst: { async analyze() { state.log.push("analyze"); return clone(analysis); } }, budget: { async reserve(id, phase) { state.log.push("budget:" + phase + ":" + id); } } };
    return { state, ports };
}
test("automatic processing saves/readbacks transcript before deleting raw, then private analysis", async () => { const { state, ports } = fixture(); assert.deepEqual(await processSession(job.id, ports), { status: "private_analysis_ready" }); assert(state.log.indexOf("durable_transcript") < state.log.indexOf("delete_audio")); assert(state.log.indexOf("readback") < state.log.indexOf("delete_audio")); assert(state.log.indexOf("delete_audio") < state.log.indexOf("analyze")); assert.equal(state.job.audioState, "deleted"); assert.deepEqual([...state.raw], [0, 0, 0]); });
test("completed duplicate job does not call provider twice", async () => { const { state, ports } = fixture(); await processSession(job.id, ports); assert.equal((await processSession(job.id, ports)).status, "already_running_or_complete"); assert.equal(state.log.filter(x => x === "transcribe").length, 1); });
test("lease already claimed prevents a second worker", async () => { const { state, ports } = fixture(); state.locked = true; await processSession(job.id, ports); assert.equal(state.log.length, 0); });
test("denied current consent prevents audio read/provider work", async () => { const { state, ports } = fixture(); ports.store.assertCurrentPermission = async () => { throw new WorkflowError("RECORDING_NOT_AUTHORIZED"); }; assert.deepEqual(await processSession(job.id, ports), { status: "failed", code: "RECORDING_NOT_AUTHORIZED" }); assert.equal(state.log.includes("audio_read"), false); });
test("lost transcription response stops blind replay", async () => { const { state, ports } = fixture(); ports.transcriber.transcribe = async () => { state.log.push("transcribe"); throw new Error("provider secret error"); }; assert.deepEqual(await processSession(job.id, ports), { status: "failed", code: "PROVIDER_OUTCOME_UNKNOWN" }); await processSession(job.id, ports); assert.equal(state.log.filter(x => x === "transcribe").length, 1); assert.equal(state.log.some(x => x.includes("secret")), false); });
test("readback failure never deletes audio", async () => { const { state, ports } = fixture(); ports.store.readTranscript = async () => ({ ...transcript, version: 99 }); const result = await processSession(job.id, ports); assert.equal(result.status, "failed"); assert.equal(state.log.includes("delete_audio"), false); });
test("audio deletion failure is visible and blocks completion", async () => { const { state, ports } = fixture(); ports.audio.deleteAndVerify = async () => { throw new Error("access denied"); }; assert.deepEqual(await processSession(job.id, ports), { status: "failed", code: "AUDIO_DELETION_FAILED" }); assert.equal(state.job.audioState, "deletion_failed"); assert.equal(state.log.includes("complete"), false); });
test("deletion retry reuses durable transcript without retranscription", async () => {
    const { state, ports } = fixture();
    let attempts = 0;
    ports.audio.deleteAndVerify = async () => {
        if (attempts++ === 0)
            throw new Error("busy");
        state.log.push("delete_audio");
        return "deleted";
    };
    await processSession(job.id, ports);
    assert.equal((await processSession(job.id, ports)).status, "private_analysis_ready");
    assert.equal(state.log.filter(x => x === "transcribe").length, 1);
});
test("analysis loss never blindly incurs a second analysis request", async () => { const { state, ports } = fixture(); ports.analyst.analyze = async () => { state.log.push("analyze"); throw new Error("lost"); }; assert.deepEqual(await processSession(job.id, ports), { status: "failed", code: "ANALYSIS_OUTCOME_UNKNOWN" }); await processSession(job.id, ports); assert.equal(state.log.filter(x => x === "analyze").length, 1); });
test("corrupted durable transcript cannot be treated as success on retry", async () => { const { state, ports } = fixture(); state.transcript = clone(transcript); state.job.transcriptVersion = 1; state.job.transcriptDigest = "f".repeat(64); assert.equal((await processSession(job.id, ports)).status, "failed"); assert.equal(state.log.includes("delete_audio"), false); });
test("no publication or messages exist in processing ports", async () => { const { state, ports } = fixture(); await processSession(job.id, ports); assert.equal(Object.keys(ports).includes("publisher"), false); assert.equal(state.log.some(x => x.includes("send") || x.includes("share")), false); });
test("expired lease cannot save a transcript or delete source", async () => { const { state, ports } = fixture(); ports.store.saveTranscript = async (_lease: Lease) => { throw new WorkflowError("LEASE_EXPIRED"); }; await processSession(job.id, ports); assert.equal(state.log.includes("delete_audio"), false); assert.equal(state.analysis, null); });
test("incomplete chunk receipt never permits raw deletion", async () => { const { state, ports } = fixture(); ports.transcriber.transcribe = async () => ({ transcript: clone(transcript), requestId: "r", completion: { sourceDigest: job.sourceDigest, sourceDurationMs: 60000, coveredDurationMs: 30000, expectedChunks: 2, completedChunks: 1, providerCompleted: true } }); const outcome = await processSession(job.id, ports); assert.equal(outcome.status, "failed"); assert.equal(state.log.includes("delete_audio"), false); assert.equal(state.transcript, null); });
test("saved pointer without completeness receipt cannot delete raw on resume", async () => { const { state, ports } = fixture(); state.transcript = clone(transcript); state.job.transcriptVersion = 1; state.job.transcriptDigest = transcriptDigest(transcript); state.job.transcriptCompleteVerified = false; assert.deepEqual(await processSession(job.id, ports), { status: "failed", code: "TRANSCRIPT_COMPLETENESS_NOT_VERIFIED" }); assert.equal(state.log.includes("delete_audio"), false); });
