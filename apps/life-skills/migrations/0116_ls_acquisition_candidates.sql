-- LS-ACQ-CRM-20261002-01: unknown shared-number events are metadata candidates,
-- not active leads. No historical row rewrite, identity creation or provider send.
CREATE TABLE ls_contact_ops.inbound_activity_candidates (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 provider_binding_id text NOT NULL CHECK(provider_binding_id ~ '^[a-f0-9]{64}$'),
 provider_message_key text NOT NULL CHECK(provider_message_key ~ '^[a-f0-9]{64}$'),
 provider_thread_key text NOT NULL CHECK(provider_thread_key ~ '^[a-f0-9]{64}$'),
 sender_endpoint_key text NOT NULL CHECK(sender_endpoint_key ~ '^[a-f0-9]{64}$'),
 message_digest text NOT NULL CHECK(message_digest ~ '^[a-f0-9]{64}$'),
 metadata_ciphertext text NOT NULL CHECK(length(metadata_ciphertext)>0),
 occurred_at timestamptz NOT NULL,
 stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,provider_binding_id,provider_message_key),
 UNIQUE(workspace_id,id)
);
CREATE INDEX acquisition_candidates_recent ON ls_contact_ops.inbound_activity_candidates(workspace_id,occurred_at DESC,id DESC);
-- Own this guard independently: the reviewed inbound-projection integrity
-- probes must still be able to inspect absence of the older projection frame.
CREATE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 RAISE EXCEPTION 'ACQUISITION_RECEIPT_IMMUTABLE' USING ERRCODE='23514';
END;
$fn$;
CREATE TRIGGER acquisition_candidates_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.inbound_activity_candidates
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER acquisition_candidates_no_truncate BEFORE TRUNCATE ON ls_contact_ops.inbound_activity_candidates
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
REVOKE ALL ON ls_contact_ops.inbound_activity_candidates FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation() FROM PUBLIC;
