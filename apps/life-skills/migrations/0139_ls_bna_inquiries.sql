-- BNA Torah-morning interest uses the existing app/workspace and encryption keys.
-- It does not import retired contacts, create a second person identity, or send.
CREATE TABLE ls_service_interest.bna_inquiries (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 program_key text NOT NULL CHECK(program_key='bna_torah_mornings'),
 owner_account_id uuid NOT NULL,
 contact_digest text NOT NULL CHECK(contact_digest ~ '^[a-f0-9]{64}$'),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 notice_version text NOT NULL CHECK(length(notice_version) BETWEEN 1 AND 100),
 notice_language text NOT NULL CHECK(notice_language IN('en','he')),
 received_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,id,request_digest),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX bna_inquiry_recent ON ls_service_interest.bna_inquiries(workspace_id,received_at DESC,id DESC);
CREATE INDEX bna_inquiry_contact_recent ON ls_service_interest.bna_inquiries(workspace_id,contact_digest,received_at DESC);
CREATE TABLE ls_service_interest.bna_inquiry_operations (
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 inquiry_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,inquiry_id,request_digest) REFERENCES ls_service_interest.bna_inquiries(workspace_id,id,request_digest)
);
CREATE TABLE ls_service_interest.bna_inquiry_followups (
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,inquiry_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),UNIQUE(workspace_id,inquiry_id,version),
 FOREIGN KEY(workspace_id,inquiry_id) REFERENCES ls_service_interest.bna_inquiries(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX bna_followup_history ON ls_service_interest.bna_inquiry_followups(workspace_id,inquiry_id,version DESC);
CREATE TRIGGER bna_inquiries_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.bna_inquiries
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_inquiry_operations_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.bna_inquiry_operations
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_inquiry_followups_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.bna_inquiry_followups
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_inquiries_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_inquiries
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_inquiry_operations_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_inquiry_operations
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_inquiry_followups_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_inquiry_followups
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.bna_inquiries,ls_service_interest.bna_inquiry_operations,ls_service_interest.bna_inquiry_followups FROM PUBLIC;
