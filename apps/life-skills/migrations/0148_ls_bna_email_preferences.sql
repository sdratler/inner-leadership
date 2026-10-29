-- Additive, append-only adult email controls. No inquiry, contact, task or send
-- is created by this schema. Apply only through its exact-target release guard.
CREATE TABLE ls_service_interest.bna_email_preference_events (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 recipient_key text NOT NULL CHECK(recipient_key ~ '^[a-f0-9]{64}$'),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 operation_id uuid NOT NULL,
 inquiry_id uuid NOT NULL,
 owner_account_id uuid NOT NULL,
 actor_account_id uuid,
 source text NOT NULL CHECK(source IN ('owner','recipient')),
 program_key text CHECK(program_key IN ('bna_learning_coop','bna_support_interest')),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,recipient_key,version),
 UNIQUE(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,inquiry_id) REFERENCES ls_service_interest.bna_inquiries(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((source='owner' AND actor_account_id IS NOT NULL AND actor_account_id=owner_account_id) OR (source='recipient' AND actor_account_id IS NULL))
);
CREATE FUNCTION ls_service_interest.check_bna_email_preference_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_version integer; previous_time timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_service_interest.bna_inquiries i WHERE i.workspace_id=NEW.workspace_id
  AND i.id=NEW.inquiry_id AND i.owner_account_id=NEW.owner_account_id
  AND i.program_key IN ('bna_learning_coop','bna_support_interest')
  AND (NEW.program_key IS NULL OR NEW.program_key=i.program_key)) THEN
  RAISE EXCEPTION 'BNA_EMAIL_PREFERENCE_INQUIRY_MISMATCH';
 END IF;
 SELECT version,recorded_at INTO previous_version,previous_time FROM ls_service_interest.bna_email_preference_events
  WHERE workspace_id=NEW.workspace_id AND recipient_key=NEW.recipient_key ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous_version,0)+1 OR NEW.recorded_at<previous_time THEN
  RAISE EXCEPTION 'BNA_EMAIL_PREFERENCE_HISTORY_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bna_email_preference_sequence BEFORE INSERT ON ls_service_interest.bna_email_preference_events
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.check_bna_email_preference_event();
CREATE TRIGGER bna_email_preference_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.bna_email_preference_events
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_email_preference_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_email_preference_events
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.bna_email_preference_events FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_service_interest.check_bna_email_preference_event() FROM PUBLIC;
