import { describe, expect, it } from "vitest";
import { asId } from "../../src/lib/ids.ts";
import { AppError } from "../../src/lib/errors.ts";
import type { CoordinationSnapshot } from "../../src/features/identity/interfaces.ts";
import {
  assertAssigneeMayReport, assertCalendarDate, assertCompletionStatus, assertPeriod,
  occurrenceShouldClose, selectReminderCandidates,
} from "../../src/features/home-practice/policy.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const parentA = asId(uuid(1), "account"), parentB = asId(uuid(2), "account");
const base = {
  versionId: asId(uuid(3), "coordination_version"), caseId: asId(uuid(4), "case"),
  audienceId: asId(uuid(5), "audience"), assigneeAccountIds: [parentA, parentB],
  effectiveFrom: "2026-09-12T06:00:00.000Z", changedByAccountId: parentA,
} as const;

describe("LS-040 policy", () => {
  it.each(["2026-01-01", "2028-02-29", "2026-12-31"])("accepts real calendar date %s", value => {
    expect(assertCalendarDate(value)).toBe(value);
  });
  it.each(["2026-02-29", "2026-13-01", "2026-00-01", "2026-01-32", "11-09-2026", ""])("rejects invalid calendar date %s", value => {
    expect(() => assertCalendarDate(value)).toThrowError(new AppError("INVALID_REQUEST"));
  });
  it.each(["morning", "evening"] as const)("keeps %s as a distinct occurrence period", value => {
    expect(assertPeriod(value)).toBe(value);
  });
  it("rejects an invented occurrence period", () => expect(() => assertPeriod("daily")).toThrowError(new AppError("INVALID_REQUEST")));
  it.each(["done", "partly_done", "not_done", "rescheduled", "not_applicable"] as const)("accepts explicit status %s", value => {
    expect(assertCompletionStatus(value)).toBe(value);
  });
  it.each(["unreported", "missed", "failed", "score_10"])("keeps %s outside completion status", value => {
    expect(() => assertCompletionStatus(value)).toThrowError(new AppError("INVALID_REQUEST"));
  });
  it("allows only an actual assignee to report", () => {
    const snapshot: CoordinationSnapshot = { ...base, completionMode: "any_assignee" };
    expect(() => assertAssigneeMayReport(snapshot, parentA)).not.toThrow();
    expect(() => assertAssigneeMayReport(snapshot, asId(uuid(9), "account"))).toThrowError(new AppError("NOT_FOUND"));
  });
  it("closes any_assignee after exactly one parent's report", () => {
    expect(occurrenceShouldClose({ ...base, completionMode: "any_assignee" }, [])).toBe(false);
    expect(occurrenceShouldClose({ ...base, completionMode: "any_assignee" }, [parentA])).toBe(true);
  });
  it("closes each_assignee only after both distinct parents report", () => {
    const snapshot: CoordinationSnapshot = { ...base, completionMode: "each_assignee" };
    expect(occurrenceShouldClose(snapshot, [parentA])).toBe(false);
    expect(occurrenceShouldClose(snapshot, [parentA, parentA])).toBe(false);
    expect(occurrenceShouldClose(snapshot, [parentA, parentB])).toBe(true);
  });
  it("filters reminder candidates through each parent's current opt-in", () => {
    const snapshot = { ...base, completionMode: "each_assignee" as const, reminderCandidateAccountIds: [parentA, parentB] };
    expect(selectReminderCandidates(snapshot, [parentB])).toEqual([parentB]);
    expect(selectReminderCandidates(snapshot, [])).toEqual([]);
  });
});

