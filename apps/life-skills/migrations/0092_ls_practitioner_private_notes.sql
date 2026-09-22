-- LS-092: encrypted practitioner-only case notes. Additive and forward-only.
CREATE SCHEMA IF NOT EXISTS ls_private_notes;
CREATE TABLE IF NOT EXISTS ls_private_notes.case_notes (
  workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
  case_id uuid NOT NULL,
  body_ciphertext text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  updated_by_account_id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, case_id),
  FOREIGN KEY (workspace_id, updated_by_account_id) REFERENCES ls_identity.accounts(workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES ls_cases.cases(workspace_id, id)
);
CREATE TABLE IF NOT EXISTS ls_private_notes.save_receipts (
  workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
  idempotency_key uuid NOT NULL,
  case_id uuid NOT NULL,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL,
  body_digest text NOT NULL CHECK (body_digest ~ '^[0-9a-f]{64}$'),
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  actor_account_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, case_id) REFERENCES ls_cases.cases(workspace_id, id),
  FOREIGN KEY (workspace_id, actor_account_id) REFERENCES ls_identity.accounts(workspace_id, id)
);
CREATE INDEX IF NOT EXISTS case_notes_by_workspace ON ls_private_notes.case_notes(workspace_id, updated_at DESC);
