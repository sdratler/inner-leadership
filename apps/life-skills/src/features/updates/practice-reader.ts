import type { CaseScope } from "../../lib/workspace.ts";
import type { PracticeVersionId, PracticeVersionReader, PracticeVersionReference } from "../identity/interfaces.ts";
import { one, type IdentityStore } from "../identity/store.ts";

/** I-013 adapter. LS-040 must be integrated before this query can run. */
export class SqlPublishedPracticeVersionReader implements PracticeVersionReader {
  constructor(private readonly store: IdentityStore) {}

  async getAuthorizedVersion(scope: CaseScope, versionId: PracticeVersionId): Promise<PracticeVersionReference | null> {
    return this.store.transaction(tx => one<PracticeVersionReference>(tx, `SELECT
      a.workspace_id AS "workspaceId",a.case_id AS "caseId",a.id AS "assignmentId",v.id AS "versionId",
      a.audience_id AS "audienceId",au.visibility,v.published_at AS "publishedAt",
      v.immutable_snapshot_digest AS "immutableSnapshotDigest"
     FROM ls_practice.practice_assignments a
     JOIN ls_practice.practice_assignment_versions v
       ON v.workspace_id=a.workspace_id AND v.assignment_id=a.id
     JOIN ls_cases.audiences au
       ON au.workspace_id=a.workspace_id AND au.case_id=a.case_id AND au.id=a.audience_id
     WHERE a.workspace_id=$1 AND a.case_id=$2 AND v.id=$3 AND v.state='published'
       AND au.published=true
       AND (EXISTS(SELECT 1 FROM ls_cases.cases c
         WHERE c.workspace_id=a.workspace_id AND c.id=a.case_id AND c.practitioner_account_id=$4)
        OR EXISTS(SELECT 1 FROM ls_cases.audience_accounts aa
          JOIN ls_cases.case_guardians g ON g.workspace_id=aa.workspace_id AND g.case_id=aa.case_id AND g.account_id=aa.account_id
          JOIN ls_identity.accounts ac ON ac.workspace_id=aa.workspace_id AND ac.id=aa.account_id
          WHERE aa.workspace_id=a.workspace_id AND aa.case_id=a.case_id AND aa.audience_id=a.audience_id
            AND aa.account_id=$4 AND aa.revoked_at IS NULL AND g.revoked_at IS NULL
            AND ac.state='active' AND ac.role='parent'))`,
    [scope.workspaceId, scope.caseId, versionId, scope.accountId]));
  }
}

