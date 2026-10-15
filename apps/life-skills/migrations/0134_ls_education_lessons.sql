-- Prospective Architecture21 adapter. No runtime importer, grant writer or route.
CREATE SCHEMA ls_education;
REVOKE ALL ON SCHEMA ls_education FROM PUBLIC;
CREATE TABLE ls_education.artifact_versions (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), id uuid NOT NULL,
 source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 500),
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 100),
 locale text NOT NULL CHECK(locale IN ('en','he')),
 storage_class text NOT NULL CHECK(storage_class IN ('resource_learner','protected_teacher')),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), reference jsonb NOT NULL,
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 200000),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,source_id,version,locale,storage_class)
);
CREATE TABLE ls_education.catalog_versions (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 module_id text NOT NULL CHECK(module_id ~ '^RM-[1-4](0[1-9]|1[0-2])$'),
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 100),
 source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 500),
 source_revision text NOT NULL CHECK(length(source_revision) BETWEEN 1 AND 500),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 learner_artifact_id uuid NOT NULL, teacher_artifact_id uuid NOT NULL,
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 20000),
 approval_state text NOT NULL CHECK(approval_state IN ('prepared','approved','withdrawn')),
 approval_provenance text CHECK(length(approval_provenance) BETWEEN 1 AND 500),
 approved_by uuid, approved_at timestamptz,
 PRIMARY KEY(workspace_id,module_id,version),
 FOREIGN KEY(workspace_id,learner_artifact_id) REFERENCES ls_education.artifact_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,teacher_artifact_id) REFERENCES ls_education.artifact_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,approved_by) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(learner_artifact_id<>teacher_artifact_id),
 CHECK(approval_state<>'approved' OR (approval_provenance IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE ls_education.educational_assignments (
 workspace_id uuid NOT NULL, learner_id uuid NOT NULL, module_id text NOT NULL, version text NOT NULL,
 active boolean NOT NULL DEFAULT false, assigned_by uuid NOT NULL,
 PRIMARY KEY(workspace_id,learner_id,module_id,version),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,assigned_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,module_id,version) REFERENCES ls_education.catalog_versions(workspace_id,module_id,version)
);
CREATE TABLE ls_education.guardian_authorities (
 workspace_id uuid NOT NULL, learner_id uuid NOT NULL, account_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT false, verified_at timestamptz NOT NULL,
 source_reference text NOT NULL CHECK(length(source_reference) BETWEEN 1 AND 500), verified_by uuid NOT NULL,
 PRIMARY KEY(workspace_id,learner_id,account_id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,verified_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_education.account_grants (
 workspace_id uuid NOT NULL, account_id uuid NOT NULL, learner_id uuid NOT NULL, module_id text NOT NULL, version text NOT NULL,
 active boolean NOT NULL DEFAULT false, permissions text[] NOT NULL,
 granted_by uuid NOT NULL,
 PRIMARY KEY(workspace_id,account_id,learner_id,module_id,version),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,granted_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,learner_id,module_id,version) REFERENCES ls_education.educational_assignments(workspace_id,learner_id,module_id,version),
 CHECK(cardinality(permissions) BETWEEN 1 AND 6 AND permissions <@ ARRAY['submit','observe','publish_parent_summary','read_learner','read_teacher','read_parent']::text[])
);
CREATE TABLE ls_education.access_revocations (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), id uuid NOT NULL,
 account_id uuid, learner_id uuid, module_id text, version text,
 recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(module_id IS NULL OR module_id ~ '^RM-[1-4](0[1-9]|1[0-2])$'),
 CHECK(version IS NULL OR length(version) BETWEEN 1 AND 100)
);
CREATE INDEX education_revocations_scope ON ls_education.access_revocations(workspace_id,account_id,learner_id,module_id,version);
CREATE TABLE ls_education.lesson_events (
 workspace_id uuid NOT NULL, id uuid NOT NULL, learner_id uuid NOT NULL, module_id text NOT NULL, version text NOT NULL,
 actor_account_id uuid NOT NULL, operation_id uuid NOT NULL, previous_revision_id uuid,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), header jsonb NOT NULL,
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 100000),
 sequence bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,actor_account_id,operation_id),
 UNIQUE(workspace_id,learner_id,module_id,version,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,learner_id,module_id,version) REFERENCES ls_education.educational_assignments(workspace_id,learner_id,module_id,version),
 FOREIGN KEY(workspace_id,learner_id,module_id,version,previous_revision_id) REFERENCES ls_education.lesson_events(workspace_id,learner_id,module_id,version,id)
);
CREATE INDEX education_events_aggregate ON ls_education.lesson_events(workspace_id,learner_id,module_id,version,sequence);
CREATE TABLE ls_education.lesson_heads (
 workspace_id uuid NOT NULL, learner_id uuid NOT NULL, module_id text NOT NULL, version text NOT NULL, revision_id uuid,
 PRIMARY KEY(workspace_id,learner_id,module_id,version),
 FOREIGN KEY(workspace_id,learner_id,module_id,version) REFERENCES ls_education.educational_assignments(workspace_id,learner_id,module_id,version),
 FOREIGN KEY(workspace_id,learner_id,module_id,version,revision_id) REFERENCES ls_education.lesson_events(workspace_id,learner_id,module_id,version,id)
);
CREATE FUNCTION ls_education.deny_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'EDUCATION_IMMUTABLE_HISTORY' USING ERRCODE='23514'; END; $$;
CREATE FUNCTION ls_education.guard_catalog_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.workspace_id,NEW.module_id,NEW.version,NEW.source_id,NEW.source_revision,NEW.source_sha256,
  NEW.learner_artifact_id,NEW.teacher_artifact_id,NEW.payload_ciphertext) IS DISTINCT FROM
  (OLD.workspace_id,OLD.module_id,OLD.version,OLD.source_id,OLD.source_revision,OLD.source_sha256,
  OLD.learner_artifact_id,OLD.teacher_artifact_id,OLD.payload_ciphertext) OR
  (OLD.approval_state='withdrawn' AND NEW.approval_state<>'withdrawn') THEN
  RAISE EXCEPTION 'EDUCATION_IMMUTABLE_VERSION' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER education_catalog_version_guard BEFORE UPDATE ON ls_education.catalog_versions FOR EACH ROW EXECUTE FUNCTION ls_education.guard_catalog_version();
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['artifact_versions','lesson_events','access_revocations'] LOOP
  EXECUTE format('CREATE TRIGGER education_no_edit BEFORE UPDATE OR DELETE ON ls_education.%I FOR EACH ROW EXECUTE FUNCTION ls_education.deny_history_mutation()',item);
 END LOOP;
 FOREACH item IN ARRAY ARRAY['artifact_versions','catalog_versions','educational_assignments','guardian_authorities','account_grants','access_revocations','lesson_events','lesson_heads'] LOOP
  EXECUTE format('CREATE TRIGGER education_no_truncate BEFORE TRUNCATE ON ls_education.%I FOR EACH STATEMENT EXECUTE FUNCTION ls_education.deny_history_mutation()',item);
  EXECUTE format('REVOKE ALL ON ls_education.%I FROM PUBLIC',item);
 END LOOP;
 FOREACH item IN ARRAY ARRAY['catalog_versions','lesson_heads'] LOOP
  EXECUTE format('CREATE TRIGGER education_no_delete BEFORE DELETE ON ls_education.%I FOR EACH ROW EXECUTE FUNCTION ls_education.deny_history_mutation()',item);
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION ls_education.deny_history_mutation(),ls_education.guard_catalog_version() FROM PUBLIC;
