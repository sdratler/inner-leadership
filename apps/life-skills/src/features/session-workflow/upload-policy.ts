import { createHash } from "node:crypto";
import { invariant, nonempty } from "./policy.ts";
export interface UploadFacts {
    bytes: number;
    extension: string;
    declaredMime: string;
    detectedContainer: string;
}
export const UPLOAD_LIMIT = 64 * 1024 * 1024;
const containers: Readonly<Record<string, readonly string[]>> = { mp3: ["audio/mpeg"], m4a: ["audio/mp4", "audio/x-m4a"], wav: ["audio/wav", "audio/x-wav"], ogg: ["audio/ogg"], webm: ["audio/webm"], flac: ["audio/flac", "audio/x-flac"] };
export function validateAudioUpload(facts: UploadFacts): void {
    invariant(Number.isInteger(facts.bytes) && facts.bytes > 0 && facts.bytes <= UPLOAD_LIMIT, "AUDIO_SIZE");
    const ext = facts.extension.toLowerCase().replace(/^\./, "");
    invariant(containers[ext]?.includes(facts.declaredMime.toLowerCase()) && facts.detectedContainer === ext, "AUDIO_TYPE");
    // detectedContainer must come from server-side signature/media inspection, not a client JSON field.
}
export function uploadIdentity(input: {
    workspaceId: string;
    caseId: string;
    appointmentId: string;
    sha256: string;
}): string {
    invariant(nonempty(input.workspaceId) && nonempty(input.caseId) && nonempty(input.appointmentId) && /^[a-f0-9]{64}$/.test(input.sha256), "UPLOAD_IDENTITY");
    return createHash("sha256").update(JSON.stringify([input.workspaceId, input.caseId, input.appointmentId, input.sha256])).digest("hex");
}
export function safeAudioObjectKey(workspaceId: string, caseId: string, recordingId: string): string {
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    invariant([workspaceId, caseId, recordingId].every(v => uuid.test(v)), "AUDIO_OBJECT_SCOPE");
    return `session-audio/${workspaceId}/${caseId}/${recordingId}`;
}
