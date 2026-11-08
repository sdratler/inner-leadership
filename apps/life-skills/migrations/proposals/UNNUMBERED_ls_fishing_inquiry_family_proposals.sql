-- UNNUMBERED preparation only; never installed by importing application code.
-- Requires the separately admitted native identity/inquiry/Academy/billing schema.
-- This is an immutable PROPOSED association, not a guardian/recipient review,
-- financial acceptance, customer import, account/case/grant or send authority.
CREATE TABLE ls_fishing_billing.inquiry_family_proposals (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 application_id uuid NOT NULL,
 family_id uuid NOT NULL,
 guardian_person_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 native_digest text NOT NULL CHECK(native_digest ~ '^[a-f0-9]{64}$'),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 100000),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,application_id),
 UNIQUE(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 FOREIGN KEY(workspace_id,family_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,guardian_person_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE FUNCTION ls_fishing_billing.protect_inquiry_family_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FISHING_INQUIRY_FAMILY_PROPOSAL_IMMUTABLE' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER fishing_inquiry_family_proposal_no_edit BEFORE UPDATE OR DELETE
 ON ls_fishing_billing.inquiry_family_proposals FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_inquiry_family_proposal();
CREATE TRIGGER fishing_inquiry_family_proposal_no_truncate BEFORE TRUNCATE
 ON ls_fishing_billing.inquiry_family_proposals FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_inquiry_family_proposal();
REVOKE ALL ON ls_fishing_billing.inquiry_family_proposals FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_inquiry_family_proposal() FROM PUBLIC;
