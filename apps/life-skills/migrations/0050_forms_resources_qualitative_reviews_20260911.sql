-- LS-050: protected forms, deliberately shared resources and qualitative four-week reviews.
-- Additive only. Requires 0010 identity/cases. Calendar, practice and feedback remain consumer seams.
CREATE SCHEMA IF NOT EXISTS ls_forms;
CREATE SCHEMA IF NOT EXISTS ls_resources;
CREATE SCHEMA IF NOT EXISTS ls_progress;

CREATE TABLE IF NOT EXISTS ls_progress.feature_history (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 actor_account_id uuid NOT NULL, request_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('form_template_created','form_assigned','form_submitted','form_reviewed',
   'resource_created','resource_assigned','resource_completion_reported','contextual_target_created',
   'qualitative_review_drafted','qualitative_review_published')),
 occurred_at timestamptz NOT NULL,
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE TABLE IF NOT EXISTS ls_forms.form_templates (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 template_key text NOT NULL CHECK(template_key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 10000), locale text NOT NULL CHECK(locale IN ('he','en')),
 target_role text NOT NULL CHECK(target_role IN ('parent','adult_client')),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'), active boolean NOT NULL,
 state text NOT NULL CHECK(state IN ('draft','published')), provenance text NOT NULL,
 created_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,template_key,version,locale),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_forms.form_assignments (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, template_id uuid NOT NULL,
 assigned_account_id uuid NOT NULL, due_date date, state text NOT NULL CHECK(state IN ('assigned','submitted','reviewed','withdrawn')),
 post_submission_audience_id uuid, assigned_by_account_id uuid NOT NULL, assigned_at timestamptz NOT NULL,
 submitted_at timestamptz, UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,template_id) REFERENCES ls_forms.form_templates(workspace_id,id),
 FOREIGN KEY(workspace_id,assigned_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,assigned_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,post_submission_audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 CHECK((state='assigned' AND submitted_at IS NULL) OR state<>'assigned')
);
CREATE OR REPLACE FUNCTION ls_forms.protect_published_template() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF OLD.state='published' AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'PUBLISHED_FORM_TEMPLATE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS protect_published_template ON ls_forms.form_templates;
CREATE TRIGGER protect_published_template BEFORE UPDATE ON ls_forms.form_templates FOR EACH ROW EXECUTE FUNCTION ls_forms.protect_published_template();
CREATE INDEX IF NOT EXISTS form_assignments_by_assignee ON ls_forms.form_assignments(workspace_id,assigned_account_id,state,due_date,id);
CREATE TABLE IF NOT EXISTS ls_forms.form_submissions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, assignment_id uuid NOT NULL,
 author_account_id uuid NOT NULL, answers_ciphertext text NOT NULL,
 answers_digest text NOT NULL CHECK(answers_digest ~ '^[0-9a-f]{64}$'), idempotency_key uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('submitted','reviewed')), submitted_at timestamptz NOT NULL,
 reviewed_by_account_id uuid, reviewed_at timestamptz, UNIQUE(workspace_id,id),
 UNIQUE(workspace_id,assignment_id), UNIQUE(workspace_id,assignment_id,idempotency_key),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES ls_forms.form_assignments(workspace_id,id),
 FOREIGN KEY(workspace_id,author_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,reviewed_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((state='reviewed')=(reviewed_by_account_id IS NOT NULL AND reviewed_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION ls_forms.protect_submitted_answers() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.answers_ciphertext IS DISTINCT FROM OLD.answers_ciphertext OR NEW.answers_digest IS DISTINCT FROM OLD.answers_digest
    OR NEW.author_account_id IS DISTINCT FROM OLD.author_account_id OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
  RAISE EXCEPTION 'FORM_SUBMISSION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS protect_submitted_answers ON ls_forms.form_submissions;
CREATE TRIGGER protect_submitted_answers BEFORE UPDATE ON ls_forms.form_submissions FOR EACH ROW EXECUTE FUNCTION ls_forms.protect_submitted_answers();

CREATE TABLE IF NOT EXISTS ls_resources.resources (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 type text NOT NULL CHECK(type IN ('audio','pdf','video','link','text','digital_form')),
 title text NOT NULL, description text NOT NULL, reference_ciphertext text NOT NULL,
 downloadable boolean NOT NULL, locale text NOT NULL CHECK(locale IN ('he','en')),
 owner_account_id uuid NOT NULL, created_at timestamptz NOT NULL, archived_at timestamptz,
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,owner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_resources.resource_assignments (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, resource_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL,
 due_date date, display_date date NOT NULL, completion_enabled boolean NOT NULL,
 assigned_by_account_id uuid NOT NULL, assigned_at timestamptz NOT NULL, withdrawn_at timestamptz,
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,resource_id) REFERENCES ls_resources.resources(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,assigned_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS resources_by_case ON ls_resources.resource_assignments(workspace_id,case_id,display_date,id) WHERE withdrawn_at IS NULL;
CREATE TABLE IF NOT EXISTS ls_resources.resource_completions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, assignment_id uuid NOT NULL,
 completed_by_account_id uuid NOT NULL, idempotency_key uuid NOT NULL, completed_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,assignment_id,completed_by_account_id),
 UNIQUE(workspace_id,assignment_id,completed_by_account_id,idempotency_key),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES ls_resources.resource_assignments(workspace_id,id),
 FOREIGN KEY(workspace_id,completed_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE TABLE IF NOT EXISTS ls_progress.contextual_targets (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL,
 detail_ciphertext text NOT NULL,
 active_from date NOT NULL, active_until date, published boolean NOT NULL,
 created_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL, retired_at timestamptz,
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(active_until IS NULL OR active_until>=active_from)
);
CREATE TABLE IF NOT EXISTS ls_progress.qualitative_reviews (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL,
 period_start date NOT NULL, period_end date NOT NULL,
 attended_session_count integer NOT NULL CHECK(attended_session_count BETWEEN 0 AND 100),
 narrative_ciphertext text NOT NULL, state text NOT NULL CHECK(state IN ('draft','published')),
 created_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL,
 published_by_account_id uuid, published_at timestamptz,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,case_id,period_start),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,published_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(period_end=period_start+28),
 CHECK((state='published')=(published_by_account_id IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS reviews_by_case ON ls_progress.qualitative_reviews(workspace_id,case_id,period_start DESC,id);
CREATE TABLE IF NOT EXISTS ls_progress.review_practice_versions (
 workspace_id uuid NOT NULL, review_id uuid NOT NULL, version_id uuid NOT NULL,
 immutable_snapshot_digest text NOT NULL CHECK(immutable_snapshot_digest ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(workspace_id,review_id,version_id),
 FOREIGN KEY(workspace_id,review_id) REFERENCES ls_progress.qualitative_reviews(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_progress.review_parent_reports (
 workspace_id uuid NOT NULL, review_id uuid NOT NULL, report_id uuid NOT NULL,
 author_account_id uuid NOT NULL, submitted_at timestamptz NOT NULL,
 source_type text NOT NULL CHECK(source_type='parent_report'),
 PRIMARY KEY(workspace_id,review_id,report_id),
 FOREIGN KEY(workspace_id,review_id) REFERENCES ls_progress.qualitative_reviews(workspace_id,id),
 FOREIGN KEY(workspace_id,author_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE OR REPLACE FUNCTION ls_progress.protect_published_review_reference() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE target_review uuid;
BEGIN
 target_review := CASE WHEN TG_OP='DELETE' THEN OLD.review_id ELSE NEW.review_id END;
 IF EXISTS(SELECT 1 FROM ls_progress.qualitative_reviews q
   WHERE q.workspace_id=CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END
     AND q.id=target_review AND q.state='published') THEN
  RAISE EXCEPTION 'PUBLISHED_QUALITATIVE_REVIEW_REFERENCE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS protect_review_practice_reference ON ls_progress.review_practice_versions;
CREATE TRIGGER protect_review_practice_reference BEFORE INSERT OR UPDATE OR DELETE ON ls_progress.review_practice_versions
 FOR EACH ROW EXECUTE FUNCTION ls_progress.protect_published_review_reference();
DROP TRIGGER IF EXISTS protect_review_parent_reference ON ls_progress.review_parent_reports;
CREATE TRIGGER protect_review_parent_reference BEFORE INSERT OR UPDATE OR DELETE ON ls_progress.review_parent_reports
 FOR EACH ROW EXECUTE FUNCTION ls_progress.protect_published_review_reference();

CREATE OR REPLACE FUNCTION ls_progress.protect_published_review() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF OLD.state='published' AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'PUBLISHED_QUALITATIVE_REVIEW_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS protect_published_review ON ls_progress.qualitative_reviews;
CREATE TRIGGER protect_published_review BEFORE UPDATE ON ls_progress.qualitative_reviews FOR EACH ROW EXECUTE FUNCTION ls_progress.protect_published_review();

COMMENT ON COLUMN ls_forms.form_submissions.answers_ciphertext IS 'Protected answers only; no scoring payload.';
COMMENT ON COLUMN ls_progress.qualitative_reviews.attended_session_count IS 'Exact LS-030 consumer value for attended child sessions; never inferred from credits or appointments.';
COMMENT ON TABLE ls_progress.review_parent_reports IS 'Attributed report references supplied by LS-080; reviewed does not mean witnessed or verified.';
