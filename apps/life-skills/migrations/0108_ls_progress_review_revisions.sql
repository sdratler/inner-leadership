-- Additive saved-draft revisions. Published reports and their references retain
-- the original 0050 guards. Existing ciphertext is copied, never decrypted.
ALTER TABLE ls_progress.qualitative_reviews ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE ls_progress.qualitative_reviews ADD CONSTRAINT qualitative_review_revision_range CHECK(revision BETWEEN 1 AND 1000000);

CREATE TABLE ls_progress.qualitative_review_revisions (
 workspace_id uuid NOT NULL, review_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000000),
 narrative_ciphertext text NOT NULL,
 author_account_id uuid NOT NULL, saved_at timestamptz NOT NULL,
 operation_id uuid, request_digest text,
 PRIMARY KEY(workspace_id,review_id,revision),
 UNIQUE(workspace_id,review_id,operation_id),
 FOREIGN KEY(workspace_id,review_id) REFERENCES ls_progress.qualitative_reviews(workspace_id,id),
 FOREIGN KEY(workspace_id,author_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((revision=1 AND operation_id IS NULL AND request_digest IS NULL) OR
   (revision>1 AND operation_id IS NOT NULL AND request_digest IS NOT NULL AND request_digest ~ '^[0-9a-f]{64}$'))
);

-- Historical authors may no longer be active. Preserve their exact attribution
-- before installing the guards for newly written revisions.
INSERT INTO ls_progress.qualitative_review_revisions
 (workspace_id,review_id,revision,narrative_ciphertext,author_account_id,saved_at)
 SELECT workspace_id,id,1,narrative_ciphertext,created_by_account_id,created_at
 FROM ls_progress.qualitative_reviews;

CREATE FUNCTION ls_progress.protect_review_revision_history() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'QUALITATIVE_REVIEW_REVISION_IMMUTABLE' USING ERRCODE='23514';
END;
$fn$;
CREATE TRIGGER protect_review_revision_history BEFORE UPDATE OR DELETE ON ls_progress.qualitative_review_revisions
 FOR EACH ROW EXECUTE FUNCTION ls_progress.protect_review_revision_history();

CREATE FUNCTION ls_progress.check_review_revision_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE head ls_progress.qualitative_reviews%ROWTYPE;
BEGIN
 SELECT * INTO head FROM ls_progress.qualitative_reviews
  WHERE workspace_id=NEW.workspace_id AND id=NEW.review_id FOR UPDATE;
 IF NOT FOUND OR head.state<>'draft' THEN
  RAISE EXCEPTION 'QUALITATIVE_REVIEW_DRAFT_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts a JOIN ls_cases.cases c
   ON c.workspace_id=a.workspace_id AND c.practitioner_account_id=a.id
   JOIN ls_cases.audiences au ON au.workspace_id=c.workspace_id AND au.case_id=c.id
   WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.author_account_id
    AND a.role='practitioner' AND a.state='active' AND c.id=head.case_id
    AND au.id=head.audience_id AND au.published AND au.visibility='family_full') THEN
  RAISE EXCEPTION 'QUALITATIVE_REVIEW_PRACTITIONER_SCOPE_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF NEW.revision=1 THEN
  IF head.revision<>1 OR NEW.narrative_ciphertext IS DISTINCT FROM head.narrative_ciphertext
   OR NEW.author_account_id IS DISTINCT FROM head.created_by_account_id
   OR NEW.saved_at IS DISTINCT FROM head.created_at THEN
   RAISE EXCEPTION 'QUALITATIVE_REVIEW_BASELINE_INVALID' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.revision<>head.revision+1 THEN
  RAISE EXCEPTION 'QUALITATIVE_REVIEW_REVISION_CONFLICT' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER check_review_revision_insert BEFORE INSERT ON ls_progress.qualitative_review_revisions
 FOR EACH ROW EXECUTE FUNCTION ls_progress.check_review_revision_insert();

CREATE FUNCTION ls_progress.record_review_baseline() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.revision<>1 OR NEW.state<>'draft' THEN
  RAISE EXCEPTION 'QUALITATIVE_REVIEW_NEW_DRAFT_REQUIRED' USING ERRCODE='23514';
 END IF;
 INSERT INTO ls_progress.qualitative_review_revisions
  (workspace_id,review_id,revision,narrative_ciphertext,author_account_id,saved_at)
  VALUES(NEW.workspace_id,NEW.id,1,NEW.narrative_ciphertext,NEW.created_by_account_id,NEW.created_at);
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER record_review_baseline AFTER INSERT ON ls_progress.qualitative_reviews
 FOR EACH ROW EXECUTE FUNCTION ls_progress.record_review_baseline();

CREATE FUNCTION ls_progress.check_review_head_revision() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF ROW(NEW.id,NEW.workspace_id,NEW.case_id,NEW.audience_id,NEW.period_start,NEW.period_end,
   NEW.created_by_account_id,NEW.created_at) IS DISTINCT FROM
  ROW(OLD.id,OLD.workspace_id,OLD.case_id,OLD.audience_id,OLD.period_start,OLD.period_end,
   OLD.created_by_account_id,OLD.created_at) THEN
  RAISE EXCEPTION 'QUALITATIVE_REVIEW_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.narrative_ciphertext IS DISTINCT FROM OLD.narrative_ciphertext THEN
  IF OLD.state<>'draft' OR NEW.state<>'draft' OR NEW.revision<>OLD.revision+1
   OR NEW.attended_session_count IS DISTINCT FROM OLD.attended_session_count
   OR NOT EXISTS(SELECT 1 FROM ls_progress.qualitative_review_revisions r
    WHERE r.workspace_id=NEW.workspace_id AND r.review_id=NEW.id AND r.revision=NEW.revision
     AND r.narrative_ciphertext=NEW.narrative_ciphertext) THEN
   RAISE EXCEPTION 'QUALITATIVE_REVIEW_HEAD_REVISION_INVALID' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER check_review_head_revision BEFORE UPDATE ON ls_progress.qualitative_reviews
 FOR EACH ROW EXECUTE FUNCTION ls_progress.check_review_head_revision();

CREATE FUNCTION ls_progress.check_review_revision_committed() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_progress.qualitative_reviews q
  WHERE q.workspace_id=NEW.workspace_id AND q.id=NEW.review_id AND q.revision>=NEW.revision
   AND (q.revision>NEW.revision OR q.narrative_ciphertext=NEW.narrative_ciphertext)) THEN
  RAISE EXCEPTION 'QUALITATIVE_REVIEW_REVISION_NOT_COMMITTED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE CONSTRAINT TRIGGER check_review_revision_committed AFTER INSERT ON ls_progress.qualitative_review_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ls_progress.check_review_revision_committed();

ALTER TABLE ls_progress.feature_history DROP CONSTRAINT feature_history_action_check;
ALTER TABLE ls_progress.feature_history ADD CONSTRAINT feature_history_action_check CHECK(action IN
 ('form_template_created','form_assigned','form_submitted','form_reviewed','resource_created','resource_assigned',
  'resource_completion_reported','contextual_target_created','qualitative_review_drafted',
  'qualitative_review_published','qualitative_review_revised'));
COMMENT ON TABLE ls_progress.qualitative_review_revisions IS 'Practitioner-private immutable encrypted narrative history; never family-visible private observations or automatic publication.';
REVOKE ALL ON ls_progress.qualitative_review_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_progress.protect_review_revision_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_progress.check_review_revision_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_progress.record_review_baseline() FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_progress.check_review_head_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_progress.check_review_revision_committed() FROM PUBLIC;
