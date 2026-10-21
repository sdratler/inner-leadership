-- Additive LOCAL CANDIDATE over the unchanged four-table draft schema and
-- existing travel/activity registry. No source importer or production migration.
CREATE TABLE ls_academy_calendar.source_reviews (
 workspace_id uuid NOT NULL, id uuid NOT NULL, event_id uuid NOT NULL, event_revision integer NOT NULL,
 event_sha256 text NOT NULL CHECK(event_sha256 ~ '^[a-f0-9]{64}$'), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>approved_at),
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 2097152),
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,event_id,event_revision) REFERENCES ls_academy_calendar.event_revisions(workspace_id,event_id,revision),
 FOREIGN KEY(workspace_id,approved_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_academy_calendar.source_revocations (
 workspace_id uuid NOT NULL,id uuid NOT NULL,review_id uuid NOT NULL,revoked_by uuid NOT NULL,revoked_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,review_id) REFERENCES ls_academy_calendar.source_reviews(workspace_id,id),
 FOREIGN KEY(workspace_id,revoked_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_academy_calendar.publications (
 workspace_id uuid NOT NULL,event_id uuid NOT NULL,id uuid NOT NULL,revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000000),
 draft_revision integer NOT NULL,source_review_id uuid NOT NULL,source_review_sha256 text NOT NULL CHECK(source_review_sha256 ~ '^[a-f0-9]{64}$'),
 previous_sha256 text CHECK(previous_sha256 ~ '^[a-f0-9]{64}$'),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('published','completed','cancelled')),operator_id uuid NOT NULL,operation_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 2097152),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,event_id,revision),CHECK((revision=1)=(previous_sha256 IS NULL)),
 FOREIGN KEY(workspace_id,event_id,draft_revision) REFERENCES ls_academy_calendar.event_revisions(workspace_id,event_id,revision),
 FOREIGN KEY(workspace_id,source_review_id) REFERENCES ls_academy_calendar.source_reviews(workspace_id,id),
 FOREIGN KEY(workspace_id,operator_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_academy_calendar.publication_links (
 workspace_id uuid NOT NULL,publication_id uuid NOT NULL,cohort_id uuid NOT NULL,stage_id uuid NOT NULL,occurrence_id uuid NOT NULL,
 occurrence_revision integer NOT NULL CHECK(occurrence_revision>0),original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(workspace_id,publication_id,cohort_id),UNIQUE(workspace_id,publication_id,occurrence_id),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES ls_academy_calendar.publications(workspace_id,id),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.plans(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id)
);
CREATE TABLE ls_academy_calendar.publication_members (
 workspace_id uuid NOT NULL,publication_id uuid NOT NULL,learner_id uuid NOT NULL,enrollment_id uuid NOT NULL,original_occurrence_id uuid NOT NULL,
 original_activity_binding_id uuid NOT NULL,original_activity_sha256 text NOT NULL CHECK(original_activity_sha256 ~ '^[a-f0-9]{64}$'),
 participation text NOT NULL CHECK(participation IN ('keys','local_alternative','review_required')),retained_credit_id uuid,
 PRIMARY KEY(workspace_id,publication_id,learner_id),UNIQUE(workspace_id,publication_id,enrollment_id,original_occurrence_id),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES ls_academy_calendar.publications(workspace_id,id),
 FOREIGN KEY(workspace_id,enrollment_id) REFERENCES ls_fishing_stage.enrollments(workspace_id,id),
 FOREIGN KEY(workspace_id,original_occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,original_activity_binding_id) REFERENCES ls_fishing_stage.academy_travel_activity_bindings(workspace_id,id),
 FOREIGN KEY(workspace_id,retained_credit_id) REFERENCES ls_fishing_stage.academy_session_credits(workspace_id,id)
);
-- Current resources are validated against sealed publication history. A shared
-- event owns one instructor/venue reservation, never one per participant/group.
CREATE TABLE ls_academy_calendar.resources (
 workspace_id uuid NOT NULL,event_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('instructor','venue')),resource_id uuid NOT NULL,
 publication_id uuid NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),active boolean NOT NULL,
 PRIMARY KEY(workspace_id,event_id,kind,resource_id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES ls_academy_calendar.events(workspace_id,event_id),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES ls_academy_calendar.publications(workspace_id,id)
);
CREATE INDEX academy_shared_resource_conflict ON ls_academy_calendar.resources(workspace_id,kind,resource_id,starts_at,ends_at) WHERE active;
CREATE TABLE ls_academy_calendar.publication_commands (
 workspace_id uuid NOT NULL,actor_id uuid NOT NULL,operation_id uuid NOT NULL,event_id uuid NOT NULL,publication_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 2097152),recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,operation_id),FOREIGN KEY(workspace_id,actor_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,publication_id) REFERENCES ls_academy_calendar.publications(workspace_id,id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES ls_academy_calendar.events(workspace_id,event_id)
);
CREATE TABLE ls_academy_calendar.attendance (
 workspace_id uuid NOT NULL,id uuid NOT NULL,event_id uuid NOT NULL,publication_id uuid NOT NULL,learner_id uuid NOT NULL,
 enrollment_id uuid NOT NULL,original_occurrence_id uuid NOT NULL,revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000000),
 previous_sha256 text CHECK(previous_sha256 ~ '^[a-f0-9]{64}$'),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('present','late','absent','no_show')),actor_id uuid NOT NULL,operation_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 65536),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,event_id,learner_id,revision),CHECK((revision=1)=(previous_sha256 IS NULL)),
 FOREIGN KEY(workspace_id,publication_id,learner_id) REFERENCES ls_academy_calendar.publication_members(workspace_id,publication_id,learner_id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES ls_academy_calendar.events(workspace_id,event_id),
 FOREIGN KEY(workspace_id,enrollment_id) REFERENCES ls_fishing_stage.enrollments(workspace_id,id),
 FOREIGN KEY(workspace_id,original_occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_academy_calendar.activity_evidence (
 workspace_id uuid NOT NULL,id uuid NOT NULL,publication_id uuid NOT NULL,learner_id uuid NOT NULL,original_occurrence_id uuid NOT NULL,
 activity_binding_id uuid NOT NULL,learner_artifact_id uuid NOT NULL,learner_artifact_sha256 text NOT NULL CHECK(learner_artifact_sha256 ~ '^[a-f0-9]{64}$'),
 equivalence_id uuid,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 65536),
 recorded_by uuid NOT NULL,recorded_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,publication_id,learner_id) REFERENCES ls_academy_calendar.publication_members(workspace_id,publication_id,learner_id),
 FOREIGN KEY(workspace_id,original_occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,activity_binding_id) REFERENCES ls_fishing_stage.academy_travel_activity_bindings(workspace_id,id),
 FOREIGN KEY(workspace_id,equivalence_id) REFERENCES ls_fishing_stage.academy_travel_activity_equivalences(workspace_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TRIGGER immutable_source_review BEFORE UPDATE OR DELETE ON ls_academy_calendar.source_reviews FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_source_revocation BEFORE UPDATE OR DELETE ON ls_academy_calendar.source_revocations FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_publication BEFORE UPDATE OR DELETE ON ls_academy_calendar.publications FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_publication_link BEFORE UPDATE OR DELETE ON ls_academy_calendar.publication_links FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_publication_member BEFORE UPDATE OR DELETE ON ls_academy_calendar.publication_members FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_publication_command BEFORE UPDATE OR DELETE ON ls_academy_calendar.publication_commands FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_shared_attendance BEFORE UPDATE OR DELETE ON ls_academy_calendar.attendance FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
CREATE TRIGGER immutable_activity_evidence BEFORE UPDATE OR DELETE ON ls_academy_calendar.activity_evidence FOR EACH ROW EXECUTE FUNCTION ls_academy_calendar.reject_history_rewrite();
