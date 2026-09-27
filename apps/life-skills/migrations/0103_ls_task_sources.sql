-- Link an internal task to one verified source record without storing its
-- external identifier in plaintext. The source system remains authoritative.
ALTER TABLE ls_calendar.tasks
 ADD COLUMN source_kind text,
 ADD COLUMN source_digest text,
 ADD COLUMN source_revision text;
ALTER TABLE ls_calendar.tasks ADD CONSTRAINT tasks_source_tuple_check CHECK (
 (source_kind IS NULL AND source_digest IS NULL AND source_revision IS NULL) OR
 (source_kind = 'crm_followup' AND source_digest ~ '^[0-9a-f]{64}$' AND source_revision ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX tasks_one_source ON ls_calendar.tasks(workspace_id,source_kind,source_digest)
 WHERE source_digest IS NOT NULL;
ALTER TABLE ls_calendar.task_history DROP CONSTRAINT task_history_action_check;
ALTER TABLE ls_calendar.task_history ADD CONSTRAINT task_history_action_check
 CHECK(action IN ('created','completed','source_updated','source_resolved'));
