-- Forward-only repair of the existing 0040 participant guards after optional
-- subject-bound child accounts (0095). No accounts, grants or records are added.
-- Coordination remains parent-authored. An audience grant alone is insufficient:
-- a client must be the exact case subject with the matching child/adult role.
CREATE OR REPLACE FUNCTION ls_practice.check_coordination_actor_and_assignees()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE candidate uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_practice.practice_assignments a
  WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.assignment_id
   AND a.case_id=NEW.case_id AND a.audience_id=NEW.audience_id AND a.state='published') THEN
  RAISE EXCEPTION 'LS_PRACTICE_COORDINATION_SCOPE_INVALID' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts a JOIN ls_cases.case_guardians g
  ON g.workspace_id=a.workspace_id AND g.account_id=a.id
  JOIN ls_cases.audience_accounts aa ON aa.workspace_id=g.workspace_id
   AND aa.case_id=g.case_id AND aa.account_id=g.account_id
  JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id
   AND au.case_id=aa.case_id AND au.id=aa.audience_id
  WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.changed_by_account_id
   AND a.role='parent' AND a.state='active' AND g.case_id=NEW.case_id
   AND g.revoked_at IS NULL AND aa.audience_id=NEW.audience_id
   AND aa.revoked_at IS NULL AND au.published AND au.visibility<>'private') THEN
  RAISE EXCEPTION 'LS_PRACTICE_PARENT_REQUIRED' USING ERRCODE='23514';
 END IF;
 FOREACH candidate IN ARRAY NEW.assignee_account_ids LOOP
  IF NOT EXISTS(SELECT 1 FROM ls_identity.accounts a
   JOIN ls_cases.audience_accounts aa ON aa.workspace_id=a.workspace_id AND aa.account_id=a.id
   JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id AND au.case_id=aa.case_id AND au.id=aa.audience_id
   JOIN ls_cases.cases c ON c.workspace_id=aa.workspace_id AND c.id=aa.case_id
   JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
   JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
   WHERE a.workspace_id=NEW.workspace_id AND a.id=candidate AND a.state='active'
    AND aa.case_id=NEW.case_id AND aa.audience_id=NEW.audience_id AND aa.revoked_at IS NULL
    AND au.published AND au.visibility<>'private'
    AND ((a.role='parent' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g
      WHERE g.workspace_id=a.workspace_id AND g.case_id=c.id AND g.account_id=a.id AND g.revoked_at IS NULL))
     OR (((a.role='child' AND p.kind='minor') OR (a.role='adult_client' AND p.kind='adult'))
      AND EXISTS(SELECT 1 FROM ls_identity.account_subjects s
       WHERE s.workspace_id=a.workspace_id AND s.account_id=a.id AND s.person_id=cl.person_id)))) THEN
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
BEGIN
 SELECT c.id,c.assignee_account_ids,c.audience_id,a.case_id
 INTO coordination_id,coordination_assignee_account_ids,coordination_audience_id,case_identifier
 FROM ls_practice.practice_occurrences o
 JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
 JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id
  AND c.id=o.coordination_version_id AND c.assignment_id=o.assignment_id
  AND c.case_id=a.case_id AND c.audience_id=a.audience_id
 WHERE o.workspace_id=NEW.workspace_id AND o.id=NEW.occurrence_id;
 IF coordination_id IS NULL OR NOT (NEW.author_account_id=ANY(coordination_assignee_account_ids)) OR NOT EXISTS(
  SELECT 1 FROM ls_identity.accounts a
  JOIN ls_cases.audience_accounts aa ON aa.workspace_id=a.workspace_id AND aa.account_id=a.id
  JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id AND au.case_id=aa.case_id AND au.id=aa.audience_id
  JOIN ls_cases.cases c ON c.workspace_id=aa.workspace_id AND c.id=aa.case_id
  JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
  JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
  WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.author_account_id AND a.state='active'
   AND aa.case_id=case_identifier AND aa.audience_id=coordination_audience_id AND aa.revoked_at IS NULL
   AND au.published AND au.visibility<>'private'
   AND ((a.role='parent' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g
     WHERE g.workspace_id=a.workspace_id AND g.case_id=c.id AND g.account_id=a.id AND g.revoked_at IS NULL))
    OR (((a.role='child' AND p.kind='minor') OR (a.role='adult_client' AND p.kind='adult'))
     AND EXISTS(SELECT 1 FROM ls_identity.account_subjects s
      WHERE s.workspace_id=a.workspace_id AND s.account_id=a.id AND s.person_id=cl.person_id)))
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

-- Existing triggers, foreign keys, immutable snapshots and append-only history
-- remain installed. No historical assignees or reports are rewritten.
COMMENT ON TABLE ls_practice.completion_reports IS
 'Append-only assigned guardian or exact case-subject reports. Absence is unreported, never not_done. Current authorization and frozen occurrence responsibility are required.';
