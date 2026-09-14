-- LS-070: durable, database-only retry state. No scheduler or provider is installed.
-- These unmerged feature migrations extend the accepted 0010 application baseline.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_workspace_id
 ON ls_calendar.events(workspace_id,id);

CREATE TABLE ls_integration.calendar_delivery_attempts (
 workspace_id uuid NOT NULL,
 event_id uuid NOT NULL,
 attempts integer NOT NULL CHECK(attempts>0),
 last_attempted_at timestamptz NOT NULL,
 retry_after timestamptz NOT NULL,
 failure_code text NOT NULL CHECK(failure_code='deferred'),
 PRIMARY KEY(workspace_id,event_id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES ls_calendar.events(workspace_id,id),
 CHECK(retry_after>last_attempted_at)
);

COMMENT ON TABLE ls_integration.calendar_delivery_attempts IS
 'Neutral failed-delivery summary, retained after recovery; calendar.events.delivered_at is the resolution fact. No payload, error message, debt or provider data.';
