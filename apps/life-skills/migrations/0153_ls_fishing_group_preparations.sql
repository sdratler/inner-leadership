-- Registered additive owner preparation drafts, from reviewed isolated fixture.
CREATE SCHEMA IF NOT EXISTS ls_fishing_billing;

-- One immutable row is both a historical revision and the receipt for its operation.
CREATE TABLE ls_fishing_billing.group_preparation_versions (
  workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
  group_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  contract_version text NOT NULL CHECK (contract_version = 'JLFA-FISHING-GROUP-PREPARATION-v1'),
  program_key text NOT NULL CHECK (program_key = 'fishing_monthly_club'),
  state text NOT NULL CHECK (state IN ('draft', 'cancelled')),
  action text NOT NULL CHECK (action IN ('create', 'edit', 'cancel')),
  operation_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz(3) NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz(3) NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  record_digest text NOT NULL CHECK (record_digest ~ '^[a-f0-9]{64}$'),
  previous_revision integer GENERATED ALWAYS AS (CASE WHEN revision > 1 THEN revision - 1 END) STORED,
  previous_digest text CHECK (previous_digest ~ '^[a-f0-9]{64}$'),
  payload_ciphertext text NOT NULL CHECK (length(payload_ciphertext) > 0),
  PRIMARY KEY (workspace_id, group_id, revision),
  UNIQUE (workspace_id, operation_id),
  UNIQUE (workspace_id, group_id, revision, record_digest),
  FOREIGN KEY (workspace_id, created_by) REFERENCES ls_identity.accounts(workspace_id, id),
  FOREIGN KEY (workspace_id, recorded_by) REFERENCES ls_identity.accounts(workspace_id, id),
  FOREIGN KEY (workspace_id, group_id, previous_revision, previous_digest)
    REFERENCES ls_fishing_billing.group_preparation_versions(workspace_id, group_id, revision, record_digest),
  CHECK ((revision = 1) = (action = 'create')),
  CHECK ((revision = 1) = (previous_digest IS NULL)),
  CHECK ((state = 'cancelled') = (action = 'cancel')),
  CHECK (recorded_at >= created_at),
  CHECK (revision <> 1 OR (created_at = recorded_at AND created_by = recorded_by))
);

CREATE TABLE ls_fishing_billing.group_preparation_heads (
  workspace_id uuid NOT NULL,
  group_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  record_digest text NOT NULL,
  PRIMARY KEY (workspace_id, group_id),
  FOREIGN KEY (workspace_id, group_id, revision, record_digest)
    REFERENCES ls_fishing_billing.group_preparation_versions(workspace_id, group_id, revision, record_digest)
);

CREATE FUNCTION ls_fishing_billing.protect_group_preparation_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GROUP_PREPARATION_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER immutable_group_preparation_version BEFORE UPDATE OR DELETE
  ON ls_fishing_billing.group_preparation_versions FOR EACH ROW
  EXECUTE FUNCTION ls_fishing_billing.protect_group_preparation_history();
CREATE TRIGGER no_group_preparation_history_truncate BEFORE TRUNCATE
  ON ls_fishing_billing.group_preparation_versions FOR EACH STATEMENT
  EXECUTE FUNCTION ls_fishing_billing.protect_group_preparation_history();
CREATE TRIGGER no_group_preparation_head_delete BEFORE DELETE OR TRUNCATE
  ON ls_fishing_billing.group_preparation_heads FOR EACH STATEMENT
  EXECUTE FUNCTION ls_fishing_billing.protect_group_preparation_history();

CREATE FUNCTION ls_fishing_billing.advance_group_preparation_head() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id = OLD.workspace_id AND NEW.group_id = OLD.group_id AND NEW.revision = OLD.revision + 1
     AND EXISTS (SELECT 1 FROM ls_fishing_billing.group_preparation_versions r
       WHERE r.workspace_id = OLD.workspace_id AND r.group_id = OLD.group_id AND r.revision = NEW.revision
         AND r.record_digest = NEW.record_digest AND r.previous_digest = OLD.record_digest) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'GROUP_PREPARATION_HEAD_CONFLICT' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER forward_group_preparation_head BEFORE UPDATE ON ls_fishing_billing.group_preparation_heads
  FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.advance_group_preparation_head();

REVOKE ALL ON ls_fishing_billing.group_preparation_heads, ls_fishing_billing.group_preparation_versions FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_group_preparation_history(),
                       ls_fishing_billing.advance_group_preparation_head() FROM PUBLIC;
