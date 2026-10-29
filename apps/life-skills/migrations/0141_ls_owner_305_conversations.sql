-- Owner-entered classification of conversations on the Academy 305 line.
-- No contacts, people, source events, provider messages, or number matching are created.
CREATE TABLE ls_service_interest.owner_305_conversations (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,owner_account_id uuid NOT NULL,
 line_number text NOT NULL CHECK(line_number='+13054916674'),
 metadata_ciphertext text NOT NULL CHECK(length(metadata_ciphertext)>0),
 creation_digest text NOT NULL CHECK(creation_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,id,creation_digest),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX owner_305_conversations_recent ON ls_service_interest.owner_305_conversations(workspace_id,owner_account_id,created_at DESC,id DESC);
CREATE TABLE ls_service_interest.owner_305_conversation_operations (
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,creation_digest text NOT NULL CHECK(creation_digest ~ '^[a-f0-9]{64}$'),
 conversation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,conversation_id,creation_digest) REFERENCES ls_service_interest.owner_305_conversations(workspace_id,id,creation_digest)
);
CREATE TABLE ls_service_interest.owner_305_conversation_revisions (
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,conversation_id uuid NOT NULL,owner_account_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),UNIQUE(workspace_id,conversation_id,version),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES ls_service_interest.owner_305_conversations(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX owner_305_conversation_history ON ls_service_interest.owner_305_conversation_revisions(workspace_id,conversation_id,version DESC);
CREATE TRIGGER owner_305_conversation_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.owner_305_conversations
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_operation_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.owner_305_conversation_operations
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_revision_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.owner_305_conversation_revisions
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_conversation_no_truncate BEFORE TRUNCATE ON ls_service_interest.owner_305_conversations
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_operation_no_truncate BEFORE TRUNCATE ON ls_service_interest.owner_305_conversation_operations
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_revision_no_truncate BEFORE TRUNCATE ON ls_service_interest.owner_305_conversation_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.owner_305_conversations,ls_service_interest.owner_305_conversation_operations,ls_service_interest.owner_305_conversation_revisions FROM PUBLIC;
