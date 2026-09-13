-- LS-070: durable replay binding for the LS-080 to LS-040 practice-adaptation seam.
-- Apply after 0040 and before 0080. This migration does not publish a practice version.
CREATE SCHEMA IF NOT EXISTS ls_integration;

CREATE TABLE IF NOT EXISTS ls_integration.practice_adaptation_receipts (
 workspace_id uuid NOT NULL,
 source_report_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 case_id uuid NOT NULL,
 assignment_id uuid NOT NULL,
 previous_version_id uuid NOT NULL,
 new_version_id uuid NOT NULL,
 practitioner_account_id uuid NOT NULL,
 state text NOT NULL CHECK(state='draft'),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,source_report_id,idempotency_key),
 UNIQUE(workspace_id,new_version_id),
 FOREIGN KEY(workspace_id,case_id,assignment_id) REFERENCES ls_practice.practice_assignments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,previous_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,new_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,practitioner_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(previous_version_id<>new_version_id)
);

CREATE INDEX IF NOT EXISTS practice_adaptation_receipts_by_assignment
 ON ls_integration.practice_adaptation_receipts(workspace_id,assignment_id,created_at DESC);

DROP TRIGGER IF EXISTS protect_practice_adaptation_receipt ON ls_integration.practice_adaptation_receipts;
CREATE TRIGGER protect_practice_adaptation_receipt BEFORE UPDATE OR DELETE ON ls_integration.practice_adaptation_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_practice.protect_immutable_row();

COMMENT ON TABLE ls_integration.practice_adaptation_receipts IS
 'Immutable replay binding for one reviewed report and idempotency key to one practitioner-authored LS-040 draft. No automatic publication.';
