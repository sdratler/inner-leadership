-- Additive LOCAL CANDIDATE ONLY. No numbered production migration or runtime
-- admission. No booking/seat/credit/payment/provider/source-approval writer.
CREATE SCHEMA ls_academy_calendar;
CREATE TABLE ls_academy_calendar.events (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), event_id uuid NOT NULL,
 operator_id uuid NOT NULL, calendar_month text NOT NULL CHECK(calendar_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 kind text NOT NULL CHECK(kind='monthly_core_keys'), created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,event_id), UNIQUE(workspace_id,operator_id,calendar_month),
 FOREIGN KEY(workspace_id,operator_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_academy_calendar.event_revisions (
 workspace_id uuid NOT NULL, event_id uuid NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000000),
 previous_sha256 text CHECK(previous_sha256 ~ '^[a-f0-9]{64}$'), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('needs_placement','review_required')), operation_id uuid NOT NULL,
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 196608), recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,event_id,revision), UNIQUE(workspace_id,event_id,sha256),
 CHECK((revision=1)=(previous_sha256 IS NULL)),
 FOREIGN KEY(workspace_id,event_id) REFERENCES ls_academy_calendar.events(workspace_id,event_id)
);
-- Exact original cohort/stage/occurrence identity, one weekly meeting per group
-- in each candidate revision. This index does not consume any purchased lesson.
CREATE TABLE ls_academy_calendar.original_links (
 workspace_id uuid NOT NULL, event_id uuid NOT NULL, event_revision integer NOT NULL,
 cohort_id uuid NOT NULL, stage_id uuid NOT NULL, occurrence_id uuid NOT NULL, occurrence_revision integer NOT NULL CHECK(occurrence_revision>0),
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(workspace_id,event_id,event_revision,cohort_id), UNIQUE(workspace_id,event_id,event_revision,occurrence_id),
 FOREIGN KEY(workspace_id,event_id,event_revision) REFERENCES ls_academy_calendar.event_revisions(workspace_id,event_id,revision),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.plans(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id)
);
CREATE TABLE ls_academy_calendar.commands (
 workspace_id uuid NOT NULL, actor_id uuid NOT NULL, operation_id uuid NOT NULL, event_id uuid NOT NULL, event_revision integer NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'), payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 196608), recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,operation_id),
 FOREIGN KEY(workspace_id,actor_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,event_id,event_revision) REFERENCES ls_academy_calendar.event_revisions(workspace_id,event_id,revision)
);
CREATE FUNCTION ls_academy_calendar.reject_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACADEMY_GROUP_CALENDAR_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON ls_academy_calendar.events FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_event_revision BEFORE UPDATE OR DELETE ON ls_academy_calendar.event_revisions FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_original_link BEFORE UPDATE OR DELETE ON ls_academy_calendar.original_links FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_calendar_command BEFORE UPDATE OR DELETE ON ls_academy_calendar.commands FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
