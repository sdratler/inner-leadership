-- Forward-only candidate schema for the individual-trip domain. No seed records,
-- provider activation, case grants or legacy imports. The shared integrator
-- assigns the migration number/checksum when adopting this additive candidate.
CREATE SCHEMA IF NOT EXISTS ls_individual_trips;
CREATE TABLE IF NOT EXISTS ls_individual_trips.state (
 workspace_id uuid PRIMARY KEY REFERENCES ls_identity.workspaces(id),
 revision integer NOT NULL CHECK(revision>=0), payload_ciphertext text NOT NULL,
 updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS ls_individual_trips.state_chunks (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 revision integer NOT NULL CHECK(revision>=0), chunk_index integer NOT NULL CHECK(chunk_index>=0),
 payload_ciphertext text NOT NULL,
 PRIMARY KEY(workspace_id,revision,chunk_index)
);
-- This program-specific grant, not an email string or administrative family row,
-- is the authority for parent access. One account starts its own household.
CREATE TABLE IF NOT EXISTS ls_individual_trips.memberships (
 workspace_id uuid NOT NULL, account_id uuid NOT NULL, household_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('active','revoked')),
 created_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(workspace_id,account_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((state='active' AND revoked_at IS NULL) OR (state='revoked' AND revoked_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS ls_individual_trips.operations (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), operation_id uuid NOT NULL,
 actor_account_id uuid NOT NULL, request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 reply_ciphertext text NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_individual_trips.delivery_receipts (
 workspace_id uuid NOT NULL, operation_id uuid NOT NULL, offer_id uuid NOT NULL,
 actor_account_id uuid NOT NULL, reference_ciphertext text NOT NULL, sent_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES ls_individual_trips.operations(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_individual_trips.chat_grants (
 workspace_id uuid NOT NULL, id uuid NOT NULL, owner_account_id uuid NOT NULL,
 caller_id text NOT NULL, secret_ciphertext text NOT NULL, scopes text[] NOT NULL,
 session_digest text NOT NULL, actor_expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(expires_at>created_at)
);
CREATE TABLE IF NOT EXISTS ls_individual_trips.chat_nonces (
 workspace_id uuid NOT NULL, grant_id uuid NOT NULL, nonce uuid NOT NULL,
 used_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,grant_id,nonce),
 FOREIGN KEY(workspace_id,grant_id) REFERENCES ls_individual_trips.chat_grants(workspace_id,id)
);
