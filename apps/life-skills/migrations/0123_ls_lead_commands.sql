-- Owner-confirmed structured administrative commands. No provider activation,
-- clinical access, identity grant or change to the durable CRM authority.
CREATE TABLE ls_contact_ops.lead_commands (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 person_id uuid,
 authority_epoch bigint NOT NULL CHECK(authority_epoch>=0),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 result_ciphertext text NOT NULL CHECK(length(result_ciphertext)>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id)
);
CREATE TRIGGER lead_commands_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.lead_commands
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER lead_commands_no_truncate BEFORE TRUNCATE ON ls_contact_ops.lead_commands
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
REVOKE ALL ON ls_contact_ops.lead_commands FROM PUBLIC;
