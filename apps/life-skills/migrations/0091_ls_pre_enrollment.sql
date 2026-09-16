-- Private pre-enrollment on the existing Life Skills database. No live release is authorized here.
CREATE SCHEMA ls_intake;
CREATE TABLE ls_intake.pre_enrollment_invitations (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 invitation_id uuid NOT NULL,
 token_digest text NOT NULL CHECK(token_digest ~ '^[a-f0-9]{64}$'),
 stable_lead_ref text NOT NULL CHECK(stable_lead_ref ~ '^LS-(LEAD|WAPI)-[A-Za-z0-9_-]+$'),
 child_slots jsonb NOT NULL CHECK(jsonb_typeof(child_slots)='array' AND jsonb_array_length(child_slots) BETWEEN 1 AND 8),
 expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL, created_by_account_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,invitation_id), UNIQUE(workspace_id,token_digest),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(expires_at > created_at AND expires_at <= created_at + interval '14 days'),
 CHECK(consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)),
 CHECK(revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE TABLE ls_intake.pre_enrollment_receipts (
 workspace_id uuid NOT NULL, receipt_id uuid NOT NULL, invitation_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 consent_version text NOT NULL CHECK(length(trim(consent_version))>0),
 consent_hash text NOT NULL CHECK(consent_hash ~ '^[a-f0-9]{64}$'), received_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,receipt_id), UNIQUE(workspace_id,invitation_id),
 UNIQUE(workspace_id,invitation_id,idempotency_key),
 FOREIGN KEY(workspace_id,invitation_id) REFERENCES ls_intake.pre_enrollment_invitations(workspace_id,invitation_id)
);
CREATE TABLE ls_intake.pre_enrollment_amendments (
 workspace_id uuid NOT NULL, amendment_id uuid NOT NULL, receipt_id uuid NOT NULL,
 actor_account_id uuid NOT NULL, payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,amendment_id),
 FOREIGN KEY(workspace_id,receipt_id) REFERENCES ls_intake.pre_enrollment_receipts(workspace_id,receipt_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE FUNCTION ls_intake.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'immutable_intake_evidence' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_intake_receipt BEFORE UPDATE OR DELETE ON ls_intake.pre_enrollment_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_intake.append_only();
CREATE TRIGGER immutable_intake_amendment BEFORE UPDATE OR DELETE ON ls_intake.pre_enrollment_amendments
 FOR EACH ROW EXECUTE FUNCTION ls_intake.append_only();
CREATE FUNCTION ls_intake.protect_invitation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_intake_invitation' USING ERRCODE='23514'; END IF;
 IF (NEW.workspace_id,NEW.invitation_id,NEW.token_digest,NEW.stable_lead_ref,NEW.child_slots,NEW.expires_at,NEW.created_at,NEW.created_by_account_id)
 IS DISTINCT FROM (OLD.workspace_id,OLD.invitation_id,OLD.token_digest,OLD.stable_lead_ref,OLD.child_slots,OLD.expires_at,OLD.created_at,OLD.created_by_account_id)
 OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
 THEN RAISE EXCEPTION 'immutable_intake_invitation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_intake_invitation BEFORE UPDATE OR DELETE ON ls_intake.pre_enrollment_invitations
 FOR EACH ROW EXECUTE FUNCTION ls_intake.protect_invitation();
REVOKE ALL ON SCHEMA ls_intake FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ls_intake FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ls_intake FROM PUBLIC;
