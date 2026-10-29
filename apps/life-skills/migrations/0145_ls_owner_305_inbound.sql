-- Future 305 provider receipts only. No contact matching or automatic tasks.
CREATE TABLE ls_service_interest.owner_305_inbound_receipts (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 binding_key text NOT NULL CHECK(binding_key ~ '^[a-f0-9]{64}$'),
 event_key text NOT NULL CHECK(event_key ~ '^[a-f0-9]{64}$'),
 message_key text NOT NULL CHECK(message_key ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 occurred_at timestamptz NOT NULL, stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,binding_key,event_key), UNIQUE(workspace_id,binding_key,message_key)
);
CREATE INDEX owner_305_inbound_recent ON ls_service_interest.owner_305_inbound_receipts(workspace_id,binding_key,stored_at DESC,event_key DESC);
CREATE TABLE ls_service_interest.owner_305_inbound_links (
 workspace_id uuid NOT NULL,binding_key text NOT NULL,event_key text NOT NULL,conversation_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,binding_key,event_key), UNIQUE(workspace_id,conversation_id),
 FOREIGN KEY(workspace_id,binding_key,event_key) REFERENCES ls_service_interest.owner_305_inbound_receipts(workspace_id,binding_key,event_key),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES ls_service_interest.owner_305_conversations(workspace_id,id)
);
CREATE TRIGGER owner_305_inbound_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.owner_305_inbound_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_inbound_no_truncate BEFORE TRUNCATE ON ls_service_interest.owner_305_inbound_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_inbound_link_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.owner_305_inbound_links
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_inbound_link_no_truncate BEFORE TRUNCATE ON ls_service_interest.owner_305_inbound_links
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.owner_305_inbound_receipts,ls_service_interest.owner_305_inbound_links FROM PUBLIC;
