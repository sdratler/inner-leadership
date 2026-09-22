/** Serializable feature contracts. Session/role facts MUST be loaded server-side. */
export type Locale = "en" | "he";
export type CaseMode = "adult" | "minor_parent_managed" | "minor_own_device";
export type Role = "practitioner" | "parent" | "adult_client" | "child";
export interface Principal {
    accountId: string;
    workspaceId: string;
    personId: string;
    role: Role;
    active: boolean;
}
export interface CaseMember {
    accountId: string;
    personId: string;
    role: Exclude<Role, "practitioner">;
    active: boolean;
    routineRecap: boolean;
}
export interface CaseContext {
    workspaceId: string;
    caseId: string;
    clientPersonId: string;
    practitionerAccountId: string;
    mode: CaseMode;
    active: boolean;
    members: readonly CaseMember[];
}
export interface RecordingConsent {
    id: string;
    caseId: string;
    workspaceId: string;
    version: number;
    signedByAccountId: string;
    authorityChecked: boolean;
    recording: boolean;
    transcription: boolean;
    aiProcessing: boolean;
    signedAt: string;
    withdrawnAt: string | null;
    restriction: "none_recorded" | "review_required" | "prohibited";
    childInformed: boolean;
}
export type BroadFocus = "responsibility" | "communication" | "regulation" | "values" | "planning" | "relationships" | "problem_solving";
export interface TranscriptSegment {
    id: string;
    speaker: string;
    startMs: number;
    endMs: number;
    text: string;
}
export interface Transcript {
    version: number;
    durationMs: number;
    languages: readonly Locale[];
    segments: readonly TranscriptSegment[];
    /** Provider's immutable source transcript, NOT a guaranteed verbatim account. */
    source: "machine_transcript";
}
export interface CleanSegment {
    sourceSegmentId: string;
    text: string;
}
export interface EvidenceQuote {
    segmentId: string;
    quote: string;
}
export interface AnalysisItem {
    text: string;
    evidence: readonly EvidenceQuote[];
}
export interface PrivateAnalysis {
    schemaVersion: 1;
    locale: Locale;
    transcriptVersion: number;
    summary: readonly AnalysisItem[];
    observations: readonly AnalysisItem[];
    possibleInterpretations: readonly AnalysisItem[];
    nextSessionTopics: readonly AnalysisItem[];
    limitations: readonly string[];
}
export type ProcessingStage = "queued" | "transcribing" | "transcript_saved" | "analyzing" | "ready" | "failed" | "canceled";
export type AudioState = "temporary" | "delete_pending" | "deleted" | "deletion_failed";
export interface ProcessingJob {
    id: string;
    workspaceId: string;
    caseId: string;
    appointmentId: string;
    consentId: string;
    consentVersion: number;
    sourceDigest: string;
    sourceDurationMs: number;
    transcriptCompleteVerified: boolean;
    state: ProcessingStage;
    audioState: AudioState;
    transcriptVersion: number | null;
    transcriptDigest: string | null;
    /** Stable attempt ID: never silently retry a paid request with unknown outcome. */
    attemptId: string;
    providerRequestId: string | null;
    failureCode: string | null;
    revision: number;
}
export interface AttendanceSnapshot {
    appointmentId: string;
    state: "present" | "late" | "no_show" | "canceled" | "unrecorded";
    source: "appointment_record";
    revision: number;
    startsAt: string;
    arrivedAt: string | null;
}
export interface NextAppointmentSnapshot {
    id: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    /** Existing appointment/billing flow owns this field; audio never creates it. */
    source: "calendar";
}
export interface SharedPractice {
    assignmentId: string;
    version: number;
    responsibilityId: string;
    audienceAccountIds: readonly string[];
    participant: "client" | "parent";
    instructions: string;
    localTime: string;
    timezone: string;
    startsOn: string;
    endsOn: string;
}
export interface RoutineRecap {
    schemaVersion: 1;
    sessionId: string;
    caseId: string;
    version: number;
    locale: Locale;
    attendance: AttendanceSnapshot;
    focus: readonly BroadFocus[];
    practices: readonly SharedPractice[];
    nextStep: string;
    nextAppointment: NextAppointmentSnapshot | null;
}
export interface SharedRecapRecord {
    id: string;
    workspaceId: string;
    caseId: string;
    sessionId: string;
    recap: RoutineRecap;
    recipientAccountIds: readonly string[];
    contentDigest: string;
    sharedAt: string;
    sharedByAccountId: string;
    publicationVersion: number;
}
export interface DisclosureRecord {
    id: string;
    workspaceId: string;
    caseId: string;
    sessionId: string | null;
    recipient: string;
    purpose: string;
    topic: string;
    channel: "phone" | "meeting" | "secure_message";
    authorizedByAccountId: string;
    authorityBasis: string;
    childDiscussionRecorded: boolean;
    authorizedAt: string;
    expiresAt: string;
    revokedAt: string | null;
    usedAt: string | null;
}
