-- LS-080: attributed contextual parent reports and practitioner response/adaptation receipts.
-- Requires accepted LS-010 and integrated LS-040. Apply only through the checksum ledger.
-- No client records, credentials, provider activation, publication, ratings, grades or clinical conclusions.
CREATE SCHEMA IF NOT EXISTS ls_updates;

CREATE TABLE IF NOT EXISTS ls_updates.parent_reports (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 case_id uuid NOT NULL,
 audience_id uuid NOT NULL,
 author_account_id uuid NOT NULL,
 body_ciphertext text NOT NULL,
 body_digest text NOT NULL CHECK(body_digest ~ '^[0-9a-f]{64}$'),
 event_at timestamptz,
 submitted_at timestamptz NOT NULL,
 review_state text NOT NULL CHECK(review_state IN ('new','reviewed','replied','adapted')),
 reviewed_by_account_id uuid,
 reviewed_at timestamptz,
 practice_assignment_id uuid NOT NULL,
 practice_version_id uuid NOT NULL,
 practice_published_at timestamptz NOT NULL,
 practice_snapshot_digest text NOT NULL CHECK(practice_snapshot_digest ~ '^[0-9a-f]{64}$'),
 idempotency_key uuid NOT NULL,
 UNIQUE(workspace_id,id),
 UNIQUE(workspace_id,author_account_id,idempotency_key),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,author_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,practice_assignment_id) REFERENCES ls_practice.practice_assignments(workspace_id,id),
 FOREIGN KEY(workspace_id,practice_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,reviewed_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((review_state='new' AND reviewed_by_account_id IS NULL AND reviewed_at IS NULL)
    OR (review_state<>'new' AND reviewed_by_account_id IS NOT NULL AND reviewed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ls_updates.practitioner_replies (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 report_id uuid NOT NULL,
 case_id uuid NOT NULL,
 audience_id uuid NOT NULL,
 author_account_id uuid NOT NULL,
 body_ciphertext text NOT NULL,
 body_digest text NOT NULL CHECK(body_digest ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('draft','published')),
 created_at timestamptz NOT NULL,
 published_at timestamptz,
 supersedes_reply_id uuid,
 idempotency_key uuid NOT NULL,
 UNIQUE(workspace_id,id),
 UNIQUE(workspace_id,author_account_id,idempotency_key),
 FOREIGN KEY(workspace_id,report_id) REFERENCES ls_updates.parent_reports(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,author_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,supersedes_reply_id) REFERENCES ls_updates.practitioner_replies(workspace_id,id),
 CHECK((state='draft' AND published_at IS NULL) OR (state='published' AND published_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ls_updates.adaptation_receipts (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 report_id uuid NOT NULL,
 assignment_id uuid NOT NULL,
 previous_version_id uuid NOT NULL,
 new_version_id uuid NOT NULL,
 state text NOT NULL CHECK(state='draft'),
 created_by_account_id uuid NOT NULL,
 created_at timestamptz NOT NULL,
 idempotency_key uuid NOT NULL,
 UNIQUE(workspace_id,id),
 UNIQUE(workspace_id,report_id,idempotency_key),
 UNIQUE(workspace_id,new_version_id),
 FOREIGN KEY(workspace_id,report_id) REFERENCES ls_updates.parent_reports(workspace_id,id),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES ls_practice.practice_assignments(workspace_id,id),
 FOREIGN KEY(workspace_id,previous_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,new_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(previous_version_id<>new_version_id)
);

CREATE TABLE IF NOT EXISTS ls_updates.feature_history (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 request_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN (
  'parent_report_submitted','parent_report_reviewed','practitioner_reply_drafted',
  'practitioner_reply_published','practice_adaptation_drafted'
 )),
 occurred_at timestamptz NOT NULL,
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE INDEX IF NOT EXISTS parent_reports_by_audience
 ON ls_updates.parent_reports(workspace_id,case_id,audience_id,submitted_at DESC,id);
CREATE INDEX IF NOT EXISTS update_replies_by_report
 ON ls_updates.practitioner_replies(workspace_id,report_id,created_at,id);

CREATE OR REPLACE FUNCTION ls_updates.check_parent_report() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts a
   JOIN ls_cases.case_guardians g ON g.workspace_id=a.workspace_id AND g.account_id=a.id
   JOIN ls_cases.audience_accounts aa ON aa.workspace_id=g.workspace_id AND aa.case_id=g.case_id AND aa.account_id=g.account_id
   JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id AND au.case_id=aa.case_id AND au.id=aa.audience_id
   WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.author_account_id AND a.role='parent' AND a.state='active'
     AND g.case_id=NEW.case_id AND g.revoked_at IS NULL AND aa.audience_id=NEW.audience_id AND aa.revoked_at IS NULL
     AND au.published=true AND au.visibility='family_full') THEN
  RAISE EXCEPTION 'LS_UPDATES_PARENT_AUDIENCE_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ls_practice.practice_assignments pa
   JOIN ls_practice.practice_assignment_versions pv ON pv.workspace_id=pa.workspace_id AND pv.assignment_id=pa.id
   WHERE pa.workspace_id=NEW.workspace_id AND pa.case_id=NEW.case_id AND pa.audience_id=NEW.audience_id
     AND pa.id=NEW.practice_assignment_id AND pv.id=NEW.practice_version_id AND pv.state='published'
     AND pv.published_at=NEW.practice_published_at AND pv.immutable_snapshot_digest=NEW.practice_snapshot_digest) THEN
  RAISE EXCEPTION 'LS_UPDATES_PUBLISHED_VERSION_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION ls_updates.protect_parent_report() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LS_UPDATES_IMMUTABLE_REPORT' USING ERRCODE='55000'; END IF;
 IF ROW(NEW.workspace_id,NEW.case_id,NEW.audience_id,NEW.author_account_id,NEW.body_ciphertext,NEW.body_digest,
        NEW.event_at,NEW.submitted_at,NEW.practice_assignment_id,NEW.practice_version_id,NEW.practice_published_at,
        NEW.practice_snapshot_digest,NEW.idempotency_key)
    IS DISTINCT FROM
    ROW(OLD.workspace_id,OLD.case_id,OLD.audience_id,OLD.author_account_id,OLD.body_ciphertext,OLD.body_digest,
        OLD.event_at,OLD.submitted_at,OLD.practice_assignment_id,OLD.practice_version_id,OLD.practice_published_at,
        OLD.practice_snapshot_digest,OLD.idempotency_key) THEN
  RAISE EXCEPTION 'LS_UPDATES_IMMUTABLE_REPORT' USING ERRCODE='55000';
 END IF;
 IF OLD.review_state='adapted' AND NEW.review_state<>'adapted'
    OR OLD.review_state='replied' AND NEW.review_state NOT IN ('replied','adapted')
    OR OLD.review_state='reviewed' AND NEW.review_state NOT IN ('reviewed','replied','adapted')
    OR OLD.reviewed_by_account_id IS NOT NULL AND ROW(NEW.reviewed_by_account_id,NEW.reviewed_at) IS DISTINCT FROM ROW(OLD.reviewed_by_account_id,OLD.reviewed_at) THEN
  RAISE EXCEPTION 'LS_UPDATES_REVIEW_HISTORY_REQUIRED' USING ERRCODE='55000';
 END IF;
 IF NEW.review_state<>'new' AND NOT EXISTS(SELECT 1 FROM ls_cases.cases c JOIN ls_identity.accounts a
   ON a.workspace_id=c.workspace_id AND a.id=NEW.reviewed_by_account_id
   WHERE c.workspace_id=NEW.workspace_id AND c.id=NEW.case_id AND c.practitioner_account_id=NEW.reviewed_by_account_id
     AND a.role='practitioner' AND a.state='active') THEN
  RAISE EXCEPTION 'LS_UPDATES_PRACTITIONER_REVIEW_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION ls_updates.check_practitioner_reply() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_updates.parent_reports r JOIN ls_cases.cases c
   ON c.workspace_id=r.workspace_id AND c.id=r.case_id JOIN ls_identity.accounts a
   ON a.workspace_id=c.workspace_id AND a.id=c.practitioner_account_id
   WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.report_id AND r.case_id=NEW.case_id AND r.audience_id=NEW.audience_id
     AND c.practitioner_account_id=NEW.author_account_id AND a.role='practitioner' AND a.state='active') THEN
  RAISE EXCEPTION 'LS_UPDATES_PRACTITIONER_REPLY_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF NEW.supersedes_reply_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ls_updates.practitioner_replies p
   WHERE p.workspace_id=NEW.workspace_id AND p.id=NEW.supersedes_reply_id AND p.report_id=NEW.report_id AND p.state='published') THEN
  RAISE EXCEPTION 'LS_UPDATES_VALID_SUPERSEDED_REPLY_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION ls_updates.protect_reply() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF TG_OP='DELETE' OR OLD.state='published' THEN RAISE EXCEPTION 'LS_UPDATES_IMMUTABLE_REPLY' USING ERRCODE='55000'; END IF;
 IF ROW(NEW.workspace_id,NEW.report_id,NEW.case_id,NEW.audience_id,NEW.author_account_id,NEW.body_ciphertext,NEW.body_digest,
        NEW.created_at,NEW.supersedes_reply_id,NEW.idempotency_key)
    IS DISTINCT FROM
    ROW(OLD.workspace_id,OLD.report_id,OLD.case_id,OLD.audience_id,OLD.author_account_id,OLD.body_ciphertext,OLD.body_digest,
        OLD.created_at,OLD.supersedes_reply_id,OLD.idempotency_key)
    OR NEW.state<>'published' OR NEW.published_at IS NULL THEN
  RAISE EXCEPTION 'LS_UPDATES_INVALID_REPLY_TRANSITION' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION ls_updates.check_adaptation_receipt() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_updates.parent_reports r
   JOIN ls_cases.cases c ON c.workspace_id=r.workspace_id AND c.id=r.case_id
   JOIN ls_practice.practice_assignment_versions oldv ON oldv.workspace_id=r.workspace_id AND oldv.id=r.practice_version_id
   JOIN ls_practice.practice_assignment_versions newv ON newv.workspace_id=r.workspace_id AND newv.id=NEW.new_version_id
   WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.report_id AND r.review_state<>'new'
     AND r.practice_assignment_id=NEW.assignment_id AND r.practice_version_id=NEW.previous_version_id
     AND oldv.assignment_id=NEW.assignment_id AND newv.assignment_id=NEW.assignment_id AND newv.state='draft'
     AND c.practitioner_account_id=NEW.created_by_account_id) THEN
  RAISE EXCEPTION 'LS_UPDATES_VALID_ADAPTATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS validate_parent_report ON ls_updates.parent_reports;
CREATE TRIGGER validate_parent_report BEFORE INSERT ON ls_updates.parent_reports
 FOR EACH ROW EXECUTE FUNCTION ls_updates.check_parent_report();
DROP TRIGGER IF EXISTS protect_parent_report ON ls_updates.parent_reports;
CREATE TRIGGER protect_parent_report BEFORE UPDATE OR DELETE ON ls_updates.parent_reports
 FOR EACH ROW EXECUTE FUNCTION ls_updates.protect_parent_report();
DROP TRIGGER IF EXISTS validate_practitioner_reply ON ls_updates.practitioner_replies;
CREATE TRIGGER validate_practitioner_reply BEFORE INSERT ON ls_updates.practitioner_replies
 FOR EACH ROW EXECUTE FUNCTION ls_updates.check_practitioner_reply();
DROP TRIGGER IF EXISTS protect_practitioner_reply ON ls_updates.practitioner_replies;
CREATE TRIGGER protect_practitioner_reply BEFORE UPDATE OR DELETE ON ls_updates.practitioner_replies
 FOR EACH ROW EXECUTE FUNCTION ls_updates.protect_reply();
DROP TRIGGER IF EXISTS validate_adaptation_receipt ON ls_updates.adaptation_receipts;
CREATE TRIGGER validate_adaptation_receipt BEFORE INSERT ON ls_updates.adaptation_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_updates.check_adaptation_receipt();
DROP TRIGGER IF EXISTS protect_adaptation_receipt ON ls_updates.adaptation_receipts;
CREATE TRIGGER protect_adaptation_receipt BEFORE UPDATE OR DELETE ON ls_updates.adaptation_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_practice.protect_immutable_row();

COMMENT ON TABLE ls_updates.parent_reports IS 'Attributed contextual parent reports. Review records reading only; it is not witnessing or clinical verification.';
COMMENT ON TABLE ls_updates.adaptation_receipts IS 'Receipt for a new LS-040 draft only. Publication remains a separate practitioner action.';
