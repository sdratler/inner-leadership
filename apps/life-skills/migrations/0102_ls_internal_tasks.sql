-- Practitioner-private operational tasks. No provider send, financial effect or
-- calendar booking is caused by creating or completing one of these records.
CREATE TABLE ls_calendar.tasks (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 created_by uuid NOT NULL,
 case_id uuid,
 title_ciphertext text NOT NULL CHECK(length(title_ciphertext)>0),
 note_ciphertext text,
 source_path_ciphertext text,
 due_date date NOT NULL,
 due_time time without time zone,
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','done')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id)
);
CREATE INDEX tasks_by_due ON ls_calendar.tasks(workspace_id,due_date,due_time,id);
CREATE TABLE ls_calendar.task_history (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 task_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN ('created','completed')),
 actor_account_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,task_id,version),
 FOREIGN KEY(workspace_id,task_id) REFERENCES ls_calendar.tasks(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TRIGGER task_history_immutable BEFORE UPDATE OR DELETE ON ls_calendar.task_history
 FOR EACH ROW EXECUTE FUNCTION ls_calendar.append_only();
REVOKE ALL ON ls_calendar.tasks FROM PUBLIC;
REVOKE ALL ON ls_calendar.task_history FROM PUBLIC;
