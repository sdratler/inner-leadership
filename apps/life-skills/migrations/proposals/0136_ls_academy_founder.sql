-- PROPOSAL ONLY. Not part of the adopted migration manifest; no production run.
-- Additive state inside the existing inquiry store, preserving every old row.
CREATE TABLE ls_service_interest.academy_founder_families(
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),id uuid NOT NULL,
 application_id uuid NOT NULL,continuation_digest text NOT NULL CHECK(continuation_digest ~ '^[a-f0-9]{64}$'),
 identity_digest text NOT NULL,email_digest text NOT NULL,token_digest text,native_household_id uuid,
 submission_sequence bigserial NOT NULL,revision integer NOT NULL CHECK(revision>0),allocated boolean NOT NULL DEFAULT false,
 status text NOT NULL CHECK(status IN('pending_verification','interest_list','provisional','confirmed','scheduling_hold','offered','redeemed','expired','withdrawn')),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),submitted_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,continuation_digest),UNIQUE(workspace_id,application_id),
 FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id)
);
CREATE INDEX academy_founder_order ON ls_service_interest.academy_founder_families(workspace_id,submission_sequence);
CREATE UNIQUE INDEX academy_founder_token ON ls_service_interest.academy_founder_families(workspace_id,token_digest) WHERE token_digest IS NOT NULL;
-- A verified native household can never consume two campaign allocations,
-- including after expiry/withdrawal. Never match or merge by mailbox/name.
CREATE UNIQUE INDEX academy_founder_native_household ON ls_service_interest.academy_founder_families(workspace_id,native_household_id) WHERE native_household_id IS NOT NULL;
CREATE TABLE ls_service_interest.academy_founder_applications(
 workspace_id uuid NOT NULL,application_id uuid NOT NULL,family_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,application_id),
 FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 FOREIGN KEY(workspace_id,family_id) REFERENCES ls_service_interest.academy_founder_families(workspace_id,id)
);
CREATE TABLE ls_service_interest.academy_founder_operations(
 workspace_id uuid NOT NULL,actor_id uuid NOT NULL,operation_id uuid NOT NULL,request_digest text NOT NULL,
 family_id uuid NOT NULL,result_ciphertext text NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,operation_id),
 FOREIGN KEY(workspace_id,family_id) REFERENCES ls_service_interest.academy_founder_families(workspace_id,id)
);
CREATE TABLE ls_service_interest.academy_founder_events(
 workspace_id uuid NOT NULL,family_id uuid NOT NULL,id uuid NOT NULL,at timestamptz NOT NULL,actor_id uuid,
 payload_ciphertext text NOT NULL,PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,family_id) REFERENCES ls_service_interest.academy_founder_families(workspace_id,id)
);
-- Reuse the existing durable outbox and UNKNOWN-before-network worker protocol.
ALTER TABLE ls_service_interest.inquiry_email_outbox DROP CONSTRAINT inquiry_email_outbox_purpose_check;
ALTER TABLE ls_service_interest.inquiry_email_outbox ADD CONSTRAINT inquiry_email_outbox_purpose_check CHECK(purpose='academy_inquiry_acknowledgment_v1' OR purpose IN('academy_founder_interest','academy_founder_ack','academy_founder_offer','academy_founder_interest_reminder','academy_founder_payment_reminder','academy_founder_interest_deadline_receipt','academy_founder_payment_deadline_receipt'));
ALTER TABLE ls_service_interest.inquiry_email_outbox DROP CONSTRAINT inquiry_email_outbox_workspace_id_application_id_key;
CREATE UNIQUE INDEX inquiry_email_legacy_one ON ls_service_interest.inquiry_email_outbox(workspace_id,application_id) WHERE purpose='academy_inquiry_acknowledgment_v1';
ALTER TABLE ls_service_interest.inquiry_email_outbox ADD COLUMN founder_id uuid, ADD COLUMN message_key text;
ALTER TABLE ls_service_interest.inquiry_email_outbox ADD CONSTRAINT inquiry_email_founder_fk FOREIGN KEY(workspace_id,founder_id) REFERENCES ls_service_interest.academy_founder_families(workspace_id,id);
CREATE UNIQUE INDEX inquiry_email_founder_once ON ls_service_interest.inquiry_email_outbox(workspace_id,founder_id,message_key) WHERE founder_id IS NOT NULL;
REVOKE ALL ON ls_service_interest.academy_founder_families,ls_service_interest.academy_founder_applications,ls_service_interest.academy_founder_operations,ls_service_interest.academy_founder_events FROM PUBLIC;

-- Explicit owner identity review only. A mailbox confirmation is not identity,
-- guardianship, membership, an account or permission to publish learner work.
CREATE TABLE ls_service_interest.academy_inquiry_identity_links(
 workspace_id uuid NOT NULL,application_id uuid NOT NULL,person_id uuid NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,application_id),UNIQUE(workspace_id,application_id,person_id),
 FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_identity.people(workspace_id,id)
);
CREATE TABLE ls_service_interest.academy_inquiry_identity_reviews(
 workspace_id uuid NOT NULL,application_id uuid NOT NULL,person_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 actor_id uuid NOT NULL,operation_id uuid NOT NULL,request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,application_id,revision),UNIQUE(workspace_id,actor_id,operation_id),
 FOREIGN KEY(workspace_id,application_id,person_id) REFERENCES ls_service_interest.academy_inquiry_identity_links(workspace_id,application_id,person_id)
);
CREATE TRIGGER academy_inquiry_identity_link_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.academy_inquiry_identity_links
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER academy_inquiry_identity_review_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.academy_inquiry_identity_reviews
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.academy_inquiry_identity_links,ls_service_interest.academy_inquiry_identity_reviews FROM PUBLIC;

-- Packet05 local proposal. First-fill history is separate from occupancy.
CREATE TABLE ls_service_interest.academy_campaigns(
 workspace_id uuid PRIMARY KEY REFERENCES ls_identity.workspaces(id),
 version text NOT NULL CHECK(version='JLFA-PREREG-LAUNCH-20261023-05'),
 revision integer NOT NULL CHECK(revision>=0),first_filled_at timestamptz
);
CREATE FUNCTION ls_service_interest.preserve_academy_first_fill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.workspace_id<>OLD.workspace_id OR NEW.version<>OLD.version OR NEW.revision<=OLD.revision OR (OLD.first_filled_at IS NOT NULL AND NEW.first_filled_at IS DISTINCT FROM OLD.first_filled_at) THEN RAISE EXCEPTION 'immutable campaign first fill'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER academy_campaign_first_fill BEFORE UPDATE OR DELETE ON ls_service_interest.academy_campaigns FOR EACH ROW EXECUTE FUNCTION ls_service_interest.preserve_academy_first_fill();
CREATE TABLE ls_service_interest.academy_campaign_touches(
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,application_id uuid NOT NULL,
 request_digest text NOT NULL,payload_ciphertext text NOT NULL,at timestamptz NOT NULL,touch_sequence bigserial NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id)
);
CREATE TRIGGER academy_campaign_touch_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.academy_campaign_touches FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TABLE ls_service_interest.academy_campaign_shares(
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),id uuid NOT NULL,payload_ciphertext text NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,id)
);
CREATE TABLE ls_service_interest.academy_campaign_operations(
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,actor_id uuid NOT NULL,request_digest text NOT NULL,result_ciphertext text NOT NULL,PRIMARY KEY(workspace_id,operation_id),FOREIGN KEY(workspace_id,actor_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TRIGGER academy_campaign_operation_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.academy_campaign_operations FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.academy_campaigns,ls_service_interest.academy_campaign_touches,ls_service_interest.academy_campaign_shares,ls_service_interest.academy_campaign_operations FROM PUBLIC;

-- Revision provenance only; no delegation or financial activation authority.
ALTER TABLE ls_service_interest.academy_founder_events
 ADD COLUMN transition_from integer,ADD COLUMN transition_to integer,
 ADD COLUMN transition_kind text,ADD COLUMN transition_purpose_sha256 text,
 ADD CONSTRAINT academy_founder_transition_headers CHECK(
  (transition_from IS NULL AND transition_to IS NULL AND transition_kind IS NULL AND transition_purpose_sha256 IS NULL) OR
  (transition_from IS NOT NULL AND transition_to IS NOT NULL AND transition_kind IS NOT NULL AND transition_purpose_sha256 IS NOT NULL
   AND transition_from>0 AND transition_to=transition_from+1
   AND transition_kind IN('other','commercial_template_approved','offer_email_sent') AND transition_purpose_sha256 ~ '^[a-f0-9]{64}$'));
CREATE UNIQUE INDEX academy_founder_transition_once ON ls_service_interest.academy_founder_events(workspace_id,family_id,transition_to) WHERE transition_to IS NOT NULL;
CREATE TRIGGER academy_founder_event_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.academy_founder_events
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
