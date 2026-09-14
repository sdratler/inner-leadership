import { describe, expect, it } from "vitest";
import { asId } from "../../src/lib/ids.ts";
import type { IdentityStore, SqlSession } from "../../src/features/identity/store.ts";
import { DatabaseParentReportReader } from "../../src/features/updates/sources.ts";

const uuid = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  workspace: asId(uuid(1), "workspace"), account: asId(uuid(2), "account"), case: asId(uuid(3), "case"),
  audience: asId(uuid(4), "audience"), author: asId(uuid(5), "account"), report: asId(uuid(6), "parent_report"),
};

describe("LS-080 ParentReportReader for LS-050", () => {
  it("returns only the exact attributed source reference", async () => {
    const tx: SqlSession = { async query<T extends object>() { return [{ reportId: ids.report, workspaceId: ids.workspace, caseId: ids.case, audienceId: ids.audience, authorAccountId: ids.author, submittedAt: new Date("2026-09-11T14:00:00.000Z") }] as T[]; } };
    const store: IdentityStore = { transaction: work => work(tx) };
    const result = await new DatabaseParentReportReader(store).getAuthorizedReport({ workspaceId: ids.workspace, accountId: ids.account, caseId: ids.case }, ids.report);
    expect(result).toEqual({ reportId: ids.report, workspaceId: ids.workspace, caseId: ids.case, audienceId: ids.audience, authorAccountId: ids.author, submittedAt: "2026-09-11T14:00:00.000Z", sourceType: "parent_report" });
    expect(Object.keys(result ?? {}).sort()).toEqual(["audienceId", "authorAccountId", "caseId", "reportId", "sourceType", "submittedAt", "workspaceId"]);
  });

  it("returns null without an exact authorized row", async () => {
    const tx: SqlSession = { async query<T extends object>() { return [] as T[]; } };
    const store: IdentityStore = { transaction: work => work(tx) };
    await expect(new DatabaseParentReportReader(store).getAuthorizedReport({ workspaceId: ids.workspace, accountId: ids.account, caseId: ids.case }, ids.report)).resolves.toBeNull();
  });

  it("pins case, report and actor and checks live full-audience membership", async () => {
    let captured = ""; let values: readonly unknown[] = [];
    const tx: SqlSession = { async query<T extends object>(sql: string, supplied: readonly unknown[] = []) { captured = sql; values = supplied; return [] as T[]; } };
    const store: IdentityStore = { transaction: work => work(tx) };
    await new DatabaseParentReportReader(store).getAuthorizedReport({ workspaceId: ids.workspace, accountId: ids.account, caseId: ids.case }, ids.report);
    expect(values).toEqual([ids.workspace, ids.case, ids.report, ids.account]);
    expect(captured).toContain("au.visibility='family_full'");
    expect(captured).toContain("aa.revoked_at IS NULL");
    expect(captured).toContain("g.revoked_at IS NULL");
    expect(captured).not.toMatch(/review_state|witness|verif/i);
  });
});

