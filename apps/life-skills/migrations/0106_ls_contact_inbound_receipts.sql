-- Additive adaptation of the packet's message_receipts candidate. Future
-- authenticated business inquiries only; no contact import, identity grant,
-- payment, sending, cutover or automatic conversation-to-clinical projection.
CREATE TABLE ls_contact_ops.message_receipts (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 channel text NOT NULL CHECK(channel='whatsapp'),
 provider_binding_id text NOT NULL CHECK(provider_binding_id ~ '^[a-f0-9]{64}$'),
 provider_event_key text NOT NULL CHECK(provider_event_key ~ '^[a-f0-9]{64}$'),
 provider_message_key text NOT NULL CHECK(provider_message_key ~ '^[a-f0-9]{64}$'),
 event_type text NOT NULL CHECK(event_type='inbound_message'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 occurred_at timestamptz NOT NULL,
 stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,channel,provider_binding_id,provider_event_key)
);
CREATE FUNCTION ls_contact_ops.deny_message_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'CONTACT_MESSAGE_RECEIPT_APPEND_ONLY' USING ERRCODE='23514';
END;
$fn$;
CREATE TRIGGER message_receipts_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.message_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_message_receipt_mutation();
CREATE TRIGGER message_receipts_no_truncate BEFORE TRUNCATE ON ls_contact_ops.message_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_message_receipt_mutation();
REVOKE ALL ON ls_contact_ops.message_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_contact_ops.deny_message_receipt_mutation() FROM PUBLIC;
