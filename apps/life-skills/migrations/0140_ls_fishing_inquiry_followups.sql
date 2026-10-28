-- Owner actions on saved Fishing inquiries remain in the existing service-interest store.
-- An action neither promotes a Person nor creates a task, message, booking or charge.
CREATE TABLE ls_service_interest.fishing_inquiry_followups (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 application_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 UNIQUE(workspace_id,application_id,version),
 FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX fishing_inquiry_followup_history ON ls_service_interest.fishing_inquiry_followups(workspace_id,application_id,version DESC);
CREATE TRIGGER fishing_inquiry_followups_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.fishing_inquiry_followups
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER fishing_inquiry_followups_no_truncate BEFORE TRUNCATE ON ls_service_interest.fishing_inquiry_followups
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.fishing_inquiry_followups FROM PUBLIC;
