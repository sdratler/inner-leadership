-- Additive final-delta evidence only. No source switch or contact rows are
-- created by this migration. Original encrypted import snapshots survive every
-- reconciled delta; they are not replaced by a mutable current projection.
CREATE TABLE ls_contact_ops.delta_operations (
 workspace_id uuid NOT NULL,
 operation_id text NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 128),
 actor_account_id uuid NOT NULL,
 authority_epoch bigint NOT NULL CHECK(authority_epoch>=0),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 result_ciphertext text NOT NULL CHECK(length(result_ciphertext)>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_contact_ops.delta_history (
 workspace_id uuid NOT NULL,
 operation_id text NOT NULL,
 legacy_lead_id text NOT NULL CHECK(legacy_lead_id ~ '^LS-(LEAD|WAPI)-[A-Za-z0-9_-]+$'),
 person_id uuid NOT NULL,
 evidence_ciphertext text NOT NULL CHECK(length(evidence_ciphertext)>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id,legacy_lead_id),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES ls_contact_ops.delta_operations(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id)
);
CREATE FUNCTION ls_contact_ops.deny_delta_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'CONTACT_DELTA_HISTORY_IMMUTABLE';
END;
$fn$;
CREATE TRIGGER delta_operations_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.delta_operations
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_delta_history_mutation();
CREATE TRIGGER delta_operations_no_truncate BEFORE TRUNCATE ON ls_contact_ops.delta_operations
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_delta_history_mutation();
CREATE TRIGGER delta_history_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.delta_history
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_delta_history_mutation();
CREATE TRIGGER delta_history_no_truncate BEFORE TRUNCATE ON ls_contact_ops.delta_history
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_delta_history_mutation();
REVOKE ALL ON ls_contact_ops.delta_operations,ls_contact_ops.delta_history FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_contact_ops.deny_delta_history_mutation() FROM PUBLIC;
