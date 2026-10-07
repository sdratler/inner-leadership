-- R35: additive PRIVATE provider directory and PRIVATE referral coordination.
-- NUMBER THIS ONCE in the current writer's migration sequence. No real rows.
-- No CRM-authority switch, public projection, account, sender, billing or scraper.
CREATE SCHEMA ls_provider_index;
CREATE SCHEMA ls_provider_referrals;
REVOKE ALL ON SCHEMA ls_provider_index, ls_provider_referrals FROM PUBLIC;
CREATE TABLE ls_provider_index.entries (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 100000),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,owner_account_id,id),
  FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX provider_entries_owner ON ls_provider_index.entries(workspace_id,owner_account_id,id);
CREATE TABLE ls_provider_referrals.contexts (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  case_id uuid,
  payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 100000),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,owner_account_id,provider_id) REFERENCES ls_provider_index.entries(workspace_id,owner_account_id,id),
  FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id)
);
CREATE INDEX provider_referrals_case ON ls_provider_referrals.contexts(workspace_id,owner_account_id,case_id,created_at);
CREATE INDEX provider_referrals_provider ON ls_provider_referrals.contexts(workspace_id,owner_account_id,provider_id,created_at);
-- Database-level ownership and immutable-scope defenses backstop the service
-- authorization checks. A case-scoped referral must belong to that case's
-- practitioner; general coordination has no case to bind.
CREATE FUNCTION ls_provider_referrals.assert_case_owner() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ls_cases.cases c
    WHERE c.workspace_id=NEW.workspace_id AND c.id=NEW.case_id
      AND c.practitioner_account_id=NEW.owner_account_id
  ) THEN
    RAISE EXCEPTION 'PROVIDER_REFERRAL_CASE_OWNER' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE FUNCTION ls_provider_index.deny_entry_scope_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.id IS DISTINCT FROM NEW.id
     OR OLD.owner_account_id IS DISTINCT FROM NEW.owner_account_id THEN
    RAISE EXCEPTION 'PROVIDER_ENTRY_SCOPE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE FUNCTION ls_provider_referrals.deny_scope_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.id IS DISTINCT FROM NEW.id
     OR OLD.owner_account_id IS DISTINCT FROM NEW.owner_account_id
     OR OLD.provider_id IS DISTINCT FROM NEW.provider_id
     OR OLD.case_id IS DISTINCT FROM NEW.case_id THEN
    RAISE EXCEPTION 'PROVIDER_REFERRAL_SCOPE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER provider_entry_scope_no_edit BEFORE UPDATE ON ls_provider_index.entries
  FOR EACH ROW EXECUTE FUNCTION ls_provider_index.deny_entry_scope_mutation();
CREATE TRIGGER provider_referral_scope_no_edit BEFORE UPDATE ON ls_provider_referrals.contexts
  FOR EACH ROW EXECUTE FUNCTION ls_provider_referrals.deny_scope_mutation();
CREATE TRIGGER provider_referral_case_owner BEFORE INSERT OR UPDATE ON ls_provider_referrals.contexts
  FOR EACH ROW EXECUTE FUNCTION ls_provider_referrals.assert_case_owner();
CREATE TABLE ls_provider_index.command_receipts (
  workspace_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('provider_create','provider_update','provider_archive','referral_create','referral_update')),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  result_id uuid NOT NULL,
  result_version integer NOT NULL CHECK(result_version > 0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,owner_account_id,operation_id),
  FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_provider_index.access_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  request_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('directory_read','provider_read','provider_create','provider_update','provider_archive','referral_read','referral_create','referral_update')),
  subject_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX provider_access_owner ON ls_provider_index.access_events(workspace_id,owner_account_id,occurred_at);
-- Reuse the existing approved private-app DB-role grant mechanism. Do not grant
-- these schemas to an anonymous/public/marketing role or change historical grants.

-- Receipts and access evidence are append-only, including protection from TRUNCATE.
CREATE FUNCTION ls_provider_index.deny_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'PROVIDER_HISTORY_IMMUTABLE' USING ERRCODE='23514';
END;
$fn$;
CREATE TRIGGER provider_receipts_no_edit BEFORE UPDATE OR DELETE ON ls_provider_index.command_receipts
  FOR EACH ROW EXECUTE FUNCTION ls_provider_index.deny_history_mutation();
CREATE TRIGGER provider_receipts_no_truncate BEFORE TRUNCATE ON ls_provider_index.command_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION ls_provider_index.deny_history_mutation();
CREATE TRIGGER provider_access_no_edit BEFORE UPDATE OR DELETE ON ls_provider_index.access_events
  FOR EACH ROW EXECUTE FUNCTION ls_provider_index.deny_history_mutation();
CREATE TRIGGER provider_access_no_truncate BEFORE TRUNCATE ON ls_provider_index.access_events
  FOR EACH STATEMENT EXECUTE FUNCTION ls_provider_index.deny_history_mutation();
REVOKE ALL ON ALL TABLES IN SCHEMA ls_provider_index, ls_provider_referrals FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_provider_index.deny_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_provider_index.deny_entry_scope_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_provider_referrals.deny_scope_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_provider_referrals.assert_case_owner() FROM PUBLIC;
