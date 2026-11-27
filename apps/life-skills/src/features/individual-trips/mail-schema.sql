-- Serial migration candidate. Encrypted operation-bound transactional messages;
-- no seed jobs, queue drain, runtime DDL, provider credentials or activation.
CREATE TABLE ls_individual_trips.operational_mail (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  actor_account_id uuid NOT NULL,
  household_id uuid NOT NULL,
  recipient_account_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('request_saved','request_withdrawn','seasonal_saved','seasonal_withdrawn','offer','payment','confirmation','cancellation','credit')),
  event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 100),
  version text NOT NULL CHECK(version='fishing-trip-operational-mail-v1'),
  offer_id uuid,
  payload_ciphertext text NOT NULL,
  state text NOT NULL CHECK(state IN ('queued','unknown','sent','failed','canceled','held')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
  delivery_operation_id uuid NOT NULL UNIQUE,
  delivery_record_state text NOT NULL DEFAULT 'not_applicable' CHECK(delivery_record_state IN ('not_applicable','pending','recorded','already_recorded','unknown')),
  attempted_payload_ciphertext text,
  send_started_at timestamptz,
  sent_at timestamptz,
  provider_id text,
  reason text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE(workspace_id,operation_id,household_id),
  UNIQUE(workspace_id,household_id,kind,event_key),
  FOREIGN KEY(workspace_id,operation_id) REFERENCES ls_individual_trips.operations(workspace_id,operation_id),
  FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
  FOREIGN KEY(workspace_id,recipient_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
  CHECK((kind='offer')=(delivery_record_state<>'not_applicable')),
  CHECK(state<>'sent' OR (sent_at IS NOT NULL AND provider_id IS NOT NULL)),
  CHECK((send_started_at IS NULL)=(attempted_payload_ciphertext IS NULL))
);
COMMENT ON TABLE ls_individual_trips.operational_mail IS
 'Encrypted immutable transactional snapshots from exact native operations. Unknown and held are terminal for automatic delivery; no historical queued-send replay.';
