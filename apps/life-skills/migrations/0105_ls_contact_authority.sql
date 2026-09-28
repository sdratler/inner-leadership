-- Additive adaptation of the supplied contact-operations cutover candidate.
-- No source import, authority switch, provider effect or existing row change.
CREATE TABLE ls_contact_ops.cutover (
 workspace_id uuid PRIMARY KEY REFERENCES ls_identity.workspaces(id),
 epoch bigint NOT NULL CHECK(epoch BETWEEN 0 AND 9007199254740990),
 phase text NOT NULL CHECK(phase IN('sheet_active','shadow_ready','frozen','native_active','retired','rollback_prepared')),
 state_ciphertext text NOT NULL CHECK(length(state_ciphertext)>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ls_contact_ops.cutover_history (
 workspace_id uuid NOT NULL,
 operation_id text NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 128),
 actor_account_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('prepare','freeze','switch_native','retire_sheet','prepare_rollback','finish_rollback')),
 from_epoch bigint NOT NULL CHECK(from_epoch BETWEEN 0 AND 9007199254740989),
 result_epoch bigint NOT NULL CHECK(result_epoch=from_epoch+1),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 evidence_ciphertext text NOT NULL CHECK(length(evidence_ciphertext)>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 UNIQUE(workspace_id,result_epoch),
 FOREIGN KEY(workspace_id) REFERENCES ls_contact_ops.cutover(workspace_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE FUNCTION ls_contact_ops.deny_cutover_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'CONTACT_CUTOVER_HISTORY_APPEND_ONLY' USING ERRCODE='23514';
END;
$fn$;
CREATE TRIGGER cutover_history_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.cutover_history
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_cutover_history_mutation();
CREATE TRIGGER cutover_history_no_truncate BEFORE TRUNCATE ON ls_contact_ops.cutover_history
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_cutover_history_mutation();
REVOKE ALL ON ls_contact_ops.cutover,ls_contact_ops.cutover_history FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_contact_ops.deny_cutover_history_mutation() FROM PUBLIC;
