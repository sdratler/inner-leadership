-- One owner-clicked writing-rule correction against the existing raw Markdown
-- source. Pending payloads are encrypted and are not an editable second guide.
-- This table never posts, sends a message, bills, or changes clinical records.
CREATE SCHEMA IF NOT EXISTS ls_content_voice;
CREATE TABLE ls_content_voice.rule_changes (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 operation_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 source_file_id text NOT NULL CHECK(source_file_id='174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn'),
 source_before_sha256 text NOT NULL CHECK(source_before_sha256 ~ '^[0-9a-f]{64}$'),
 source_before_revision text NOT NULL CHECK(source_before_revision ~ '^[0-9]+$'),
 desired_sha256 text NOT NULL CHECK(desired_sha256 ~ '^[0-9a-f]{64}$'),
 desired_ciphertext text,
 request_ciphertext text NOT NULL,
 before_excerpt_ciphertext text,
 after_excerpt_ciphertext text NOT NULL,
 affected_rule_id text NOT NULL CHECK(affected_rule_id ~ '^CR-[0-9a-f]{32}$'),
 language text NOT NULL CHECK(language IN ('he','en','both')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN
  ('pending','permission_denied','conflict','unknown','saved','draft_pending','draft_conflict','complete')),
 source_after_sha256 text CHECK(source_after_sha256 ~ '^[0-9a-f]{64}$'),
 source_after_revision text CHECK(source_after_revision ~ '^[0-9]+$'),
 draft_operation_id uuid NOT NULL,
 draft_result_ciphertext text,
 created_at timestamptz NOT NULL,
 saved_at timestamptz,
 revised_at timestamptz,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 UNIQUE(workspace_id,draft_operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((source_after_sha256 IS NULL AND source_after_revision IS NULL AND saved_at IS NULL)
  OR (source_after_sha256 IS NOT NULL AND source_after_revision IS NOT NULL AND saved_at IS NOT NULL)),
 CHECK((status IN ('saved','draft_pending','draft_conflict','complete'))=(saved_at IS NOT NULL)),
 CHECK((status='complete')=(revised_at IS NOT NULL))
);
CREATE INDEX rule_changes_by_owner_time ON ls_content_voice.rule_changes
 (workspace_id,actor_account_id,created_at DESC);
CREATE TABLE ls_content_voice.rule_change_history (
 workspace_id uuid NOT NULL,
 event_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN
  ('prepared','permission_denied','conflict','unknown','saved','draft_pending','draft_conflict','complete')),
 source_sha256 text CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_revision text CHECK(source_revision ~ '^[0-9]+$'),
 occurred_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,event_id),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES ls_content_voice.rule_changes(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TRIGGER rule_change_history_immutable BEFORE UPDATE OR DELETE ON ls_content_voice.rule_change_history
 FOR EACH ROW EXECUTE FUNCTION ls_calendar.append_only();
REVOKE ALL ON SCHEMA ls_content_voice FROM PUBLIC;
REVOKE ALL ON ls_content_voice.rule_changes FROM PUBLIC;
REVOKE ALL ON ls_content_voice.rule_change_history FROM PUBLIC;
