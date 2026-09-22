import type { EvidenceQuote, Transcript, CaseContext } from "./types.ts";
import { invariant, nonempty, validDate } from "./policy.ts";
import { validClock, validateResponsibility, resolvePracticeTime } from "../assignment-participants/scheduling.ts";
import type { Responsibility, SavedPracticeDefault } from "../assignment-participants/contracts.ts";
export interface PracticeProposal {
    id: string;
    participant: "client" | "parent_support";
    instruction: string;
    weekdays: readonly number[];
    localTime: string | null;
    durationDays: number;
    evidence: readonly EvidenceQuote[];
}
export interface PracticeExtraction {
    schemaVersion: 1;
    transcriptVersion: number;
    proposals: readonly PracticeProposal[];
    unresolved: readonly string[];
}
/** Strict schema boundary: no recipients, forms, billing, diagnoses, ratings or appointment booking in model output. */
export function validatePracticeExtraction(extraction: PracticeExtraction, transcript: Transcript): void {
    invariant(Object.keys(extraction).sort().join() === ["schemaVersion", "transcriptVersion", "proposals", "unresolved"].sort().join(), "EXTRACTION_FIELDS");
    invariant(extraction.schemaVersion === 1 && extraction.transcriptVersion === transcript.version && Array.isArray(extraction.proposals) && extraction.proposals.length <= 10, "EXTRACTION_VERSION");
    const ids = new Set<string>();
    for (const p of extraction.proposals) {
        invariant(Object.keys(p).sort().join() === ["id", "participant", "instruction", "weekdays", "localTime", "durationDays", "evidence"].sort().join(), "PROPOSAL_FIELDS");
        invariant(nonempty(p.id, 100) && !ids.has(p.id) && ["client", "parent_support"].includes(p.participant) && nonempty(p.instruction, 1000), "PROPOSAL_ID");
        ids.add(p.id);
        invariant(Array.isArray(p.weekdays) && p.weekdays.length > 0 && p.weekdays.length <= 7 && new Set(p.weekdays).size === p.weekdays.length && p.weekdays.every((d: unknown) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6), "PROPOSAL_DAYS");
        invariant((p.localTime === null || validClock(p.localTime)) && Number.isInteger(p.durationDays) && p.durationDays >= 1 && p.durationDays <= 28, "PROPOSAL_TIME");
        invariant(Array.isArray(p.evidence) && p.evidence.length > 0 && p.evidence.length <= 12, "PROPOSAL_EVIDENCE");
        for (const quote of p.evidence) {
            const segment = transcript.segments.find(s => s.id === quote.segmentId);
            invariant(segment && nonempty(quote.quote, 1600) && segment.text.includes(quote.quote), "PROPOSAL_QUOTE");
        }
    }
    invariant(Array.isArray(extraction.unresolved) && extraction.unresolved.length <= 20 && extraction.unresolved.every((x: unknown) => typeof x === "string" && nonempty(x, 1000)), "EXTRACTION_UNRESOLVED");
}
export interface AssignmentBinding {
    assignmentId: string;
    responsibilityId: string;
    version: number;
    startsOn: string;
    timezone: string;
    assigneeAccountIds: readonly string[];
    assistedByParentAccountIds: readonly string[];
    audienceAccountIds: readonly string[];
    subjectPersonId: string;
    reminderRecipients: Responsibility["reminderRecipients"];
}
/** Server-side binding, explicit practitioner-selected participants. Output remains DRAFT, never scheduled/shared automatically. */
export function bindPracticeDraft(proposal: PracticeProposal, context: CaseContext, binding: AssignmentBinding, defaults: SavedPracticeDefault | null): Responsibility {
    invariant(context.active && validDate(binding.startsOn), "PRACTICE_BINDING");
    const visibleMembers = context.members.filter(m => m.active && binding.audienceAccountIds.includes(m.accountId));
    invariant(binding.audienceAccountIds.length > 0 && visibleMembers.length === new Set(binding.audienceAccountIds).size, "PRACTICE_BINDING_AUDIENCE");
    if (proposal.participant === "client")
        invariant(binding.subjectPersonId === context.clientPersonId, "PRACTICE_SUBJECT");
    else
        invariant(binding.assigneeAccountIds.length > 0 && binding.assigneeAccountIds.every(id => visibleMembers.some(m => m.accountId === id && m.role === "parent")), "PARENT_SUPPORT_ASSIGNEE");
    const ends = new Date(Date.parse(binding.startsOn + "T00:00:00Z") + (proposal.durationDays - 1) * 86400000).toISOString().slice(0, 10);
    const r: Responsibility = { id: binding.responsibilityId, assignmentId: binding.assignmentId, version: binding.version, workspaceId: context.workspaceId, caseId: context.caseId, subjectPersonId: binding.subjectPersonId, participant: proposal.participant === "client" ? "client" : "parent", instructions: proposal.instruction, assigneeAccountIds: [...binding.assigneeAccountIds], assistedByParentAccountIds: [...binding.assistedByParentAccountIds], audienceAccountIds: [...binding.audienceAccountIds], reminderRecipients: [...binding.reminderRecipients], completionMode: "any_assignee", startsOn: binding.startsOn, endsOn: ends, weekdays: [...proposal.weekdays], localTime: proposal.localTime, timezone: binding.timezone, timeOrigin: "session_agreement", state: "draft" };
    const resolved = resolvePracticeTime(r, defaults);
    Object.assign(r, resolved);
    validateResponsibility(r);
    return r;
}
