-- LS-040: forward-only home-practice, goals, commitments and check-ins.
-- Requires 0010_ls_identity_cases_20260906.sql and frozen I-013/I-014 contracts.
-- No fixture/client data, provider activation, grants, or shared-interface changes.
CREATE SCHEMA IF NOT EXISTS ls_practice;

CREATE OR REPLACE FUNCTION ls_practice.uuid_array_is_unique(value uuid[]) RETURNS boolean
 LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
 SELECT cardinality(value)=count(DISTINCT item) FROM unnest(value) AS item;
$fn$;

CREATE TABLE IF NOT EXISTS ls_practice.goals (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL,
 title_ciphertext text NOT NULL, state text NOT NULL CHECK(state IN ('active','closed')),
 created_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,case_id,audience_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE TABLE IF NOT EXISTS ls_practice.commitments (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL,
 goal_id uuid NOT NULL, title_ciphertext text NOT NULL,
 state text NOT NULL CHECK(state IN ('active','closed')),
 created_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,case_id,audience_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id,goal_id) REFERENCES ls_practice.goals(workspace_id,case_id,audience_id,id),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE TABLE IF NOT EXISTS ls_practice.practice_assignments (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL,
 goal_id uuid, commitment_id uuid,
 state text NOT NULL CHECK(state IN ('draft','published','retired')),
 active_version_id uuid,
 created_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id,goal_id) REFERENCES ls_practice.goals(workspace_id,case_id,audience_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id,commitment_id) REFERENCES ls_practice.commitments(workspace_id,case_id,audience_id,id),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((state='draft' AND active_version_id IS NULL) OR (state<>'draft' AND active_version_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ls_practice.practice_assignment_versions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, assignment_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), template_key text NOT NULL, template_version text NOT NULL,
 instructions_ciphertext text NOT NULL, starts_on date NOT NULL, ends_on date,
 state text NOT NULL CHECK(state IN ('draft','published')),
 created_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL,
 published_by_account_id uuid, published_at timestamptz,
 immutable_snapshot_digest text CHECK(immutable_snapshot_digest IS NULL OR immutable_snapshot_digest ~ '^[0-9a-f]{64}$'),
 supersedes_version_id uuid,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,assignment_id,version),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES ls_practice.practice_assignments(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,published_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,supersedes_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id),
 CHECK(ends_on IS NULL OR ends_on>=starts_on),
 CHECK((state='draft' AND published_by_account_id IS NULL AND published_at IS NULL AND immutable_snapshot_digest IS NULL)
    OR (state='published' AND published_by_account_id IS NOT NULL AND published_at IS NOT NULL AND immutable_snapshot_digest IS NOT NULL))
);

ALTER TABLE ls_practice.practice_assignments
 DROP CONSTRAINT IF EXISTS practice_assignments_active_version_fk;
ALTER TABLE ls_practice.practice_assignments
 ADD CONSTRAINT practice_assignments_active_version_fk
 FOREIGN KEY(workspace_id,active_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id);

CREATE TABLE IF NOT EXISTS ls_practice.task_coordination_versions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, assignment_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), case_id uuid NOT NULL, audience_id uuid NOT NULL,
 assignee_account_ids uuid[] NOT NULL,
 completion_mode text NOT NULL CHECK(completion_mode IN ('any_assignee','each_assignee')),
 reminder_candidate_account_ids uuid[] NOT NULL,
 effective_from timestamptz NOT NULL, changed_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,assignment_id,version),
 FOREIGN KEY(workspace_id,case_id,assignment_id) REFERENCES ls_practice.practice_assignments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,changed_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(cardinality(assignee_account_ids) BETWEEN 1 AND 2),
 CHECK(ls_practice.uuid_array_is_unique(assignee_account_ids)),
 CHECK(ls_practice.uuid_array_is_unique(reminder_candidate_account_ids)),
 CHECK(reminder_candidate_account_ids <@ assignee_account_ids),
 CHECK(completion_mode<>'each_assignee' OR cardinality(assignee_account_ids)=2)
);

CREATE TABLE IF NOT EXISTS ls_practice.practice_occurrences (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, assignment_id uuid NOT NULL,
 practice_version_id uuid NOT NULL, coordination_version_id uuid NOT NULL,
 occurs_on date NOT NULL, period text NOT NULL CHECK(period IN ('morning','evening')),
 state text NOT NULL CHECK(state IN ('open','closed')), created_at timestamptz NOT NULL, closed_at timestamptz,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,assignment_id,occurs_on,period),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES ls_practice.practice_assignments(workspace_id,id),
 FOREIGN KEY(workspace_id,practice_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,coordination_version_id) REFERENCES ls_practice.task_coordination_versions(workspace_id,id),
 CHECK((state='open' AND closed_at IS NULL) OR (state='closed' AND closed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ls_practice.completion_reports (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, occurrence_id uuid NOT NULL,
 author_account_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('done','partly_done','not_done','rescheduled','not_applicable')),
 revision integer NOT NULL CHECK(revision>0), reported_at timestamptz NOT NULL,
 idempotency_key uuid NOT NULL, corrects_report_id uuid,
 UNIQUE(workspace_id,id),
 UNIQUE(workspace_id,author_account_id,idempotency_key),
 UNIQUE(workspace_id,occurrence_id,author_account_id,revision),
 FOREIGN KEY(workspace_id,occurrence_id) REFERENCES ls_practice.practice_occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,author_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,corrects_report_id) REFERENCES ls_practice.completion_reports(workspace_id,id),
 CHECK((revision=1 AND corrects_report_id IS NULL) OR (revision>1 AND corrects_report_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ls_practice.action_history (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, actor_account_id uuid NOT NULL,
 request_id uuid NOT NULL, action text NOT NULL CHECK(action IN (
  'practice_goal_created','practice_commitment_created','practice_assignment_draft_created',
  'practice_assignment_revision_drafted','practice_assignment_published','practice_coordination_changed',
  'practice_occurrence_scheduled','practice_checkin_reported','practice_checkin_corrected'
 )), occurred_at timestamptz NOT NULL,
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE INDEX IF NOT EXISTS practice_versions_by_assignment
 ON ls_practice.practice_assignment_versions(workspace_id,assignment_id,version DESC);
CREATE INDEX IF NOT EXISTS practice_occurrences_by_date
 ON ls_practice.practice_occurrences(workspace_id,occurs_on,period,id);
CREATE INDEX IF NOT EXISTS completion_reports_by_occurrence
 ON ls_practice.completion_reports(workspace_id,occurrence_id,author_account_id,revision DESC);

-- Published clinical instructions, coordination snapshots and reports are append-only history.
CREATE OR REPLACE FUNCTION ls_practice.protect_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'LS_PRACTICE_IMMUTABLE_HISTORY' USING ERRCODE='55000';
END;
$fn$;
DROP TRIGGER IF EXISTS protect_published_practice_version ON ls_practice.practice_assignment_versions;
CREATE TRIGGER protect_published_practice_version BEFORE UPDATE OR DELETE ON ls_practice.practice_assignment_versions
 FOR EACH ROW WHEN (OLD.state='published') EXECUTE FUNCTION ls_practice.protect_immutable_row();
DROP TRIGGER IF EXISTS protect_coordination_version ON ls_practice.task_coordination_versions;
CREATE TRIGGER protect_coordination_version BEFORE UPDATE OR DELETE ON ls_practice.task_coordination_versions
 FOR EACH ROW EXECUTE FUNCTION ls_practice.protect_immutable_row();
DROP TRIGGER IF EXISTS protect_completion_report ON ls_practice.completion_reports;
CREATE TRIGGER protect_completion_report BEFORE UPDATE OR DELETE ON ls_practice.completion_reports
 FOR EACH ROW EXECUTE FUNCTION ls_practice.protect_immutable_row();

-- Fail closed if an adapter attempts to publish a version from another assignment.
CREATE OR REPLACE FUNCTION ls_practice.check_active_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.active_version_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM ls_practice.practice_assignment_versions v
  WHERE v.workspace_id=NEW.workspace_id AND v.assignment_id=NEW.id AND v.id=NEW.active_version_id AND v.state='published'
 ) THEN RAISE EXCEPTION 'LS_PRACTICE_ACTIVE_VERSION_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS check_active_version ON ls_practice.practice_assignments;
CREATE CONSTRAINT TRIGGER check_active_version AFTER INSERT OR UPDATE OF active_version_id,state
 ON ls_practice.practice_assignments DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION ls_practice.check_active_version();

-- Coordination is parent-authored, keeps the audience fixed, and names only active case guardians.
CREATE OR REPLACE FUNCTION ls_practice.check_coordination_actor_and_assignees() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE candidate uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts a JOIN ls_cases.case_guardians g
  ON g.workspace_id=a.workspace_id AND g.account_id=a.id
  WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.changed_by_account_id AND a.role='parent' AND a.state='active'
   AND g.case_id=NEW.case_id AND g.revoked_at IS NULL) THEN
  RAISE EXCEPTION 'LS_PRACTICE_PARENT_REQUIRED' USING ERRCODE='23514';
 END IF;
 FOREACH candidate IN ARRAY NEW.assignee_account_ids LOOP
  IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts a JOIN ls_cases.case_guardians g
   ON g.workspace_id=a.workspace_id AND g.account_id=a.id JOIN ls_cases.audience_accounts aa
   ON aa.workspace_id=g.workspace_id AND aa.case_id=g.case_id AND aa.account_id=g.account_id
   WHERE a.workspace_id=NEW.workspace_id AND a.id=candidate AND a.role='parent' AND a.state='active'
    AND g.case_id=NEW.case_id AND g.revoked_at IS NULL AND aa.audience_id=NEW.audience_id AND aa.revoked_at IS NULL) THEN
   RAISE EXCEPTION 'LS_PRACTICE_ASSIGNEE_INVALID' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS check_coordination_actor_and_assignees ON ls_practice.task_coordination_versions;
CREATE TRIGGER check_coordination_actor_and_assignees BEFORE INSERT ON ls_practice.task_coordination_versions
 FOR EACH ROW EXECUTE FUNCTION ls_practice.check_coordination_actor_and_assignees();

-- A completion author must still be an active guardian, an audience member and an assignee.
CREATE OR REPLACE FUNCTION ls_practice.check_completion_author() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE coordination_id uuid;
DECLARE coordination_assignee_account_ids uuid[];
DECLARE coordination_audience_id uuid;
DECLARE case_identifier uuid;
BEGIN
 SELECT c.id,c.assignee_account_ids,c.audience_id,a.case_id
 INTO coordination_id,coordination_assignee_account_ids,coordination_audience_id,case_identifier
 FROM ls_practice.practice_occurrences o
 JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
 JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id
 WHERE o.workspace_id=NEW.workspace_id AND o.id=NEW.occurrence_id;
 IF coordination_id IS NULL OR NOT (NEW.author_account_id=ANY(coordination_assignee_account_ids)) OR NOT EXISTS(
  SELECT 1 FROM ls_identity.accounts a JOIN ls_cases.case_guardians g
   ON g.workspace_id=a.workspace_id AND g.account_id=a.id JOIN ls_cases.audience_accounts aa
   ON aa.workspace_id=g.workspace_id AND aa.case_id=g.case_id AND aa.account_id=g.account_id
  WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.author_account_id AND a.role='parent' AND a.state='active'
   AND g.case_id=case_identifier AND g.revoked_at IS NULL
   AND aa.audience_id=coordination_audience_id AND aa.revoked_at IS NULL
 ) THEN RAISE EXCEPTION 'LS_PRACTICE_COMPLETION_AUTHOR_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.corrects_report_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM ls_practice.completion_reports previous
  WHERE previous.workspace_id=NEW.workspace_id AND previous.id=NEW.corrects_report_id
   AND previous.occurrence_id=NEW.occurrence_id AND previous.author_account_id=NEW.author_account_id
   AND previous.revision=NEW.revision-1
 ) THEN RAISE EXCEPTION 'LS_PRACTICE_CORRECTION_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS check_completion_author ON ls_practice.completion_reports;
CREATE TRIGGER check_completion_author BEFORE INSERT ON ls_practice.completion_reports
 FOR EACH ROW EXECUTE FUNCTION ls_practice.check_completion_author();

COMMENT ON TABLE ls_practice.practice_assignment_versions IS 'Published instruction snapshots are immutable; revisions are new rows and past occurrences keep their original version.';
COMMENT ON COLUMN ls_practice.task_coordination_versions.reminder_candidate_account_ids IS 'Routing candidates only. Delivery must still recheck each account preference and I-014 authorization.';
COMMENT ON TABLE ls_practice.completion_reports IS 'Append-only parent-authored reports. Absence of a row is unreported, never not_done.';
