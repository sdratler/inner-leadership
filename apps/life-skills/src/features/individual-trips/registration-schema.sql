-- Feature-local proposal for serial adoption through the existing migration
-- ledger. No runtime DDL, seed identities, provider activation or historical mail.
CREATE SCHEMA IF NOT EXISTS ls_individual_trips;
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
