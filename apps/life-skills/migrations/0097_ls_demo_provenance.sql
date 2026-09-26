-- Owner-controlled production demo provenance. No demo records are created by this migration.
-- Registration is operator-only and must occur in the same transaction as synthetic creation.
CREATE SCHEMA ls_demo;
CREATE TABLE ls_demo.batches (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 batch_id text NOT NULL CHECK(batch_id ~ '^ls-owner-[0-9]{8}$'),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,batch_id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_demo.cases (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, batch_id text NOT NULL,
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 120),
 marked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,case_id), UNIQUE(workspace_id,batch_id,case_id),
 UNIQUE(workspace_id,batch_id,source_key),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,batch_id) REFERENCES ls_demo.batches(workspace_id,batch_id)
);
CREATE TABLE ls_demo.accounts (
 workspace_id uuid NOT NULL, account_id uuid NOT NULL, batch_id text NOT NULL,
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 120),
 marked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,account_id), UNIQUE(workspace_id,batch_id,account_id),
 UNIQUE(workspace_id,batch_id,source_key),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,batch_id) REFERENCES ls_demo.batches(workspace_id,batch_id)
);
CREATE TABLE ls_demo.records (
 workspace_id uuid NOT NULL, batch_id text NOT NULL,
 entity_kind text NOT NULL CHECK(entity_kind IN ('person','family','client','prospect','appointment','task','form','submission','message','assignment','observation','report','credit')),
 entity_key text NOT NULL CHECK(length(entity_key) BETWEEN 1 AND 160),
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 120),
 case_id uuid, account_id uuid,
 marked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,entity_kind,entity_key),
 UNIQUE(workspace_id,batch_id,entity_kind,source_key),
 CHECK(case_id IS NOT NULL OR account_id IS NOT NULL),
 FOREIGN KEY(workspace_id,batch_id) REFERENCES ls_demo.batches(workspace_id,batch_id),
 FOREIGN KEY(workspace_id,batch_id,case_id) REFERENCES ls_demo.cases(workspace_id,batch_id,case_id),
 FOREIGN KEY(workspace_id,batch_id,account_id) REFERENCES ls_demo.accounts(workspace_id,batch_id,account_id)
);
-- The calendar relay must acknowledge synthetic attendance without touching real credit balances.
ALTER TABLE ls_calendar.events ADD CONSTRAINT ls_calendar_event_workspace_id UNIQUE(workspace_id,id);
CREATE TABLE ls_demo.suppressed_effects (
 workspace_id uuid NOT NULL, source_event_id uuid NOT NULL, case_id uuid NOT NULL,
 batch_id text NOT NULL, effect_kind text NOT NULL CHECK(effect_kind='calendar_credit'),
 event_digest text NOT NULL CHECK(event_digest ~ '^[0-9a-f]{64}$'),
 suppressed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,source_event_id),
 FOREIGN KEY(workspace_id,batch_id,case_id) REFERENCES ls_demo.cases(workspace_id,batch_id,case_id),
 FOREIGN KEY(workspace_id,source_event_id) REFERENCES ls_calendar.events(workspace_id,id)
);
-- Ordinary application code cannot relabel or unmark a synthetic root or descendant.
CREATE FUNCTION ls_demo.prevent_marker_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'LS_DEMO_MARKER_IMMUTABLE' USING ERRCODE='23514';
END;
$fn$;
CREATE TRIGGER immutable_demo_batch BEFORE UPDATE OR DELETE ON ls_demo.batches FOR EACH ROW EXECUTE FUNCTION ls_demo.prevent_marker_change();
CREATE TRIGGER immutable_demo_case BEFORE UPDATE OR DELETE ON ls_demo.cases FOR EACH ROW EXECUTE FUNCTION ls_demo.prevent_marker_change();
CREATE TRIGGER immutable_demo_account BEFORE UPDATE OR DELETE ON ls_demo.accounts FOR EACH ROW EXECUTE FUNCTION ls_demo.prevent_marker_change();
CREATE TRIGGER immutable_demo_record BEFORE UPDATE OR DELETE ON ls_demo.records FOR EACH ROW EXECUTE FUNCTION ls_demo.prevent_marker_change();
CREATE TRIGGER immutable_demo_suppressed_effect BEFORE UPDATE OR DELETE ON ls_demo.suppressed_effects FOR EACH ROW EXECUTE FUNCTION ls_demo.prevent_marker_change();
REVOKE ALL ON SCHEMA ls_demo FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ls_demo FROM PUBLIC;
