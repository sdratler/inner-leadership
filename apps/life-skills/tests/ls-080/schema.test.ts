import { describe, expect, it } from "vitest";
import { updateActionSchema } from "../../src/features/updates/http.ts";

const uuid = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const valid = {
  action: "submit_report",
  caseId: uuid(1),
  audienceId: uuid(2),
  practiceVersionId: uuid(3),
  body: "A synthetic contextual observation.",
  idempotencyKey: uuid(4),
} as const;

describe("LS-080 strict browser schemas", () => {
  it("accepts the minimum contextual parent report", () => {
    expect(updateActionSchema.safeParse(valid).success).toBe(true);
  });

  for (const forbidden of ["authorAccountId", "workspaceId", "reviewState", "reviewed", "witnessed", "verified", "clinicallyVerified", "rating", "grade", "score", "privateNote"] as const) {
    it(`rejects client authority or clinical field ${forbidden}`, () => {
      expect(updateActionSchema.safeParse({ ...valid, [forbidden]: "forbidden" }).success).toBe(false);
    });
  }

  it("requires an immutable published practice version identifier", () => {
    const { practiceVersionId: _, ...withoutVersion } = valid;
    void _;
    expect(updateActionSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it("bounds narrative input", () => {
    expect(updateActionSchema.safeParse({ ...valid, body: "" }).success).toBe(false);
    expect(updateActionSchema.safeParse({ ...valid, body: "x".repeat(8_001) }).success).toBe(false);
  });

  it("does not accept a parent-authored adaptation action", () => {
    expect(updateActionSchema.safeParse({ action: "adapt", reportId: uuid(5), adaptedInstructions: "Synthetic revision", idempotencyKey: uuid(6), authorAccountId: uuid(7) }).success).toBe(false);
  });
});

