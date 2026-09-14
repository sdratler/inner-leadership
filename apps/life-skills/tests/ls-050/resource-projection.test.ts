import { describe, expect, it } from "vitest";
import { projectResource } from "../../src/features/resources/service.ts";
import { asId } from "../../src/lib/ids.ts";

const row = {
  assignmentId: asId("10000000-0000-4000-8000-000000000001", "resource_assignment"),
  resourceId: asId("10000000-0000-4000-8000-000000000002", "resource"),
  caseId: asId("10000000-0000-4000-8000-000000000003", "case"),
  audienceId: asId("10000000-0000-4000-8000-000000000004", "audience"),
  type: "pdf" as const,
  title: "A parent worksheet",
  description: "Protected instructions",
  reference: { kind: "storage_key" as const, value: "private/workspace/resource.pdf" },
  downloadable: true,
  locale: "en" as const,
  dueDate: "2026-01-10",
  displayDate: "2026-01-01",
  completionEnabled: true,
  completed: false,
  completedByAccountId: null,
};

describe("resource audience projection", () => {
  it("limits family_title_completion to title and completion", () => {
    const projection = projectResource(row, false);
    expect(projection).toEqual({ assignmentId: row.assignmentId, resourceId: row.resourceId, title: row.title, completed: false, detailsAvailable: false });
    expect(projection).not.toHaveProperty("description");
    expect(projection).not.toHaveProperty("reference");
  });

  it("returns the deliberately shared reference only for full audience", () => {
    const projection = projectResource(row, true);
    expect(projection.detailsAvailable).toBe(true);
    expect(projection).toHaveProperty("reference", row.reference);
    expect(projection).toHaveProperty("description", row.description);
  });
});
