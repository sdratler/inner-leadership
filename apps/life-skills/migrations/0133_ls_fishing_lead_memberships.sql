-- Explicit owner-reviewed administrative membership only. No clinical grant,
-- task, default follow-up, provider send, payment or native-authority switch.
CREATE TABLE ls_contact_ops.fishing_lead_revisions (
 workspace_id uuid NOT NULL,
 program_key text NOT NULL CHECK(program_key IN ('sunday_fishing_academy','private_fishing_life_skills')),
 person_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 previous_version integer,
 state text NOT NULL CHECK(state IN ('active','removed')),
 source_application_id uuid,
 recorded_by uuid NOT NULL,
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 20000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,program_key,person_id,version),
 UNIQUE(workspace_id,program_key,person_id,version,state),
 UNIQUE(workspace_id,program_key,person_id,previous_version),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,source_application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 FOREIGN KEY(workspace_id,program_key,person_id,previous_version)
  REFERENCES ls_contact_ops.fishing_lead_revisions(workspace_id,program_key,person_id,version),
 CHECK((version=1 AND previous_version IS NULL AND state='active') OR
  (version>1 AND previous_version IS NOT NULL AND previous_version=version-1))
);
CREATE INDEX fishing_lead_latest ON ls_contact_ops.fishing_lead_revisions
 (workspace_id,program_key,person_id,version DESC);

CREATE TABLE ls_contact_ops.fishing_lead_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 authority_epoch bigint NOT NULL CHECK(authority_epoch>=0),
 program_key text NOT NULL,
 person_id uuid NOT NULL,
 result_version integer NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 result_ciphertext text NOT NULL CHECK(length(result_ciphertext) BETWEEN 1 AND 20000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,program_key,person_id,result_version)
  REFERENCES ls_contact_ops.fishing_lead_revisions(workspace_id,program_key,person_id,version)
);

-- Latest desired state is separate from immutable native membership. Encrypted
-- provider binding is never inferred from a display name or native success.
CREATE TABLE ls_contact_ops.fishing_label_projection (
 workspace_id uuid NOT NULL,
 program_key text NOT NULL,
 person_id uuid NOT NULL,
 generation integer NOT NULL,
 membership_state text NOT NULL CHECK(membership_state IN ('active','removed')),
 desired_present boolean NOT NULL,
 status text NOT NULL CHECK(status IN ('unconfigured','pending','failed','verified')),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 20000),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,program_key,person_id),
 FOREIGN KEY(workspace_id,program_key,person_id,generation,membership_state)
  REFERENCES ls_contact_ops.fishing_lead_revisions(workspace_id,program_key,person_id,version,state),
 CHECK(desired_present=(membership_state='active'))
);

CREATE TRIGGER fishing_lead_revisions_no_edit BEFORE UPDATE OR DELETE
 ON ls_contact_ops.fishing_lead_revisions FOR EACH ROW
 EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER fishing_lead_revisions_no_truncate BEFORE TRUNCATE
 ON ls_contact_ops.fishing_lead_revisions FOR EACH STATEMENT
 EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER fishing_lead_operations_no_edit BEFORE UPDATE OR DELETE
 ON ls_contact_ops.fishing_lead_operations FOR EACH ROW
 EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER fishing_lead_operations_no_truncate BEFORE TRUNCATE
 ON ls_contact_ops.fishing_lead_operations FOR EACH STATEMENT
 EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
REVOKE ALL ON ls_contact_ops.fishing_lead_revisions,
 ls_contact_ops.fishing_lead_operations,ls_contact_ops.fishing_label_projection FROM PUBLIC;
