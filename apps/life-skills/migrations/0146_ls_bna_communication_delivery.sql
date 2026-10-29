-- Purpose-bound BNA inquiry delivery, not a second contacts database.
-- No historical inquiry is copied and no worker or provider is activated here.
CREATE UNIQUE INDEX bna_inquiry_communication_program ON ls_service_interest.bna_inquiries(workspace_id,id,program_key);
CREATE TABLE ls_service_interest.bna_email_messages (
 workspace_id uuid NOT NULL,id uuid NOT NULL,inquiry_id uuid NOT NULL,
 program_key text NOT NULL CHECK(program_key IN('bna_learning_coop','bna_support_interest')),
 template_id text NOT NULL CHECK((program_key='bna_learning_coop' AND template_id='EMAIL-B0') OR (program_key='bna_support_interest' AND template_id='EMAIL-S0')),
 owner_account_id uuid NOT NULL,recipient_key text NOT NULL CHECK(recipient_key ~ '^[a-f0-9]{64}$'),
 locale text NOT NULL CHECK(locale IN('en','he')),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 copy_sha256 text NOT NULL CHECK(copy_sha256 ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,inquiry_id,template_id),
 FOREIGN KEY(workspace_id,inquiry_id,program_key) REFERENCES ls_service_interest.bna_inquiries(workspace_id,id,program_key),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_service_interest.bna_email_delivery (
 workspace_id uuid NOT NULL,message_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('queued','unknown','sent','failed','canceled')),
 version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483646),
 reserved_at timestamptz,completed_at timestamptz,provider_id text,
 last_code text CHECK(last_code IS NULL OR last_code ~ '^[A-Z0-9_]{1,60}$'),
 PRIMARY KEY(workspace_id,message_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES ls_service_interest.bna_email_messages(workspace_id,id),
 CHECK(provider_id IS NULL OR (length(provider_id) BETWEEN 1 AND 256 AND provider_id ~ '^[A-Za-z0-9_-]+$')),
 CHECK((state='queued' AND provider_id IS NULL AND reserved_at IS NULL AND completed_at IS NULL) OR
       (state='unknown' AND provider_id IS NULL AND reserved_at IS NOT NULL AND completed_at IS NULL) OR
       (state='sent' AND provider_id IS NOT NULL AND reserved_at IS NOT NULL AND completed_at IS NOT NULL) OR
       (state IN('failed','canceled') AND provider_id IS NULL AND completed_at IS NOT NULL))
);
CREATE TABLE ls_service_interest.bna_email_delivery_events (
 workspace_id uuid NOT NULL,message_id uuid NOT NULL,version integer NOT NULL,
 operation_id uuid NOT NULL,state text NOT NULL CHECK(state IN('queued','unknown','sent','failed','canceled')),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_]{1,60}$'),recorded_at timestamptz NOT NULL,
 actor_account_id uuid,provider_id text,request_digest text CHECK(request_digest IS NULL OR request_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(workspace_id,message_id,version),UNIQUE(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,message_id) REFERENCES ls_service_interest.bna_email_messages(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(provider_id IS NULL OR (length(provider_id) BETWEEN 1 AND 256 AND provider_id ~ '^[A-Za-z0-9_-]+$'))
);
CREATE INDEX bna_email_delivery_queue ON ls_service_interest.bna_email_delivery(workspace_id,message_id) WHERE state='queued';
CREATE INDEX bna_email_inquiry_readback ON ls_service_interest.bna_email_messages(workspace_id,inquiry_id,created_at,id);
CREATE FUNCTION ls_service_interest.guard_bna_email_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'BNA_EMAIL_DELIVERY_IMMUTABLE'; END IF;
 IF OLD.workspace_id<>NEW.workspace_id OR OLD.message_id<>NEW.message_id OR NEW.version<>OLD.version+1 OR
    NOT ((OLD.state='queued' AND NEW.state IN('unknown','canceled')) OR
         (OLD.state='unknown' AND NEW.state IN('sent','failed','canceled')) OR
         (OLD.state='failed' AND NEW.state='canceled') OR
         (OLD.state='failed' AND OLD.last_code='PROVIDER_NOT_ATTEMPTED' AND NEW.state='queued' AND NEW.last_code='OWNER_RETRY_NOT_ATTEMPTED') OR
         (OLD.state='canceled' AND OLD.last_code='OWNER_CANCELED_UNCONFIRMED' AND
          ((NEW.state='sent' AND NEW.last_code='PROVIDER_ACCEPTED_AFTER_CANCEL') OR (NEW.state='canceled' AND NEW.last_code='CANCELED_PROVIDER_NOT_ATTEMPTED')))) THEN
  RAISE EXCEPTION 'BNA_EMAIL_DELIVERY_TRANSITION_REJECTED';
 END IF;
 IF (OLD.reserved_at IS NOT NULL AND OLD.reserved_at IS DISTINCT FROM NEW.reserved_at AND NOT
     (OLD.state='failed' AND OLD.last_code='PROVIDER_NOT_ATTEMPTED' AND NEW.state='queued' AND NEW.last_code='OWNER_RETRY_NOT_ATTEMPTED' AND NEW.reserved_at IS NULL)) OR
    (NEW.reserved_at IS NOT NULL AND NEW.completed_at IS NOT NULL AND NEW.completed_at<NEW.reserved_at) THEN
  RAISE EXCEPTION 'BNA_EMAIL_DELIVERY_TIME_REJECTED';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ls_service_interest.check_bna_email_delivery_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_service_interest.bna_email_delivery d WHERE d.workspace_id=NEW.workspace_id AND d.message_id=NEW.message_id
  AND d.version=NEW.version AND d.state=NEW.state AND d.provider_id IS NOT DISTINCT FROM NEW.provider_id) THEN
  RAISE EXCEPTION 'BNA_EMAIL_EVENT_STATE_MISMATCH';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ls_service_interest.check_bna_email_delivery_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_service_interest.bna_email_delivery_events e WHERE e.workspace_id=NEW.workspace_id AND e.message_id=NEW.message_id
  AND e.version=NEW.version AND e.state=NEW.state AND e.provider_id IS NOT DISTINCT FROM NEW.provider_id) THEN
  RAISE EXCEPTION 'BNA_EMAIL_DELIVERY_HISTORY_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bna_email_event_state BEFORE INSERT ON ls_service_interest.bna_email_delivery_events
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.check_bna_email_delivery_event();
CREATE CONSTRAINT TRIGGER bna_email_delivery_history AFTER INSERT OR UPDATE ON ls_service_interest.bna_email_delivery
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ls_service_interest.check_bna_email_delivery_history();
CREATE TRIGGER bna_email_messages_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.bna_email_messages
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_email_messages_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_email_messages
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_email_delivery_guard BEFORE UPDATE OR DELETE ON ls_service_interest.bna_email_delivery
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.guard_bna_email_delivery();
CREATE TRIGGER bna_email_delivery_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_email_delivery
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_email_events_no_edit BEFORE UPDATE OR DELETE ON ls_service_interest.bna_email_delivery_events
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_email_events_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_email_delivery_events
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.bna_email_messages,ls_service_interest.bna_email_delivery,ls_service_interest.bna_email_delivery_events FROM PUBLIC;
