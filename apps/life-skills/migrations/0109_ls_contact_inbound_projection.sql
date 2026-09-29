-- Administrative future-message projection only. Keep immutable encrypted raw
-- receipts and canonical people; no accounts, cases, payments or provider sends.
CREATE TABLE ls_contact_ops.inbound_threads (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 provider_binding_id text NOT NULL CHECK(provider_binding_id ~ '^[a-f0-9]{64}$'),
 provider_thread_key text NOT NULL CHECK(provider_thread_key ~ '^[a-f0-9]{64}$'),
 sender_endpoint_key text NOT NULL CHECK(sender_endpoint_key ~ '^[a-f0-9]{64}$'),
 person_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,provider_binding_id,provider_thread_key),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id)
);
CREATE TABLE ls_contact_ops.inbound_projections (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 channel text NOT NULL CHECK(channel='whatsapp'),
 provider_binding_id text NOT NULL CHECK(provider_binding_id ~ '^[a-f0-9]{64}$'),
 provider_message_key text NOT NULL CHECK(provider_message_key ~ '^[a-f0-9]{64}$'),
 provider_event_key text NOT NULL CHECK(provider_event_key ~ '^[a-f0-9]{64}$'),
 provider_thread_key text NOT NULL CHECK(provider_thread_key ~ '^[a-f0-9]{64}$'),
 message_digest text NOT NULL CHECK(message_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('projected','needs_resolution')),
 reason text NOT NULL CHECK(reason IN ('new_contact','known_thread','verified_endpoint','ambiguous_endpoint')),
 person_id uuid,
 authority_epoch bigint NOT NULL CHECK(authority_epoch BETWEEN 0 AND 9007199254740990),
 resolution_ciphertext text NOT NULL CHECK(length(resolution_ciphertext)>0),
 projected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,provider_binding_id,provider_message_key),
 FOREIGN KEY(workspace_id,channel,provider_binding_id,provider_event_key)
  REFERENCES ls_contact_ops.message_receipts(workspace_id,channel,provider_binding_id,provider_event_key),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id),
 CHECK((state='projected' AND person_id IS NOT NULL AND reason<>'ambiguous_endpoint')
  OR (state='needs_resolution' AND person_id IS NULL AND reason='ambiguous_endpoint'))
);
CREATE FUNCTION ls_contact_ops.require_inbound_live_person() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.person_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM ls_contact_ops.profiles p
  WHERE p.workspace_id=NEW.workspace_id AND p.person_id=NEW.person_id
   AND p.record_mode='live' AND p.demo_batch_id IS NULL
 ) THEN
  RAISE EXCEPTION 'CONTACT_INBOUND_LIVE_PERSON_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE FUNCTION ls_contact_ops.deny_inbound_projection_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 RAISE EXCEPTION 'CONTACT_INBOUND_PROJECTION_APPEND_ONLY' USING ERRCODE='23514';
END;
$fn$;
CREATE TRIGGER inbound_thread_live_person BEFORE INSERT ON ls_contact_ops.inbound_threads
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.require_inbound_live_person();
CREATE TRIGGER inbound_projection_live_person BEFORE INSERT ON ls_contact_ops.inbound_projections
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.require_inbound_live_person();
CREATE TRIGGER inbound_threads_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.inbound_threads
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_inbound_projection_mutation();
CREATE TRIGGER inbound_threads_no_truncate BEFORE TRUNCATE ON ls_contact_ops.inbound_threads
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_inbound_projection_mutation();
CREATE TRIGGER inbound_projections_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.inbound_projections
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_inbound_projection_mutation();
CREATE TRIGGER inbound_projections_no_truncate BEFORE TRUNCATE ON ls_contact_ops.inbound_projections
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_inbound_projection_mutation();
REVOKE ALL ON ls_contact_ops.inbound_threads,ls_contact_ops.inbound_projections FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_contact_ops.require_inbound_live_person(),ls_contact_ops.deny_inbound_projection_mutation() FROM PUBLIC;
