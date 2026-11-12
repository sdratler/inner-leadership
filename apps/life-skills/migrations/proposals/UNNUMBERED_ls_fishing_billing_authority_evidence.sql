-- UNNUMBERED local preparation. No actual evidence, approval writer, schema
-- runner, runtime binding or financial/communication permission is installed.
-- Requires separately admitted identity and inquiry-family-proposal schemas.
CREATE TABLE ls_fishing_billing.authority_evidence (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 program_key text NOT NULL CHECK(program_key='fishing_monthly_club'),
 mode text NOT NULL CHECK(mode='test'),
 purpose text NOT NULL CHECK(purpose IN('guardian_assurance','email_recipient','financial_terms_release','completion_privacy_release','reminder_policy_release','service_admission')),
 state text NOT NULL CHECK(state IN('prepared','released')),
 source_reference_id text NOT NULL CHECK(length(source_reference_id) BETWEEN 1 AND 200),
 source_reference_sha256 text NOT NULL CHECK(source_reference_sha256 ~ '^[a-f0-9]{64}$'),
 release_evidence_id text CHECK(length(release_evidence_id) BETWEEN 1 AND 200),
 release_evidence_sha256 text CHECK(release_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_by uuid NOT NULL,
 created_at timestamptz NOT NULL,
 released_at timestamptz,
 expires_at timestamptz,
 proposal_id uuid,
 application_id uuid,
 family_id uuid,
 guardian_person_id uuid,
 source_digest text CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 native_digest text CHECK(native_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 40000),
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,proposal_id) REFERENCES ls_fishing_billing.inquiry_family_proposals(workspace_id,id),
 CHECK((release_evidence_id IS NULL)=(release_evidence_sha256 IS NULL)),
 CHECK(state<>'released' OR (release_evidence_id IS NOT NULL AND released_at IS NOT NULL AND expires_at IS NOT NULL)),
 CHECK(released_at IS NULL OR expires_at IS NULL OR expires_at>released_at),
 CHECK((purpose IN('guardian_assurance','email_recipient') AND proposal_id IS NOT NULL AND application_id IS NOT NULL
  AND family_id IS NOT NULL AND guardian_person_id IS NOT NULL AND source_digest IS NOT NULL AND native_digest IS NOT NULL)
  OR (purpose NOT IN('guardian_assurance','email_recipient') AND proposal_id IS NULL AND application_id IS NULL
  AND family_id IS NULL AND guardian_person_id IS NULL AND source_digest IS NULL AND native_digest IS NULL))
);
CREATE TABLE ls_fishing_billing.authority_evidence_revocations (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
 program_key text NOT NULL CHECK(program_key='fishing_monthly_club'),
 mode text NOT NULL CHECK(mode='test'),
 recorded_by uuid NOT NULL,
 created_at timestamptz NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 10000),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,evidence_id),
 FOREIGN KEY(workspace_id,evidence_id) REFERENCES ls_fishing_billing.authority_evidence(workspace_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE FUNCTION ls_fishing_billing.lock_authority_evidence_revocation_parent() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 -- A reader's parent SHARE lock conflicts with this lock even when no
 -- revocation existed at read time. Keep lock and insert in the SAME TX.
 PERFORM 1 FROM ls_fishing_billing.authority_evidence WHERE workspace_id=NEW.workspace_id AND id=NEW.evidence_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORITY_EVIDENCE_PARENT_REQUIRED' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER authority_evidence_revocation_parent_lock BEFORE INSERT ON ls_fishing_billing.authority_evidence_revocations
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.lock_authority_evidence_revocation_parent();
CREATE FUNCTION ls_fishing_billing.protect_authority_evidence() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FISHING_AUTHORITY_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER authority_evidence_no_edit BEFORE UPDATE OR DELETE ON ls_fishing_billing.authority_evidence
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_authority_evidence();
CREATE TRIGGER authority_evidence_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.authority_evidence
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_authority_evidence();
CREATE TRIGGER authority_evidence_revocations_no_edit BEFORE UPDATE OR DELETE ON ls_fishing_billing.authority_evidence_revocations
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_authority_evidence();
CREATE TRIGGER authority_evidence_revocations_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.authority_evidence_revocations
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_authority_evidence();
REVOKE ALL ON ls_fishing_billing.authority_evidence,ls_fishing_billing.authority_evidence_revocations FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_fishing_billing.lock_authority_evidence_revocation_parent(),ls_fishing_billing.protect_authority_evidence() FROM PUBLIC;
