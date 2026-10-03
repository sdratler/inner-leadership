-- Forward-only ordinary adult self-coordination. 0040/0107 remain immutable.
-- Replace only the coordination actor guard; no rows, tables, grants, services,
-- client invitations or historical snapshots are created or rewritten.
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
   AND aa.revoked_at IS NULL AND au.published AND au.visibility<>'private')
 AND NOT EXISTS(SELECT 1 FROM ls_identity.accounts a
  JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
  JOIN ls_cases.cases c ON c.workspace_id=s.workspace_id AND c.id=NEW.case_id
  JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id AND cl.person_id=s.person_id
  JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
  JOIN ls_cases.audience_accounts aa ON aa.workspace_id=a.workspace_id AND aa.account_id=a.id AND aa.case_id=c.id
  JOIN ls_cases.audiences au ON au.workspace_id=aa.workspace_id AND au.case_id=aa.case_id AND au.id=aa.audience_id
  WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.changed_by_account_id
   AND a.role='adult_client' AND a.state='active' AND p.kind='adult'
   AND aa.audience_id=NEW.audience_id AND aa.revoked_at IS NULL AND au.published AND au.visibility<>'private'
   AND NEW.assignee_account_ids=ARRAY[a.id]::uuid[] AND NEW.completion_mode='any_assignee'
   AND NEW.reminder_candidate_account_ids <@ ARRAY[a.id]::uuid[]) THEN
  RAISE EXCEPTION 'LS_PRACTICE_COORDINATION_ACTOR_INVALID' USING ERRCODE='23514';
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
