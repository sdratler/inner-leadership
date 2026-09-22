-- Registered forward migration 0093 after the current ledger was compared on 2026-09-22.
-- Same private PostgreSQL database; no new service. Existing ls_identity/ls_cases/ls_calendar remain authoritative.
-- The application uses existing authenticated transaction + workspace lock + encryption AAD boundaries.
CREATE SCHEMA ls_sessions;
CREATE TABLE ls_sessions.recording_consents (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 signed_by_account_id uuid NOT NULL, signed_at timestamptz NOT NULL, withdrawn_at timestamptz,
 authority_state text NOT NULL CHECK(authority_state IN ('checked','needs_review','restricted')),
 recording_allowed boolean NOT NULL, transcription_allowed boolean NOT NULL, ai_processing_allowed boolean NOT NULL,
 child_informed boolean NOT NULL, policy_version text NOT NULL, evidence_ciphertext text NOT NULL,
 PRIMARY KEY(workspace_id,case_id,id,version),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,signed_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(withdrawn_at IS NULL OR withdrawn_at>=signed_at)
);
CREATE TABLE ls_sessions.sessions (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL, appointment_id uuid NOT NULL,
 practitioner_account_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL CHECK(state IN ('open','completed','archived')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(workspace_id,case_id,id), UNIQUE(workspace_id,id), UNIQUE(workspace_id,case_id,appointment_id),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,practitioner_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_sessions.recording_jobs (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, session_id uuid NOT NULL, id uuid NOT NULL,
 consent_id uuid NOT NULL, consent_version integer NOT NULL,
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 source_bytes bigint NOT NULL CHECK(source_bytes BETWEEN 1 AND 67108864),
 duration_milliseconds integer NOT NULL CHECK(duration_milliseconds BETWEEN 1 AND 7200000),
 object_reference_ciphertext text NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','transcribing','transcript_saved','analyzing','ready','failed','canceled')),
 audio_state text NOT NULL CHECK(audio_state IN ('temporary','delete_pending','deleted','deletion_failed')),
 attempt_id uuid NOT NULL, provider_request_id_ciphertext text,
 transcript_complete_verified boolean NOT NULL DEFAULT false, completion_receipt_ciphertext text,
 transcript_version integer, transcript_digest text CHECK(transcript_digest ~ '^[a-f0-9]{64}$'),
 lease_owner uuid, lease_until timestamptz, fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0),
 failure_code text, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), raw_expires_at timestamptz NOT NULL,
 audio_deleted_at timestamptz, provider_deletion_status text NOT NULL DEFAULT 'unverified'
   CHECK(provider_deletion_status IN ('unverified','not_applicable','requested','confirmed','provider_policy_retention')),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,case_id,session_id,id),
 UNIQUE(workspace_id,case_id,session_id,source_digest),
 FOREIGN KEY(workspace_id,case_id,session_id) REFERENCES ls_sessions.sessions(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,consent_id,consent_version) REFERENCES ls_sessions.recording_consents(workspace_id,case_id,id,version),
 CHECK((lease_owner IS NULL)=(lease_until IS NULL)),
 CHECK((transcript_version IS NULL)=(transcript_digest IS NULL)),
 CHECK(transcript_version IS NULL OR transcript_version>0),
 CHECK(NOT transcript_complete_verified OR (transcript_version IS NOT NULL AND completion_receipt_ciphertext IS NOT NULL)),
 CHECK((audio_state='deleted')=(audio_deleted_at IS NOT NULL)),
 CHECK(raw_expires_at>created_at)
);
CREATE INDEX recording_jobs_ready ON ls_sessions.recording_jobs(state,lease_until,created_at) WHERE state IN ('queued','transcribing','transcript_saved','analyzing','failed');
CREATE TABLE ls_sessions.transcripts (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, session_id uuid NOT NULL, job_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), source_ciphertext text NOT NULL, cleaned_ciphertext text NOT NULL,
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 speaker_mapping_ciphertext text, source_kind text NOT NULL CHECK(source_kind='machine_transcript'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,case_id,session_id,version),
 FOREIGN KEY(workspace_id,case_id,session_id,job_id) REFERENCES ls_sessions.recording_jobs(workspace_id,case_id,session_id,id)
);
-- saveTranscript must atomically store this row AND point its job at this exact version/digest.
-- Audio deletion happens only after committed readback. AI analysis completion is not a deletion prerequisite.
CREATE TABLE ls_sessions.private_analyses (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, session_id uuid NOT NULL,
 transcript_version integer NOT NULL, locale text NOT NULL CHECK(locale IN ('en','he')),
 revision integer NOT NULL CHECK(revision>0), body_ciphertext text NOT NULL,
 prompt_version text NOT NULL, model_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,case_id,session_id,locale,revision),
 FOREIGN KEY(workspace_id,case_id,session_id,transcript_version) REFERENCES ls_sessions.transcripts(workspace_id,case_id,session_id,version)
);
CREATE TABLE ls_sessions.practitioner_observations (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, session_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), schema_version integer NOT NULL CHECK(schema_version=1),
 values_ciphertext text NOT NULL, notes_ciphertext text NOT NULL,
 recorded_by_account_id uuid NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,case_id,session_id,revision),
 FOREIGN KEY(workspace_id,case_id,session_id) REFERENCES ls_sessions.sessions(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,recorded_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
-- Scores are encrypted. The application validates the nine anchored 1..10/null values before sealing.
-- Do not add these fields to parent DTOs, publication snapshots or analytics/marketing projections.
CREATE TABLE ls_sessions.routine_recap_versions (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, session_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), locale text NOT NULL CHECK(locale IN ('en','he')),
 body_ciphertext text NOT NULL, content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
 reviewed_by_account_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,case_id,session_id,version),
 FOREIGN KEY(workspace_id,case_id,session_id) REFERENCES ls_sessions.sessions(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,reviewed_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_sessions.publications (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, session_id uuid NOT NULL, id uuid NOT NULL,
 recap_version integer NOT NULL, approved_audience_digest text NOT NULL CHECK(approved_audience_digest ~ '^[a-f0-9]{64}$'),
 shared_by_account_id uuid NOT NULL, shared_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,case_id,id), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,session_id,recap_version) REFERENCES ls_sessions.routine_recap_versions(workspace_id,case_id,session_id,version),
 FOREIGN KEY(workspace_id,shared_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_sessions.publication_recipients (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, publication_id uuid NOT NULL, account_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,publication_id,account_id),
 FOREIGN KEY(workspace_id,case_id,publication_id) REFERENCES ls_sessions.publications(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_sessions.command_receipts (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, session_id uuid NOT NULL, actor_account_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('upload','save_observations','save_recap','share_recap','record_consent','withdraw_consent','authorize_disclosure','revoke_disclosure')),
 idempotency_key uuid NOT NULL, body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
 result_ciphertext text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,actor_account_id,operation,idempotency_key),
 FOREIGN KEY(workspace_id,case_id,session_id) REFERENCES ls_sessions.sessions(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_sessions.disclosure_authorizations (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, id uuid NOT NULL, session_id uuid,
 recipient_ciphertext text NOT NULL, purpose_ciphertext text NOT NULL, topic_ciphertext text NOT NULL,
 authority_evidence_ciphertext text NOT NULL, channel text NOT NULL CHECK(channel IN ('phone','meeting','secure_message')),
 authorized_by_account_id uuid NOT NULL, recorded_by_practitioner_id uuid NOT NULL,
 child_discussion_recorded boolean NOT NULL, authorized_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, used_at timestamptz,
 PRIMARY KEY(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,session_id) REFERENCES ls_sessions.sessions(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,authorized_by_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,recorded_by_practitioner_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(expires_at>authorized_at), CHECK(revoked_at IS NULL OR revoked_at>=authorized_at), CHECK(used_at IS NULL OR used_at>=authorized_at)
);
CREATE TABLE ls_sessions.publication_events (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, publication_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type='routine_recap_shared'),
 state text NOT NULL CHECK(state IN ('pending','delivered','failed','suppressed')),
 created_at timestamptz NOT NULL, completed_at timestamptz,
 PRIMARY KEY(workspace_id,publication_id,event_type),
 FOREIGN KEY(workspace_id,case_id,publication_id) REFERENCES ls_sessions.publications(workspace_id,case_id,id)
);
CREATE TABLE ls_sessions.processing_attempts (
 workspace_id uuid NOT NULL, job_id uuid NOT NULL, attempt_key text NOT NULL,
 phase text NOT NULL CHECK(phase IN ('transcription','analysis')),
 state text NOT NULL CHECK(state IN ('reserved','confirmed','unknown','released')),
 reserved_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,attempt_key),
 FOREIGN KEY(workspace_id,job_id) REFERENCES ls_sessions.recording_jobs(workspace_id,id)
);
-- Reuse the existing delivery mechanism with a scoped, neutral notification event.
-- A new auth_mail_outbox kind must not be invented without updating its existing constraints/dispatcher.
-- Sharing transaction: immutable recap + recipient snapshot + command receipt + durable domain event, atomic.
-- Dispatcher: recheck live case authority, audience and individual channel preference; generic deep-link notice only.
-- Tables above are NOT sufficient authorization. Test owner/parent/child/adult/cross-case/revocation with real services.
