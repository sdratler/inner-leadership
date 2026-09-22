-- LS-REVAMP: optional independent child accounts. Disabled unless the runtime feature gate is enabled.
-- Existing adult subjects remain valid; no account or case is created by this migration.
ALTER TABLE ls_identity.accounts DROP CONSTRAINT IF EXISTS accounts_role_check;
ALTER TABLE ls_identity.accounts ADD CONSTRAINT accounts_role_check
 CHECK (role IN ('practitioner','parent','adult_client','child')) NOT VALID;
ALTER TABLE ls_identity.accounts VALIDATE CONSTRAINT accounts_role_check;

DROP TRIGGER IF EXISTS enforce_adult_subject ON ls_identity.account_subjects;
DROP TRIGGER IF EXISTS enforce_account_subject ON ls_identity.account_subjects;
DROP FUNCTION IF EXISTS ls_identity.check_adult_subject();

CREATE OR REPLACE FUNCTION ls_identity.check_account_subject() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE account_role text; subject_kind text;
BEGIN
 SELECT role INTO account_role FROM ls_identity.accounts
  WHERE workspace_id=NEW.workspace_id AND id=NEW.account_id;
 SELECT kind INTO subject_kind FROM ls_identity.people
  WHERE workspace_id=NEW.workspace_id AND id=NEW.person_id;
 IF account_role IS NULL OR subject_kind IS NULL OR
    (account_role='child' AND subject_kind<>'minor') OR
    (account_role<>'child' AND subject_kind<>'adult') THEN
  RAISE EXCEPTION 'IDENTITY_ACCOUNT_SUBJECT_MISMATCH' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER enforce_account_subject BEFORE INSERT OR UPDATE ON ls_identity.account_subjects
 FOR EACH ROW EXECUTE FUNCTION ls_identity.check_account_subject();

CREATE OR REPLACE FUNCTION ls_identity.protect_subject_kind() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE account_role text;
BEGIN
 SELECT a.role INTO account_role FROM ls_identity.account_subjects s
 JOIN ls_identity.accounts a ON a.workspace_id=s.workspace_id AND a.id=s.account_id
 WHERE s.workspace_id=NEW.workspace_id AND s.person_id=NEW.id;
 IF account_role IS NOT NULL AND NOT (
   (account_role='child' AND NEW.kind='minor') OR
   (account_role<>'child' AND NEW.kind='adult')
 ) THEN
  RAISE EXCEPTION 'IDENTITY_ACCOUNT_SUBJECT_MISMATCH' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;

COMMENT ON CONSTRAINT accounts_role_check ON ls_identity.accounts IS
 'Child is an optional independent login role; runtime issuance remains feature-gated and practitioner-only.';
