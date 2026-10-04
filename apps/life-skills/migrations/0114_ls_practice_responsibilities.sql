-- Existing practice/version/occurrence/report records remain the single engine.
-- Forward metadata only; no historical input, attribution or clock is invented.
ALTER TABLE ls_practice.practice_assignment_versions ADD COLUMN responsibility jsonb;
ALTER TABLE ls_practice.practice_assignment_versions ADD CONSTRAINT responsibility_bounded
 CHECK(responsibility IS NULL OR (jsonb_typeof(responsibility)='object' AND octet_length(responsibility::text)<=12000));
ALTER TABLE ls_practice.task_coordination_versions
 ADD COLUMN responsibility_version_id uuid,
 ADD COLUMN participant text,
 ADD COLUMN assisted_parent_account_ids uuid[];
ALTER TABLE ls_practice.task_coordination_versions ADD CONSTRAINT coordination_responsibility_version_fk
 FOREIGN KEY(workspace_id,responsibility_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id);
ALTER TABLE ls_practice.task_coordination_versions ADD CONSTRAINT coordination_responsibility_frame
 CHECK((responsibility_version_id IS NULL AND participant IS NULL AND assisted_parent_account_ids IS NULL)
 OR (responsibility_version_id IS NOT NULL AND participant IS NOT NULL AND participant IN ('client','parent') AND assisted_parent_account_ids IS NOT NULL
   AND cardinality(assisted_parent_account_ids)<=2 AND ls_practice.uuid_array_is_unique(assisted_parent_account_ids)
   AND NOT (assignee_account_ids && assisted_parent_account_ids)
   AND (participant='client' OR cardinality(assisted_parent_account_ids)=0)));
-- Keep the legacy one/two-assignee fence exactly for rows without a new frame.
ALTER TABLE ls_practice.task_coordination_versions DROP CONSTRAINT task_coordination_versions_assignee_account_ids_check;
ALTER TABLE ls_practice.task_coordination_versions ADD CONSTRAINT coordination_responsibility_actors
 CHECK((responsibility_version_id IS NULL AND cardinality(assignee_account_ids) BETWEEN 1 AND 2)
 OR (responsibility_version_id IS NOT NULL AND ((participant='parent' AND cardinality(assignee_account_ids) BETWEEN 1 AND 2)
  OR (participant='client' AND cardinality(assignee_account_ids)<=1
   AND cardinality(assignee_account_ids)+cardinality(assisted_parent_account_ids)>0))));
-- A reminder recipient never receives reporting permission merely by routing.
ALTER TABLE ls_practice.task_coordination_versions DROP CONSTRAINT task_coordination_versions_check;
ALTER TABLE ls_practice.task_coordination_versions ADD CONSTRAINT coordination_responsibility_reminders
 CHECK((responsibility_version_id IS NULL AND reminder_candidate_account_ids <@ assignee_account_ids)
 OR (responsibility_version_id IS NOT NULL AND cardinality(reminder_candidate_account_ids)<=3));
ALTER TABLE ls_practice.practice_occurrences
 ADD COLUMN occurs_at timestamptz,
 ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN superseded_by_version_id uuid;
ALTER TABLE ls_practice.practice_occurrences DROP CONSTRAINT practice_occurrences_state_check;
ALTER TABLE ls_practice.practice_occurrences DROP CONSTRAINT practice_occurrences_check;
-- PostgreSQL truncates this generated multi-column name. Match the one EXACT
-- retained logical definition, not a guessed name or an IF EXISTS waiver.
DO $replace_slot$
DECLARE names text[];
BEGIN
 SELECT array_agg(conname::text) INTO names FROM pg_constraint
 WHERE conrelid='ls_practice.practice_occurrences'::regclass AND contype='u'
  AND pg_get_constraintdef(oid)='UNIQUE (workspace_id, assignment_id, occurs_on, period)';
 IF coalesce(cardinality(names),0)<>1 THEN RAISE EXCEPTION 'LS_PRACTICE_SLOT_CONSTRAINT_NOT_EXACT'; END IF;
 EXECUTE format('ALTER TABLE ls_practice.practice_occurrences DROP CONSTRAINT %I',names[1]);
END;
$replace_slot$;
ALTER TABLE ls_practice.practice_occurrences ADD CONSTRAINT occurrence_responsibility_state
 CHECK(state IN ('open','closed','cancelled') AND
 ((state='open' AND closed_at IS NULL AND cancelled_at IS NULL AND superseded_by_version_id IS NULL)
 OR (state='closed' AND closed_at IS NOT NULL AND cancelled_at IS NULL AND superseded_by_version_id IS NULL)
 OR (state='cancelled' AND closed_at IS NULL AND occurs_at IS NOT NULL AND cancelled_at IS NOT NULL
  AND superseded_by_version_id IS NOT NULL AND occurs_at>cancelled_at)));
ALTER TABLE ls_practice.practice_occurrences ADD CONSTRAINT occurrence_superseding_version_fk
 FOREIGN KEY(workspace_id,superseded_by_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id);
CREATE UNIQUE INDEX occurrence_current_calendar_slot ON ls_practice.practice_occurrences(workspace_id,assignment_id,occurs_on,period)
 WHERE state<>'cancelled';
ALTER TABLE ls_practice.practice_occurrences ADD CONSTRAINT occurrence_responsibility_time
 CHECK(occurs_at IS NULL OR isfinite(occurs_at));
ALTER TABLE ls_practice.completion_reports
 ADD COLUMN subject_person_id uuid,
 ADD COLUMN authorship text,
 ADD COLUMN note_ciphertext text;
ALTER TABLE ls_practice.completion_reports ADD CONSTRAINT completion_subject_fk
 FOREIGN KEY(workspace_id,subject_person_id) REFERENCES ls_identity.people(workspace_id,id);
ALTER TABLE ls_practice.completion_reports ADD CONSTRAINT completion_responsibility_attribution
 CHECK((subject_person_id IS NULL AND authorship IS NULL AND note_ciphertext IS NULL)
 OR (subject_person_id IS NOT NULL AND authorship IS NOT NULL AND authorship IN ('self','parent_assisted_child','parent_reporting_child')
 AND note_ciphertext IS NOT NULL AND octet_length(note_ciphertext)<=20000));

-- Source and coordination must describe the SAME frozen assignment version.
-- Updates may close a result or cancel an unreported future occurrence, but may
-- never move its source, actors, date or clock after reports have been attached.
CREATE FUNCTION ls_practice.check_responsibility_occurrence()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE r jsonb;
DECLARE coordination_source uuid;
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-ARRAY['state','closed_at','cancelled_at','superseded_by_version_id'])
  IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','closed_at','cancelled_at','superseded_by_version_id']) THEN
  RAISE EXCEPTION 'LS_PRACTICE_OCCURRENCE_FROZEN' USING ERRCODE='23514';
 END IF;
 SELECT v.responsibility,c.responsibility_version_id INTO r,coordination_source
 FROM ls_practice.practice_assignments a
 JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=a.workspace_id AND v.assignment_id=a.id AND v.id=NEW.practice_version_id
 JOIN ls_practice.task_coordination_versions c ON c.workspace_id=a.workspace_id AND c.assignment_id=a.id
  AND c.case_id=a.case_id AND c.audience_id=a.audience_id AND c.id=NEW.coordination_version_id
 WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.assignment_id AND v.state='published';
 IF NOT FOUND OR (r IS NULL AND (coordination_source IS NOT NULL OR NEW.occurs_at IS NOT NULL))
  OR (r IS NOT NULL AND (coordination_source IS DISTINCT FROM NEW.practice_version_id OR NEW.occurs_at IS NULL
   OR NEW.period IS DISTINCT FROM r->>'period'
   OR (NEW.occurs_at AT TIME ZONE (r->>'timezone'))::date IS DISTINCT FROM NEW.occurs_on
   OR to_char(NEW.occurs_at AT TIME ZONE (r->>'timezone'),'HH24:MI') IS DISTINCT FROM r->>'localTime')) THEN
  RAISE EXCEPTION 'LS_PRACTICE_OCCURRENCE_SOURCE_INVALID' USING ERRCODE='23514';
 END IF;
 IF NEW.state='cancelled' AND (TG_OP<>'UPDATE' OR OLD.state<>'open' OR NEW.occurs_at<=clock_timestamp()
  OR NEW.cancelled_at>clock_timestamp() OR EXISTS(SELECT 1 FROM ls_practice.completion_reports report
   WHERE report.workspace_id=NEW.workspace_id AND report.occurrence_id=NEW.id)
  OR NOT EXISTS(SELECT 1 FROM ls_practice.practice_assignment_versions v JOIN ls_practice.practice_assignments a
   ON a.workspace_id=v.workspace_id AND a.id=v.assignment_id WHERE v.workspace_id=NEW.workspace_id
    AND v.assignment_id=NEW.assignment_id AND v.id=NEW.superseded_by_version_id AND v.id<>NEW.practice_version_id
    AND v.state='published' AND a.active_version_id=v.id)) THEN
  RAISE EXCEPTION 'LS_PRACTICE_OCCURRENCE_CANCELLATION_INVALID' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.state='cancelled' THEN
  RAISE EXCEPTION 'LS_PRACTICE_OCCURRENCE_FROZEN' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER check_responsibility_occurrence BEFORE INSERT OR UPDATE ON ls_practice.practice_occurrences
 FOR EACH ROW EXECUTE FUNCTION ls_practice.check_responsibility_occurrence();

CREATE OR REPLACE FUNCTION ls_practice.check_coordination_actor_and_assignees()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE candidate uuid;
DECLARE r jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_practice.practice_assignments a
  WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.assignment_id
   AND a.case_id=NEW.case_id AND a.audience_id=NEW.audience_id AND a.state='published') THEN
  RAISE EXCEPTION 'LS_PRACTICE_COORDINATION_SCOPE_INVALID' USING ERRCODE='23514';
 END IF;
 IF NEW.responsibility_version_id IS NOT NULL THEN
  SELECT v.responsibility INTO r FROM ls_practice.practice_assignment_versions v
   JOIN ls_practice.practice_assignments a ON a.workspace_id=v.workspace_id AND a.id=v.assignment_id
   WHERE v.workspace_id=NEW.workspace_id AND v.id=NEW.responsibility_version_id
   AND v.assignment_id=NEW.assignment_id AND v.state='published' AND a.active_version_id=v.id;
  IF r IS NULL OR NEW.participant IS DISTINCT FROM r->>'participant' OR NOT EXISTS(SELECT 1 FROM ls_identity.accounts ac
   JOIN ls_cases.cases c ON c.workspace_id=ac.workspace_id AND c.id=NEW.case_id
   JOIN ls_cases.audiences au ON au.workspace_id=c.workspace_id AND au.case_id=c.id AND au.id=NEW.audience_id
   WHERE ac.workspace_id=NEW.workspace_id AND ac.id=NEW.changed_by_account_id AND ac.state='active'
    AND au.published AND au.visibility<>'private'
    AND ((ac.role='practitioner' AND c.practitioner_account_id=ac.id)
     OR (ac.role='parent' AND NEW.participant='parent' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g
      JOIN ls_cases.audience_accounts aa ON aa.workspace_id=g.workspace_id AND aa.case_id=g.case_id AND aa.account_id=g.account_id
      WHERE g.workspace_id=c.workspace_id AND g.case_id=c.id AND g.account_id=ac.id AND g.revoked_at IS NULL
       AND aa.audience_id=au.id AND aa.revoked_at IS NULL))
     OR (ac.role='adult_client' AND NEW.participant='client' AND NEW.assignee_account_ids=ARRAY[ac.id]::uuid[]
      AND cardinality(NEW.assisted_parent_account_ids)=0 AND NEW.reminder_candidate_account_ids <@ ARRAY[ac.id]::uuid[]
      AND EXISTS(SELECT 1 FROM ls_identity.account_subjects s JOIN ls_cases.clients cl ON cl.workspace_id=s.workspace_id AND cl.person_id=s.person_id
       JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
       JOIN ls_cases.audience_accounts aa ON aa.workspace_id=ac.workspace_id AND aa.account_id=ac.id
       WHERE s.workspace_id=ac.workspace_id AND s.account_id=ac.id AND cl.id=c.client_id AND p.kind='adult'
        AND aa.case_id=c.id AND aa.audience_id=au.id AND aa.revoked_at IS NULL)))) THEN
   RAISE EXCEPTION 'LS_PRACTICE_RESPONSIBILITY_ACTOR_INVALID' USING ERRCODE='23514';
  END IF;
 ELSE
  -- The retained 0111 legacy actor boundary still applies to every old frame.
  IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts a JOIN ls_cases.case_guardians g
   ON g.workspace_id=a.workspace_id AND g.account_id=a.id
   JOIN ls_cases.audience_accounts aa ON aa.workspace_id=g.workspace_id AND aa.case_id=g.case_id AND aa.account_id=g.account_id
   JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id AND au.case_id=aa.case_id AND au.id=aa.audience_id
   WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.changed_by_account_id AND a.role='parent' AND a.state='active'
    AND g.case_id=NEW.case_id AND g.revoked_at IS NULL AND aa.audience_id=NEW.audience_id AND aa.revoked_at IS NULL AND au.published AND au.visibility<>'private')
  AND NOT EXISTS(SELECT 1 FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
   JOIN ls_cases.cases c ON c.workspace_id=s.workspace_id AND c.id=NEW.case_id
   JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id AND cl.person_id=s.person_id
   JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
   JOIN ls_cases.audience_accounts aa ON aa.workspace_id=a.workspace_id AND aa.account_id=a.id AND aa.case_id=c.id
   JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id AND au.case_id=aa.case_id AND au.id=aa.audience_id
   WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.changed_by_account_id AND a.role='adult_client' AND a.state='active' AND p.kind='adult'
    AND aa.audience_id=NEW.audience_id AND aa.revoked_at IS NULL AND au.published AND au.visibility<>'private'
    AND NEW.assignee_account_ids=ARRAY[a.id]::uuid[] AND NEW.completion_mode='any_assignee' AND NEW.reminder_candidate_account_ids <@ ARRAY[a.id]::uuid[]) THEN
   RAISE EXCEPTION 'LS_PRACTICE_COORDINATION_ACTOR_INVALID' USING ERRCODE='23514';
  END IF;
 END IF;
 FOREACH candidate IN ARRAY (NEW.assignee_account_ids || coalesce(NEW.assisted_parent_account_ids,ARRAY[]::uuid[]) || NEW.reminder_candidate_account_ids) LOOP
  IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts ac
   JOIN ls_cases.audience_accounts aa ON aa.workspace_id=ac.workspace_id AND aa.account_id=ac.id
   JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id AND au.case_id=aa.case_id AND au.id=aa.audience_id
   JOIN ls_cases.cases c ON c.workspace_id=aa.workspace_id AND c.id=aa.case_id
   JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
   JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
   WHERE ac.workspace_id=NEW.workspace_id AND ac.id=candidate AND ac.state='active' AND aa.case_id=NEW.case_id
    AND aa.audience_id=NEW.audience_id AND aa.revoked_at IS NULL AND au.published AND au.visibility<>'private'
    AND ((ac.role='parent' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g WHERE g.workspace_id=ac.workspace_id AND g.case_id=c.id AND g.account_id=ac.id AND g.revoked_at IS NULL)
      AND (NEW.responsibility_version_id IS NULL OR NOT (candidate=ANY(NEW.assignee_account_ids)) OR NEW.participant='parent'))
     OR (((ac.role='child' AND p.kind='minor') OR (ac.role='adult_client' AND p.kind='adult'))
      AND (NEW.responsibility_version_id IS NULL OR (NEW.participant='client' AND NOT (candidate=ANY(NEW.assisted_parent_account_ids))))
      AND EXISTS(SELECT 1 FROM ls_identity.account_subjects s WHERE s.workspace_id=ac.workspace_id AND s.account_id=ac.id AND s.person_id=cl.person_id)))) THEN
   RAISE EXCEPTION 'LS_PRACTICE_ASSIGNEE_INVALID' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION ls_practice.check_completion_author()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE coordination_id uuid;
DECLARE coordination_assignee_account_ids uuid[];
DECLARE coordination_audience_id uuid;
DECLARE case_identifier uuid;
DECLARE responsibility_version uuid;
DECLARE assisted_parents uuid[];
DECLARE participant_kind text;
DECLARE subject_person uuid;
BEGIN
 SELECT c.id,c.assignee_account_ids,c.audience_id,a.case_id,c.responsibility_version_id,c.assisted_parent_account_ids,c.participant,cl.person_id
 INTO coordination_id,coordination_assignee_account_ids,coordination_audience_id,case_identifier,responsibility_version,assisted_parents,participant_kind,subject_person
 FROM ls_practice.practice_occurrences o JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
 JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id AND c.assignment_id=o.assignment_id AND c.case_id=a.case_id AND c.audience_id=a.audience_id
 JOIN ls_cases.cases ca ON ca.workspace_id=a.workspace_id AND ca.id=a.case_id
 JOIN ls_cases.clients cl ON cl.workspace_id=ca.workspace_id AND cl.id=ca.client_id
 WHERE o.workspace_id=NEW.workspace_id AND o.id=NEW.occurrence_id AND o.state<>'cancelled'
  AND (c.responsibility_version_id IS NULL OR c.responsibility_version_id=o.practice_version_id);
 IF coordination_id IS NULL OR (responsibility_version IS NULL AND (NEW.authorship IS NOT NULL OR NEW.subject_person_id IS NOT NULL OR NEW.note_ciphertext IS NOT NULL))
  OR (responsibility_version IS NOT NULL AND (NEW.subject_person_id IS DISTINCT FROM subject_person OR NEW.authorship IS NULL)) THEN
  RAISE EXCEPTION 'LS_PRACTICE_COMPLETION_ATTRIBUTION_INVALID' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts ac
  JOIN ls_cases.audience_accounts aa ON aa.workspace_id=ac.workspace_id AND aa.account_id=ac.id
  JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id AND au.case_id=aa.case_id AND au.id=aa.audience_id
  JOIN ls_cases.cases ca ON ca.workspace_id=aa.workspace_id AND ca.id=aa.case_id
  JOIN ls_cases.clients cl ON cl.workspace_id=ca.workspace_id AND cl.id=ca.client_id
  JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
  WHERE ac.workspace_id=NEW.workspace_id AND ac.id=NEW.author_account_id AND ac.state='active'
   AND aa.case_id=case_identifier AND aa.audience_id=coordination_audience_id AND aa.revoked_at IS NULL AND au.published AND au.visibility<>'private'
   AND ((ac.role='parent' AND p.kind='minor' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g WHERE g.workspace_id=ac.workspace_id AND g.case_id=ca.id AND g.account_id=ac.id AND g.revoked_at IS NULL)
    AND ((NEW.author_account_id=ANY(coordination_assignee_account_ids) AND (responsibility_version IS NULL OR (participant_kind='parent' AND NEW.authorship='self')))
     OR (responsibility_version IS NOT NULL AND participant_kind='client' AND NEW.authorship IN ('parent_assisted_child','parent_reporting_child') AND NEW.author_account_id=ANY(assisted_parents))))
    OR (((ac.role='child' AND p.kind='minor') OR (ac.role='adult_client' AND p.kind='adult'))
     AND NEW.author_account_id=ANY(coordination_assignee_account_ids) AND (responsibility_version IS NULL OR (participant_kind='client' AND NEW.authorship='self'))
     AND EXISTS(SELECT 1 FROM ls_identity.account_subjects s WHERE s.workspace_id=ac.workspace_id AND s.account_id=ac.id AND s.person_id=cl.person_id)))) THEN
  RAISE EXCEPTION 'LS_PRACTICE_COMPLETION_AUTHOR_INVALID' USING ERRCODE='23514';
 END IF;
 IF NEW.corrects_report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ls_practice.completion_reports previous
  WHERE previous.workspace_id=NEW.workspace_id AND previous.id=NEW.corrects_report_id AND previous.occurrence_id=NEW.occurrence_id
   AND previous.author_account_id=NEW.author_account_id AND previous.revision=NEW.revision-1) THEN
  RAISE EXCEPTION 'LS_PRACTICE_CORRECTION_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;

COMMENT ON COLUMN ls_practice.practice_assignment_versions.responsibility IS
 'Versioned authorized participant, clock, weekdays and routing metadata. Instructions stay encrypted. NULL is historical unspecified, not an inferred default.';
COMMENT ON COLUMN ls_practice.completion_reports.note_ciphertext IS
 'Optional practice feedback sealed to workspace/case/source version/occurrence/report/real actor; not a clinical note or impersonated child report.';
