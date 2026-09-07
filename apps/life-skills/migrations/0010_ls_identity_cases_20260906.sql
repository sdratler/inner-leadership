-- LS-010: forward-only additive identity/case foundation.
-- Requires 0001_ls_foundation.sql. Apply once through the existing checksum ledger.
-- No real fixture data, application credentials, role grants or production activation.
CREATE SCHEMA IF NOT EXISTS ls_identity;
CREATE SCHEMA IF NOT EXISTS ls_cases;
CREATE TABLE IF NOT EXISTS ls_identity.workspaces (
 id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS ls_identity.people (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 kind text NOT NULL CHECK (kind IN ('adult','minor')),
 profile_ciphertext text NOT NULL, created_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_identity.accounts (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 role text NOT NULL CHECK (role IN ('practitioner','parent','adult_client')),
 state text NOT NULL CHECK (state IN ('invited','active','revoked')),
 locale text NOT NULL CHECK (locale IN ('en','he')),
 email_blind text NOT NULL CHECK (email_blind ~ '^[0-9a-f]{64}$'),
 email_ciphertext text NOT NULL, email_verified_at timestamptz,
 password_hash text, phone_ciphertext text, phone_verified_at timestamptz,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,email_blind),
 CHECK (state <> 'active' OR (password_hash IS NOT NULL AND email_verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_practitioner_per_workspace
 ON ls_identity.accounts(workspace_id) WHERE role='practitioner';
CREATE TABLE IF NOT EXISTS ls_identity.account_subjects (
 workspace_id uuid NOT NULL, account_id uuid NOT NULL, person_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,account_id), UNIQUE(workspace_id,person_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_identity.people(workspace_id,id)
);
-- Enforce the no-child-account rule even if a future adapter misses validation.
CREATE OR REPLACE FUNCTION ls_identity.check_adult_subject() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_identity.people p WHERE p.workspace_id=NEW.workspace_id AND p.id=NEW.person_id AND p.kind='adult') THEN
  RAISE EXCEPTION 'IDENTITY_ADULT_SUBJECT_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS enforce_adult_subject ON ls_identity.account_subjects;
CREATE TRIGGER enforce_adult_subject BEFORE INSERT OR UPDATE ON ls_identity.account_subjects
 FOR EACH ROW EXECUTE FUNCTION ls_identity.check_adult_subject();
CREATE OR REPLACE FUNCTION ls_identity.protect_subject_kind() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.kind='minor' AND EXISTS(SELECT 1 FROM ls_identity.account_subjects s WHERE s.workspace_id=NEW.workspace_id AND s.person_id=NEW.id) THEN
  RAISE EXCEPTION 'IDENTITY_ADULT_SUBJECT_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS protect_subject_kind ON ls_identity.people;
CREATE TRIGGER protect_subject_kind BEFORE UPDATE OF kind ON ls_identity.people
 FOR EACH ROW EXECUTE FUNCTION ls_identity.protect_subject_kind();
CREATE TABLE IF NOT EXISTS ls_cases.families (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 label_ciphertext text NOT NULL, created_at timestamptz NOT NULL, UNIQUE(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_cases.family_members (
 workspace_id uuid NOT NULL, family_id uuid NOT NULL, person_id uuid NOT NULL,
 role text NOT NULL CHECK (role IN ('child','parent','guardian','adult_client')),
 PRIMARY KEY(workspace_id,family_id,person_id),
 FOREIGN KEY(workspace_id,family_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_identity.people(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_cases.clients (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, person_id uuid NOT NULL,
 created_at timestamptz NOT NULL, UNIQUE(workspace_id,id), UNIQUE(workspace_id,person_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_identity.people(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_cases.cases (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, client_id uuid NOT NULL,
 family_id uuid, practitioner_account_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('invited','intake','active','paused','completed','archived')),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,client_id) REFERENCES ls_cases.clients(workspace_id,id),
 FOREIGN KEY(workspace_id,family_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,practitioner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS cases_by_practitioner ON ls_cases.cases(workspace_id,practitioner_account_id,created_at,id);
CREATE TABLE IF NOT EXISTS ls_cases.case_guardians (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, account_id uuid NOT NULL,
 granted_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(workspace_id,case_id,account_id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS guardians_by_account ON ls_cases.case_guardians(workspace_id,account_id,case_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS ls_cases.engagements (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL,
 terms_version text NOT NULL, currency text NOT NULL CHECK(currency='ILS'),
 appointment_rate_minor integer NOT NULL CHECK(appointment_rate_minor >= 0),
 attended_review_target integer NOT NULL CHECK(attended_review_target BETWEEN 1 AND 100),
 state text NOT NULL CHECK(state IN ('active','completed','canceled')),
 created_at timestamptz NOT NULL, UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_engagement ON ls_cases.engagements(workspace_id,case_id) WHERE state='active';
CREATE TABLE IF NOT EXISTS ls_cases.audiences (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL,
 visibility text NOT NULL CHECK(visibility IN ('private','family_title_completion','family_full')),
 published boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_cases.audience_accounts (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL, account_id uuid NOT NULL,
 granted_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(workspace_id,audience_id,account_id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_identity.sessions (
 token_digest text PRIMARY KEY CHECK(token_digest ~ '^[0-9a-f]{64}$'),
 workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 CHECK(expires_at>created_at),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS sessions_by_account ON ls_identity.sessions(workspace_id,account_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS ls_identity.preauth_sessions (
 token_digest text PRIMARY KEY CHECK(token_digest ~ '^[0-9a-f]{64}$'),
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS ls_identity.auth_tokens (
 token_digest text PRIMARY KEY CHECK(token_digest ~ '^[0-9a-f]{64}$'),
 workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('invite','reset','email_change')),
 target_email_blind text, target_email_ciphertext text,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz,
 CHECK(expires_at>created_at),
 CHECK ((target_email_blind IS NULL) = (target_email_ciphertext IS NULL)),
 CHECK (purpose='email_change' OR target_email_blind IS NULL),
 CHECK (purpose<>'email_change' OR used_at IS NOT NULL OR revoked_at IS NOT NULL OR target_email_blind IS NOT NULL),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS tokens_by_account ON ls_identity.auth_tokens(workspace_id,account_id,purpose) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS ls_identity.preferences (
 workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('practice_due','appointment_changed','new_reply','summary_published')),
 channel text NOT NULL CHECK(channel IN ('in_app','email','push','whatsapp')),
 enabled boolean NOT NULL, locale text NOT NULL CHECK(locale IN ('en','he')),
 timezone text NOT NULL, quiet_start text, quiet_end text,
 updated_at timestamptz NOT NULL,
 CHECK ((quiet_start IS NULL) = (quiet_end IS NULL)),
 CHECK ((quiet_start IS NULL AND quiet_end IS NULL) OR
  (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')),
 PRIMARY KEY(workspace_id,account_id,event_type,channel),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
-- LS-090 may store encrypted subscription material here through a separately reviewed adapter.
-- Revocation can already deny and purge any registered subscription for an account.
CREATE TABLE IF NOT EXISTS ls_identity.push_subscriptions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 payload_ciphertext text, revoked_at timestamptz,
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_identity.auth_mail_outbox (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 token_digest text REFERENCES ls_identity.auth_tokens(token_digest),
 kind text NOT NULL CHECK(kind IN ('invite','reset','email_change','security_notice','case_notice')),
 payload_ciphertext text, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 next_attempt_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 state text NOT NULL CHECK(state IN ('queued','sent','canceled','failed')),
 provider_id text, completed_at timestamptz,
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK ((state='queued') = (payload_ciphertext IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mail_dispatch_queue ON ls_identity.auth_mail_outbox(workspace_id,next_attempt_at,id) WHERE state='queued';
CREATE TABLE IF NOT EXISTS ls_identity.rate_counters (
 key_digest text PRIMARY KEY CHECK(key_digest ~ '^[0-9a-f]{64}$'),
 window_start timestamptz NOT NULL, window_ms integer NOT NULL CHECK(window_ms BETWEEN 1000 AND 86400000),
 count integer NOT NULL CHECK(count>0), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS ls_identity.action_history (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, actor_account_id uuid,
 request_id uuid NOT NULL, action text NOT NULL, occurred_at timestamptz NOT NULL,
 FOREIGN KEY(workspace_id) REFERENCES ls_identity.workspaces(id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_identity.foundation_audit (
 event_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, actor_account_id uuid,
 request_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('access_denied','session_revoked','configuration_checked','migration_applied')),
 outcome text NOT NULL CHECK(outcome IN ('allowed','denied','failed')), occurred_at timestamptz NOT NULL
);
-- Auth/token metadata only: clinical retention is deliberately not inferred here.
COMMENT ON TABLE ls_identity.auth_mail_outbox IS 'Encrypted ephemeral authentication-only delivery data; erase payload after send/cancel/expiry; never store clinical content.';
COMMENT ON TABLE ls_cases.family_members IS 'Administrative relationship only; NEVER an authorization grant.';
COMMENT ON TABLE ls_cases.audience_accounts IS 'Explicit publication audience snapshot; adding a new guardian never expands an existing audience.';

CREATE TABLE IF NOT EXISTS ls_identity.reset_requests (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 email_blind text NOT NULL CHECK(email_blind ~ '^[0-9a-f]{64}$'), request_id uuid NOT NULL,
 created_at timestamptz NOT NULL, processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS reset_requests_pending ON ls_identity.reset_requests(workspace_id,created_at,id) WHERE processed_at IS NULL;

-- Membership validity is enforced in the database as well as in the HTTP/service policy.
CREATE OR REPLACE FUNCTION ls_cases.check_guardian() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE subject_kind text; account_role text; account_state text;
BEGIN
 IF NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
 PERFORM id FROM ls_cases.cases WHERE workspace_id=NEW.workspace_id AND id=NEW.case_id FOR UPDATE;
 SELECT p.kind INTO subject_kind FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
 JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id WHERE c.workspace_id=NEW.workspace_id AND c.id=NEW.case_id;
 SELECT role,state INTO account_role,account_state FROM ls_identity.accounts WHERE workspace_id=NEW.workspace_id AND id=NEW.account_id;
 IF subject_kind IS DISTINCT FROM 'minor' OR account_role IS DISTINCT FROM 'parent' OR account_state='revoked' THEN
  RAISE EXCEPTION 'INVALID_CASE_GUARDIAN' USING ERRCODE='23514';
 END IF;
 IF (SELECT count(*) FROM ls_cases.case_guardians WHERE workspace_id=NEW.workspace_id AND case_id=NEW.case_id AND account_id<>NEW.account_id AND revoked_at IS NULL)>=2 THEN
  RAISE EXCEPTION 'CASE_GUARDIAN_LIMIT' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS check_guardian ON ls_cases.case_guardians;
CREATE TRIGGER check_guardian BEFORE INSERT OR UPDATE ON ls_cases.case_guardians FOR EACH ROW EXECUTE FUNCTION ls_cases.check_guardian();
