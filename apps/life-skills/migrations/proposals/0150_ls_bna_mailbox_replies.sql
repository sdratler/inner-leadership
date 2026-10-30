-- PROPOSAL ONLY, outside the active manifest. Exact-target guarded release required.
-- Metadata receipts and owner reviews only. No email content, contact, task backfill or send.
CREATE TABLE ls_service_interest.bna_mailbox_reply_receipts (
 workspace_id uuid NOT NULL,id uuid NOT NULL,owner_account_id uuid NOT NULL,
 mailbox_key text NOT NULL CHECK(mailbox_key ~ '^[a-f0-9]{64}$'),
 provider_message_key text NOT NULL CHECK(provider_message_key ~ '^[a-f0-9]{64}$'),
 recipient_key text NOT NULL CHECK(recipient_key ~ '^[a-f0-9]{64}$'),
 inquiry_id uuid NOT NULL,program_key text NOT NULL CHECK(program_key IN('bna_learning_coop','bna_support_interest')),
 source_kind text NOT NULL CHECK(source_kind IN('service','optional')),source_message_id uuid NOT NULL,
 received_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL CHECK(recorded_at>=received_at),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,mailbox_key,provider_message_key),
 FOREIGN KEY(workspace_id,inquiry_id,program_key) REFERENCES ls_service_interest.bna_inquiries(workspace_id,id,program_key),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX bna_mailbox_reply_recipient ON ls_service_interest.bna_mailbox_reply_receipts(workspace_id,recipient_key,program_key,received_at,id);
CREATE INDEX bna_mailbox_reply_inquiry ON ls_service_interest.bna_mailbox_reply_receipts(workspace_id,inquiry_id,received_at,id);
CREATE TABLE ls_service_interest.bna_mailbox_reply_reviews (
 workspace_id uuid NOT NULL,receipt_id uuid NOT NULL,version integer NOT NULL CHECK(version IN(1,2)),
 operation_id uuid NOT NULL,actor_account_id uuid,
 state text NOT NULL CHECK(state IN('pending','reviewed')),
 code text NOT NULL CHECK(code IN('GMAIL_METADATA_RECEIVED','OWNER_REVIEWED')),
 recorded_at timestamptz NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 PRIMARY KEY(workspace_id,receipt_id,version),UNIQUE(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,receipt_id) REFERENCES ls_service_interest.bna_mailbox_reply_receipts(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((version=1 AND state='pending' AND code='GMAIL_METADATA_RECEIVED' AND actor_account_id IS NULL) OR
 (version=2 AND state='reviewed' AND code='OWNER_REVIEWED' AND actor_account_id IS NOT NULL))
);
CREATE FUNCTION ls_service_interest.check_bna_mailbox_reply_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_created timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_service_interest.bna_inquiries i WHERE i.workspace_id=NEW.workspace_id AND i.id=NEW.inquiry_id
  AND i.owner_account_id=NEW.owner_account_id AND i.program_key=NEW.program_key) THEN RAISE EXCEPTION 'BNA_MAILBOX_REPLY_INQUIRY_MISMATCH'; END IF;
 IF NEW.source_kind='service' THEN
  SELECT m.created_at INTO source_created FROM ls_service_interest.bna_email_messages m JOIN ls_service_interest.bna_email_delivery d
   ON d.workspace_id=m.workspace_id AND d.message_id=m.id WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.source_message_id
   AND m.inquiry_id=NEW.inquiry_id AND m.owner_account_id=NEW.owner_account_id AND m.program_key=NEW.program_key
   AND m.recipient_key=NEW.recipient_key AND d.state='sent' AND d.provider_id IS NOT NULL
   AND d.last_code IN('PROVIDER_ACCEPTED','PROVIDER_ACCEPTED_AFTER_CANCEL');
 ELSE
  SELECT m.created_at INTO source_created FROM ls_service_interest.bna_optional_messages m
   JOIN LATERAL(SELECT * FROM ls_service_interest.bna_optional_events e WHERE e.workspace_id=m.workspace_id AND e.message_id=m.id ORDER BY version DESC LIMIT 1) e ON true
   WHERE m.workspace_id=NEW.workspace_id AND m.id=NEW.source_message_id AND m.inquiry_id=NEW.inquiry_id
   AND m.owner_account_id=NEW.owner_account_id AND m.program_key=NEW.program_key AND m.recipient_key=NEW.recipient_key
   AND e.state='sent' AND e.provider_id IS NOT NULL AND e.code IN('PROVIDER_ACCEPTED','PROVIDER_ACCEPTED_AFTER_CANCEL');
 END IF;
 IF source_created IS NULL OR NEW.received_at<source_created THEN RAISE EXCEPTION 'BNA_MAILBOX_REPLY_SENT_SOURCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bna_mailbox_reply_source BEFORE INSERT ON ls_service_interest.bna_mailbox_reply_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.check_bna_mailbox_reply_receipt();
CREATE FUNCTION ls_service_interest.check_bna_mailbox_reply_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous ls_service_interest.bna_mailbox_reply_reviews%ROWTYPE; owner_id uuid; receipt_time timestamptz;
BEGIN
 SELECT owner_account_id,recorded_at INTO owner_id,receipt_time FROM ls_service_interest.bna_mailbox_reply_receipts
  WHERE workspace_id=NEW.workspace_id AND id=NEW.receipt_id;
 IF owner_id IS NULL OR NEW.recorded_at<receipt_time OR (NEW.actor_account_id IS NOT NULL AND NEW.actor_account_id<>owner_id) THEN
  RAISE EXCEPTION 'BNA_MAILBOX_REPLY_OWNER_MISMATCH'; END IF;
 SELECT * INTO previous FROM ls_service_interest.bna_mailbox_reply_reviews WHERE workspace_id=NEW.workspace_id AND receipt_id=NEW.receipt_id ORDER BY version DESC LIMIT 1;
 IF previous.version IS NULL THEN
  IF NEW.version<>1 OR NEW.recorded_at<>receipt_time THEN RAISE EXCEPTION 'BNA_MAILBOX_REPLY_INITIAL_REVIEW_REQUIRED'; END IF;
 ELSIF previous.version<>1 OR NEW.version<>2 OR NEW.recorded_at<previous.recorded_at THEN RAISE EXCEPTION 'BNA_MAILBOX_REPLY_REVIEW_HISTORY_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bna_mailbox_reply_review_sequence BEFORE INSERT ON ls_service_interest.bna_mailbox_reply_reviews
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.check_bna_mailbox_reply_review();
CREATE FUNCTION ls_service_interest.check_bna_mailbox_reply_initial_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_service_interest.bna_mailbox_reply_reviews WHERE workspace_id=NEW.workspace_id AND receipt_id=NEW.id AND version=1 AND state='pending') THEN
  RAISE EXCEPTION 'BNA_MAILBOX_REPLY_INITIAL_HISTORY_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER bna_mailbox_reply_initial_history AFTER INSERT ON ls_service_interest.bna_mailbox_reply_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ls_service_interest.check_bna_mailbox_reply_initial_history();
CREATE TRIGGER bna_mailbox_reply_receipts_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.bna_mailbox_reply_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_mailbox_reply_receipts_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_mailbox_reply_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_mailbox_reply_reviews_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.bna_mailbox_reply_reviews
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER bna_mailbox_reply_reviews_no_truncate BEFORE TRUNCATE ON ls_service_interest.bna_mailbox_reply_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.bna_mailbox_reply_receipts,ls_service_interest.bna_mailbox_reply_reviews FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_service_interest.check_bna_mailbox_reply_receipt(),ls_service_interest.check_bna_mailbox_reply_review(),ls_service_interest.check_bna_mailbox_reply_initial_history() FROM PUBLIC;
