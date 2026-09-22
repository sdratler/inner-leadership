import { createHash } from "node:crypto";
import { invariant, nonempty, validDate, validIso, validTimezone } from "../session-workflow/policy.ts";
import type { Responsibility, SavedPracticeDefault, PracticeOccurrence } from "./contracts.ts";
export const validClock = (s: unknown): s is string => typeof s === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
export function resolvePracticeTime(r: Responsibility, saved: SavedPracticeDefault | null): {
    localTime: string;
    timezone: string;
    timeOrigin: Responsibility["timeOrigin"];
} {
    invariant(validTimezone(r.timezone), "PRACTICE_TIMEZONE");
    if (r.localTime !== null) {
        invariant(validClock(r.localTime), "PRACTICE_TIME");
        return { localTime: r.localTime, timezone: r.timezone, timeOrigin: r.timeOrigin };
    }
    invariant(saved && validClock(saved.localTime) && saved.timezone === r.timezone && nonempty(saved.selectedByAccountId) && validIso(saved.selectedAt), "PRACTICE_TIME_REQUIRED");
    return { localTime: saved.localTime, timezone: saved.timezone, timeOrigin: "case_default" };
}
function wallParts(instant: number, timezone: string) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
/** Returns actual instants for a local wall time. Zero=gap; two=fold, never a silent +24h shift. */
export function wallTimeCandidates(date: string, time: string, timezone: string): readonly string[] {
    invariant(validDate(date) && validClock(time) && validTimezone(timezone), "LOCAL_TIME_INVALID");
    const wall = Date.parse(`${date}T${time}:00Z`), offsets = new Set<number>();
    for (const hours of [-36, -12, 0, 12, 36]) {
        const probe = wall + hours * 3600000, p = wallParts(probe, timezone);
        offsets.add(Date.parse(`${p.date}T${p.time}:00Z`) - probe);
    }
    const results = new Set<string>();
    for (const offset of offsets) {
        const candidate = wall - offset, p = wallParts(candidate, timezone);
        if (p.date === date && p.time === time)
            results.add(new Date(candidate).toISOString());
    }
    return [...results].sort();
}
export function validateResponsibility(r: Responsibility): void {
    invariant([r.id, r.assignmentId, r.workspaceId, r.caseId, r.subjectPersonId].every(x => nonempty(x)), "RESPONSIBILITY_IDS");
    invariant(Number.isInteger(r.version) && r.version > 0 && nonempty(r.instructions, 2000), "RESPONSIBILITY_CONTENT");
    invariant(["client", "parent"].includes(r.participant) && ["any_assignee", "each_assignee"].includes(r.completionMode), "RESPONSIBILITY_MODE");
    invariant(validDate(r.startsOn) && validDate(r.endsOn) && r.startsOn <= r.endsOn && Date.parse(r.endsOn) - Date.parse(r.startsOn) <= 366 * 86400000, "RESPONSIBILITY_DATES");
    invariant(r.weekdays.length > 0 && r.weekdays.length <= 7 && new Set(r.weekdays).size === r.weekdays.length && r.weekdays.every(d => Number.isInteger(d) && d >= 0 && d <= 6), "RESPONSIBILITY_WEEKDAYS");
    invariant(r.audienceAccountIds.length > 0 && new Set(r.audienceAccountIds).size === r.audienceAccountIds.length, "RESPONSIBILITY_AUDIENCE");
    invariant([...r.assigneeAccountIds, ...r.assistedByParentAccountIds].every(id => r.audienceAccountIds.includes(id)), "RESPONSIBILITY_ACTOR_VISIBILITY");
    invariant(r.assigneeAccountIds.length > 0 || (r.participant === "client" && r.assistedByParentAccountIds.length > 0), "RESPONSIBILITY_NO_ACTOR");
    invariant(new Set(r.assigneeAccountIds).size === r.assigneeAccountIds.length && new Set(r.assistedByParentAccountIds).size === r.assistedByParentAccountIds.length, "RESPONSIBILITY_DUPLICATE_ACTOR");
    invariant(r.participant === "client" || r.assistedByParentAccountIds.length === 0, "ASSISTANCE_ONLY_FOR_CHILD");
    invariant(r.reminderRecipients.every(v => r.audienceAccountIds.includes(v.accountId) && ["self", "support", "remind_child"].includes(v.purpose)), "REMINDER_VISIBILITY");
    invariant(new Set(r.reminderRecipients.map(v => v.accountId)).size === r.reminderRecipients.length, "REMINDER_DUPLICATE_RECIPIENT");
    invariant(["session_agreement", "practitioner", "case_default"].includes(r.timeOrigin) && ["draft", "published", "paused", "ended"].includes(r.state), "RESPONSIBILITY_STATE");
    invariant(validTimezone(r.timezone) && (r.localTime === null || validClock(r.localTime)), "RESPONSIBILITY_TIME");
}
export function occurrenceId(r: Responsibility, date: string, instant: string): string {
    return "occ_" + createHash("sha256").update(JSON.stringify([r.workspaceId, r.caseId, r.assignmentId, r.id, r.version, date, instant])).digest("hex").slice(0, 32);
}
/** A bounded read/proposal operation. A transactional writer must dedupe IDs and cancel FUTURE old-version occurrences only. */
export function planOccurrences(r: Responsibility, saved: SavedPracticeDefault | null, horizonStart: string, days = 28, foldChoice: "earlier" | "later" | null = null): {
    occurrences: PracticeOccurrence[];
    unresolved: {
        date: string;
        code: string;
    }[];
} {
    validateResponsibility(r);
    invariant(r.state === "published", "ASSIGNMENT_NOT_PUBLISHED");
    invariant(validDate(horizonStart) && Number.isInteger(days) && days >= 1 && days <= 90, "HORIZON_INVALID");
    const time = resolvePracticeTime(r, saved), occurrences: PracticeOccurrence[] = [], unresolved: {
        date: string;
        code: string;
    }[] = [];
    for (let i = 0; i < days; i++) {
        // Iterate calendar dates in UTC, then resolve EACH date in the target zone (not previous instant +24h).
        const day = new Date(Date.parse(horizonStart + "T00:00:00Z") + i * 86400000), date = day.toISOString().slice(0, 10);
        if (date < r.startsOn || date > r.endsOn || !r.weekdays.includes(day.getUTCDay()))
            continue;
        const candidates = wallTimeCandidates(date, time.localTime, time.timezone);
        if (!candidates.length) {
            unresolved.push({ date, code: "DST_TIME_DOES_NOT_EXIST" });
            continue;
        }
        if (candidates.length > 1 && !foldChoice) {
            unresolved.push({ date, code: "DST_TIME_AMBIGUOUS" });
            continue;
        }
        const startsAt = (foldChoice === "later" ? candidates.at(-1) : candidates[0])!;
        occurrences.push({ id: occurrenceId(r, date, startsAt), assignmentId: r.assignmentId, responsibilityId: r.id, responsibilityVersion: r.version, workspaceId: r.workspaceId, caseId: r.caseId, localDate: date, ...time, startsAt });
    }
    return { occurrences, unresolved };
}
