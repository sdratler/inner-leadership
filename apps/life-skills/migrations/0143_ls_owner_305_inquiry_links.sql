-- An explicit, reversible association; no contact matching or Person creation.
-- Each event records one link or unlink; both programs may be linked separately.
CREATE TABLE ls_service_interest.owner_305_inquiry_link_events (
 workspace_id uuid NOT NULL, operation_id uuid NOT NULL, conversation_id uuid NOT NULL,
 owner_account_id uuid NOT NULL, version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 bna_inquiry_id uuid, fishing_application_id uuid, linked boolean NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES ls_service_interest.owner_305_conversations(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,bna_inquiry_id) REFERENCES ls_service_interest.bna_inquiries(workspace_id,id),
 FOREIGN KEY(workspace_id,fishing_application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 CHECK((bna_inquiry_id IS NULL) <> (fishing_application_id IS NULL))
);
CREATE UNIQUE INDEX owner_305_bna_link_version ON ls_service_interest.owner_305_inquiry_link_events(workspace_id,conversation_id,bna_inquiry_id,version) WHERE bna_inquiry_id IS NOT NULL;
CREATE UNIQUE INDEX owner_305_fishing_link_version ON ls_service_interest.owner_305_inquiry_link_events(workspace_id,conversation_id,fishing_application_id,version) WHERE fishing_application_id IS NOT NULL;
CREATE INDEX owner_305_inquiry_link_history ON ls_service_interest.owner_305_inquiry_link_events(workspace_id,conversation_id,recorded_at DESC,operation_id DESC);
CREATE TRIGGER owner_305_inquiry_link_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.owner_305_inquiry_link_events
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER owner_305_inquiry_link_no_truncate BEFORE TRUNCATE ON ls_service_interest.owner_305_inquiry_link_events
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.owner_305_inquiry_link_events FROM PUBLIC;
