-- One encrypted Fishing marketing projection; this table contains no leads or tasks.
CREATE TABLE ls_service_interest.fishing_marketing_snapshot (
 workspace_id uuid PRIMARY KEY REFERENCES ls_identity.workspaces(id),
 owner_account_id uuid NOT NULL,
 generated_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TRIGGER fishing_marketing_no_delete BEFORE DELETE ON ls_service_interest.fishing_marketing_snapshot
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER fishing_marketing_no_truncate BEFORE TRUNCATE ON ls_service_interest.fishing_marketing_snapshot
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.fishing_marketing_snapshot FROM PUBLIC;
