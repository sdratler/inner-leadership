import type { CaseScope } from "../../lib/workspace.ts";
import { one, type IdentityStore } from "../identity/store.ts";
import type { ParentReportId, ParentReportReader, ParentReportReference } from "./types.ts";

/**
 * LS-050-compatible attribution reader. It returns no narrative, review state,
 * witnessing claim, verification claim or clinical conclusion.
 */
export class DatabaseParentReportReader implements ParentReportReader {
  constructor(private readonly store: IdentityStore) {}

  async getAuthorizedReport(scope: CaseScope, reportId: ParentReportId): Promise<ParentReportReference | null> {
    const row = await this.store.transaction(tx => one<Omit<ParentReportReference, "sourceType" | "submittedAt"> & { submittedAt: Date }>(tx, `SELECT
      r.id AS "reportId",r.workspace_id AS "workspaceId",r.case_id AS "caseId",r.audience_id AS "audienceId",
      r.author_account_id AS "authorAccountId",r.submitted_at AS "submittedAt"
     FROM ls_updates.parent_reports r
     JOIN ls_cases.audiences au
       ON au.workspace_id=r.workspace_id AND au.case_id=r.case_id AND au.id=r.audience_id
     WHERE r.workspace_id=$1 AND r.case_id=$2 AND r.id=$3 AND au.published=true AND au.visibility='family_full'
       AND (EXISTS(SELECT 1 FROM ls_cases.cases c
         JOIN ls_identity.accounts ac ON ac.workspace_id=c.workspace_id AND ac.id=c.practitioner_account_id
         WHERE c.workspace_id=r.workspace_id AND c.id=r.case_id AND c.practitioner_account_id=$4
           AND ac.state='active' AND ac.role='practitioner')
        OR EXISTS(SELECT 1 FROM ls_cases.audience_accounts aa
          JOIN ls_cases.case_guardians g ON g.workspace_id=aa.workspace_id AND g.case_id=aa.case_id AND g.account_id=aa.account_id
          JOIN ls_identity.accounts ac ON ac.workspace_id=aa.workspace_id AND ac.id=aa.account_id
          WHERE aa.workspace_id=r.workspace_id AND aa.case_id=r.case_id AND aa.audience_id=r.audience_id
            AND aa.account_id=$4 AND aa.revoked_at IS NULL AND g.revoked_at IS NULL
            AND ac.state='active' AND ac.role='parent'))`,
    [scope.workspaceId, scope.caseId, reportId, scope.accountId]));
    if (!row) return null;
    return { ...row, submittedAt: new Date(row.submittedAt).toISOString(), sourceType: "parent_report" };
  }
}

