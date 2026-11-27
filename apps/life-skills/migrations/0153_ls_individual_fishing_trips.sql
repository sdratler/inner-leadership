-- Fishing individual Sunday trips, verified adult registration and transactional mail.
-- This migration creates empty program tables and does not seed accounts, customers or messages.
CREATE SCHEMA ls_individual_trips;

CREATE TABLE ls_individual_trips.state (
 workspace_id uuid PRIMARY KEY REFERENCES ls_identity.workspaces(id),
 revision integer NOT NULL CHECK(revision>=0), payload_ciphertext text NOT NULL,
 updated_at timestamptz NOT NULL
);
CREATE TABLE ls_individual_trips.state_chunks (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 revision integer NOT NULL CHECK(revision>=0), chunk_index integer NOT NULL CHECK(chunk_index>=0),
 payload_ciphertext text NOT NULL,
 PRIMARY KEY(workspace_id,revision,chunk_index)
);
-- This program-specific grant, not an email string or administrative family row,
-- is the authority for parent access. One account starts its own household.
CREATE TABLE ls_individual_trips.memberships (
 workspace_id uuid NOT NULL, account_id uuid NOT NULL, household_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('active','revoked')),
 created_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(workspace_id,account_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((state='active' AND revoked_at IS NULL) OR (state='revoked' AND revoked_at IS NOT NULL))
);
CREATE TABLE ls_individual_trips.operations (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), operation_id uuid NOT NULL,
 actor_account_id uuid NOT NULL, request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 reply_ciphertext text NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_individual_trips.delivery_receipts (
 workspace_id uuid NOT NULL, operation_id uuid NOT NULL, offer_id uuid NOT NULL,
 actor_account_id uuid NOT NULL, reference_ciphertext text NOT NULL, sent_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES ls_individual_trips.operations(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_individual_trips.chat_grants (
 workspace_id uuid NOT NULL, id uuid NOT NULL, owner_account_id uuid NOT NULL,
 caller_id text NOT NULL, secret_ciphertext text NOT NULL, scopes text[] NOT NULL,
 session_digest text NOT NULL, actor_expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(expires_at>created_at)
);
CREATE TABLE ls_individual_trips.chat_nonces (
 workspace_id uuid NOT NULL, grant_id uuid NOT NULL, nonce uuid NOT NULL,
 used_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,grant_id,nonce),
 FOREIGN KEY(workspace_id,grant_id) REFERENCES ls_individual_trips.chat_grants(workspace_id,id)
);

CREATE TABLE ls_individual_trips.registration_receipts (
  workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
  operation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  version text NOT NULL CHECK(version='fishing-adult-registration-v1'),
  account_id uuid,
  outbox_id uuid REFERENCES ls_identity.auth_mail_outbox(id),
  delivery_state text NOT NULL CHECK(delivery_state IN ('queued','suppressed','sent','unknown','failed','canceled')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id,operation_id),
  UNIQUE(workspace_id,request_id),
  UNIQUE(outbox_id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
  CHECK((account_id IS NULL)=(outbox_id IS NULL)),
  CHECK((outbox_id IS NULL)=(delivery_state='suppressed'))
);
CREATE INDEX registration_receipts_owned_account ON ls_individual_trips.registration_receipts(workspace_id,account_id,version);
COMMENT ON TABLE ls_individual_trips.registration_receipts IS
  'Private free adult signup operation receipts; no program membership or existing-family grants. Unknown delivery is terminal and never automatically retried.';

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
