-- Additive optional-mail calendar; apply only through the exact-target release guard.
-- One canonical adult-email calendar. No contact, task, backfill or send.
CREATE TABLE ls_service_interest.bna_optional_messages (
 workspace_id uuid NOT NULL,id uuid NOT NULL,operation_id uuid NOT NULL,
 inquiry_id uuid NOT NULL,owner_account_id uuid NOT NULL,
 recipient_key text NOT NULL CHECK(recipient_key ~ '^[a-f0-9]{64}$'),
 program_key text NOT NULL CHECK(program_key IN('bna_learning_coop','bna_support_interest')),
 template_id text NOT NULL CHECK((program_key='bna_learning_coop' AND template_id IN('EMAIL-B1','EMAIL-B2','EMAIL-B3','EMAIL-B4','EMAIL-B5')) OR
 (program_key='bna_support_interest' AND template_id IN('EMAIL-S1','EMAIL-S2','EMAIL-S3'))),
 locale text NOT NULL CHECK(locale IN('en','he')),preference_version integer NOT NULL CHECK(preference_version>=0),
 permission_at timestamptz NOT NULL,created_at timestamptz NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 copy_sha256 text NOT NULL CHECK(copy_sha256 ~ '^[a-f0-9]{64}$'),
 command_digest text NOT NULL CHECK(command_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,inquiry_id,program_key) REFERENCES ls_service_interest.bna_inquiries(workspace_id,id,program_key),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(created_at>=permission_at)
);
CREATE INDEX bna_optional_recipient_calendar ON ls_service_interest.bna_optional_messages(workspace_id,recipient_key,created_at,id);
CREATE TABLE ls_service_interest.bna_optional_events (
 workspace_id uuid NOT NULL,message_id uuid NOT NULL,version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 operation_id uuid NOT NULL,actor_account_id uuid,
 state text NOT NULL CHECK(state IN('prepared','unknown','sent','failed','canceled','canceled_unknown')),
 code text NOT NULL CHECK(code IN('PREPARED','DELIVERY_RESERVED','PROVIDER_ACCEPTED','PROVIDER_NOT_ATTEMPTED','OWNER_CANCELED','OWNER_CANCELED_UNCONFIRMED','PROVIDER_ACCEPTED_AFTER_CANCEL','CANCELED_PROVIDER_NOT_ATTEMPTED','OWNER_RETRY_NOT_ATTEMPTED')),
 recorded_at timestamptz NOT NULL,reserved_at timestamptz,provider_id text,
 command_digest text NOT NULL CHECK(command_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(workspace_id,message_id,version),UNIQUE(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES ls_service_interest.bna_optional_messages(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(provider_id IS NULL OR (length(provider_id) BETWEEN 1 AND 256 AND provider_id ~ '^[A-Za-z0-9_-]+$')),
 CHECK(reserved_at IS NULL OR reserved_at<=recorded_at),
 CHECK((state='prepared' AND reserved_at IS NULL AND provider_id IS NULL) OR
 (state IN('unknown','canceled_unknown','failed') AND reserved_at IS NOT NULL AND provider_id IS NULL) OR
 (state='sent' AND reserved_at IS NOT NULL AND provider_id IS NOT NULL) OR
 (state='canceled' AND provider_id IS NULL))
);
CREATE FUNCTION ls_service_interest.check_bna_optional_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous ls_service_interest.bna_optional_events%ROWTYPE; owner_id uuid; created_time timestamptz;
BEGIN
 SELECT owner_account_id,created_at INTO owner_id,created_time FROM ls_service_interest.bna_optional_messages
 WHERE workspace_id=NEW.workspace_id AND id=NEW.message_id;
 IF owner_id IS NULL OR (NEW.actor_account_id IS NOT NULL AND NEW.actor_account_id<>owner_id) OR NEW.recorded_at<created_time THEN
  RAISE EXCEPTION 'BNA_OPTIONAL_EVENT_OWNER_MISMATCH';
 END IF;
 SELECT * INTO previous FROM ls_service_interest.bna_optional_events
 WHERE workspace_id=NEW.workspace_id AND message_id=NEW.message_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(previous.version,0)+1 OR NEW.recorded_at<previous.recorded_at THEN
  RAISE EXCEPTION 'BNA_OPTIONAL_EVENT_HISTORY_REQUIRED';
 END IF;
 IF previous.version IS NULL THEN
  IF NOT COALESCE((NEW.state='prepared' AND NEW.code='PREPARED' AND NEW.actor_account_id=owner_id AND NEW.recorded_at=created_time),false) THEN
   RAISE EXCEPTION 'BNA_OPTIONAL_INITIAL_EVENT_REQUIRED';
  END IF;
 ELSIF NOT COALESCE((
  (previous.state='prepared' AND NEW.state='unknown' AND NEW.code='DELIVERY_RESERVED' AND NEW.actor_account_id IS NULL AND NEW.reserved_at=NEW.recorded_at) OR
  (previous.state='prepared' AND NEW.state='canceled' AND NEW.code='OWNER_CANCELED' AND NEW.actor_account_id=owner_id AND NEW.reserved_at IS NULL) OR
  (previous.state='failed' AND previous.code='PROVIDER_NOT_ATTEMPTED' AND NEW.state='canceled' AND NEW.code='OWNER_CANCELED' AND NEW.actor_account_id=owner_id AND NEW.reserved_at=previous.reserved_at) OR
  (previous.state='unknown' AND NEW.state='canceled_unknown' AND NEW.code='OWNER_CANCELED_UNCONFIRMED' AND NEW.actor_account_id=owner_id AND NEW.reserved_at=previous.reserved_at) OR
  (previous.state='unknown' AND NEW.state='sent' AND NEW.code='PROVIDER_ACCEPTED' AND NEW.actor_account_id IS NULL AND NEW.reserved_at=previous.reserved_at) OR
  (previous.state='canceled_unknown' AND NEW.state='sent' AND NEW.code='PROVIDER_ACCEPTED_AFTER_CANCEL' AND NEW.actor_account_id IS NULL AND NEW.reserved_at=previous.reserved_at) OR
  (previous.state='unknown' AND NEW.state='failed' AND NEW.code='PROVIDER_NOT_ATTEMPTED' AND NEW.actor_account_id IS NULL AND NEW.reserved_at=previous.reserved_at) OR
  (previous.state='canceled_unknown' AND NEW.state='canceled' AND NEW.code='CANCELED_PROVIDER_NOT_ATTEMPTED' AND NEW.actor_account_id IS NULL AND NEW.reserved_at=previous.reserved_at) OR
  (previous.state='failed' AND NEW.state='prepared' AND NEW.code='OWNER_RETRY_NOT_ATTEMPTED' AND NEW.actor_account_id=owner_id AND NEW.reserved_at IS NULL)
 ),false) THEN RAISE EXCEPTION 'BNA_OPTIONAL_TRANSITION_REJECTED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bna_optional_event_sequence BEFORE INSERT ON ls_service_interest.bna_optional_events
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.check_bna_optional_event();
CREATE FUNCTION ls_service_interest.check_bna_optional_initial_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_service_interest.bna_optional_events WHERE workspace_id=NEW.workspace_id AND message_id=NEW.id AND version=1 AND state='prepared') THEN
  RAISE EXCEPTION 'BNA_OPTIONAL_INITIAL_HISTORY_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER bna_optional_message_history AFTER INSERT ON ls_service_interest.bna_optional_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ls_service_interest.check_bna_optional_initial_history();
CREATE TRIGGER bna_optional_messages_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.bna_optional_messages
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_optional_messages_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_optional_messages
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_optional_events_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.bna_optional_events
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_optional_events_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_optional_events
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.bna_optional_messages,ls_service_interest.bna_optional_events FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_service_interest.check_bna_optional_event(),ls_service_interest.check_bna_optional_initial_history() FROM PUBLIC;
