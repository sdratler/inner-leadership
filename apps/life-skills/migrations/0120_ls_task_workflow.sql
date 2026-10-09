-- Internal work only. Original source date and immutable history are retained;
-- changing state/snooze never sends, pays, books, publishes or resolves a source.
ALTER TABLE ls_calendar.tasks DROP CONSTRAINT tasks_state_check;
ALTER TABLE ls_calendar.tasks ADD CONSTRAINT tasks_state_check
 CHECK(state IN ('open','in_progress','done'));
ALTER TABLE ls_calendar.tasks ADD COLUMN snoozed_until date;
ALTER TABLE ls_calendar.tasks ADD CONSTRAINT tasks_snooze_check
 CHECK(snoozed_until IS NULL OR state<>'done');
CREATE INDEX tasks_by_effective_due ON ls_calendar.tasks
 (workspace_id,(greatest(due_date,snoozed_until)),due_time,id);
ALTER TABLE ls_calendar.task_history ADD COLUMN state_value text;
ALTER TABLE ls_calendar.task_history ADD COLUMN snoozed_until date;
ALTER TABLE ls_calendar.task_history DROP CONSTRAINT task_history_action_check;
ALTER TABLE ls_calendar.task_history ADD CONSTRAINT task_history_action_check
 CHECK(action IN ('created','completed','source_updated','source_resolved','managed'));
ALTER TABLE ls_calendar.task_history ADD CONSTRAINT task_history_state_check CHECK(
 (action<>'managed' AND state_value IS NULL AND snoozed_until IS NULL) OR
 (action='managed' AND state_value IS NOT NULL AND state_value IN ('open','in_progress','done')
  AND (state_value<>'done' OR snoozed_until IS NULL)));
