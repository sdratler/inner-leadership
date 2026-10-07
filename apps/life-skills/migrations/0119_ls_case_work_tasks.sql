-- Expand the existing encrypted internal task source tuple. No source records,
-- provider effects, credentials, permissions or historical task values change.
ALTER TABLE ls_calendar.tasks DROP CONSTRAINT tasks_source_tuple_check;
ALTER TABLE ls_calendar.tasks ADD CONSTRAINT tasks_source_tuple_check CHECK (
 (source_kind IS NULL AND source_digest IS NULL AND source_revision IS NULL) OR
 (source_kind IS NOT NULL AND source_digest IS NOT NULL AND source_revision IS NOT NULL
  AND source_kind IN ('crm_followup','calendar_notice','form_review','update_review','session_observations','report_review')
  AND source_digest ~ '^[0-9a-f]{64}$' AND source_revision ~ '^[0-9a-f]{64}$')
);
