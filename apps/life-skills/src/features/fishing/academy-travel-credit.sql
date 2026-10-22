-- ROOT-owned additive candidate. Not a numbered migration, source importer,
-- runtime admission, grant, merchant verification or production adoption.
CREATE TABLE ls_fishing_stage.academy_travel_activity_bindings (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), id uuid NOT NULL,
 template_approval_id uuid NOT NULL, template_source_sha256 text NOT NULL CHECK(template_source_sha256 ~ '^[a-f0-9]{64}$'),
 module_id text NOT NULL CHECK(length(module_id) BETWEEN 1 AND 160), module_version text NOT NULL CHECK(length(module_version) BETWEEN 1 AND 160),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 65536),
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,approved_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
-- Multiple activity bindings are deliberately possible. Cardinality is checked
-- by the resolver; a module cannot silently choose one approved activity.
CREATE TABLE ls_fishing_stage.academy_travel_activity_equivalences (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), id uuid NOT NULL,
 original_binding_id uuid NOT NULL, replacement_binding_id uuid NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 65536),
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,original_binding_id) REFERENCES ls_fishing_stage.academy_travel_activity_bindings(workspace_id,id),
 FOREIGN KEY(workspace_id,replacement_binding_id) REFERENCES ls_fishing_stage.academy_travel_activity_bindings(workspace_id,id),
 FOREIGN KEY(workspace_id,approved_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_fishing_stage.academy_travel_source_revocations (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), id uuid NOT NULL,
 binding_id uuid, equivalence_id uuid, revoked_by uuid NOT NULL, revoked_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id), CHECK((binding_id IS NULL) <> (equivalence_id IS NULL)),
 FOREIGN KEY(workspace_id,binding_id) REFERENCES ls_fishing_stage.academy_travel_activity_bindings(workspace_id,id),
 FOREIGN KEY(workspace_id,equivalence_id) REFERENCES ls_fishing_stage.academy_travel_activity_equivalences(workspace_id,id),
 FOREIGN KEY(workspace_id,revoked_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_fishing_stage.academy_travel_changes (
 sequence bigserial UNIQUE, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), id uuid NOT NULL,
 enrollment_id uuid NOT NULL, learner_id uuid NOT NULL, stage_id uuid NOT NULL, original_occurrence_id uuid NOT NULL,
 changed_stage_revision integer NOT NULL CHECK(changed_stage_revision>1), operator_id uuid NOT NULL, operation_id uuid NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 65536), recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,operator_id,operation_id),
 FOREIGN KEY(workspace_id,enrollment_id) REFERENCES ls_fishing_stage.enrollments(workspace_id,id),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.plans(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,original_occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,operator_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_fishing_stage.academy_travel_declarations (
 sequence bigserial UNIQUE, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), id uuid NOT NULL,
 enrollment_id uuid NOT NULL, learner_id uuid NOT NULL, change_id uuid NOT NULL, parent_account_id uuid NOT NULL, operation_id uuid NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 65536), recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,parent_account_id,operation_id),
 FOREIGN KEY(workspace_id,enrollment_id) REFERENCES ls_fishing_stage.enrollments(workspace_id,id),
 FOREIGN KEY(workspace_id,change_id) REFERENCES ls_fishing_stage.academy_travel_changes(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_fishing_stage.academy_travel_commands (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), actor_account_id uuid NOT NULL, operation_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'), change_id uuid NOT NULL, declaration_id uuid, credit_id uuid,
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 65536), recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,actor_account_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,change_id) REFERENCES ls_fishing_stage.academy_travel_changes(workspace_id,id),
 FOREIGN KEY(workspace_id,declaration_id) REFERENCES ls_fishing_stage.academy_travel_declarations(workspace_id,id),
 FOREIGN KEY(workspace_id,credit_id) REFERENCES ls_fishing_stage.academy_session_credits(workspace_id,id)
);
CREATE FUNCTION ls_fishing_stage.academy_travel_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACADEMY_TRAVEL_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER academy_travel_activity_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_travel_activity_bindings FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
CREATE TRIGGER academy_travel_equivalence_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_travel_activity_equivalences FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
CREATE TRIGGER academy_travel_revocation_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_travel_source_revocations FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
CREATE TRIGGER academy_travel_change_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_travel_changes FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
CREATE TRIGGER academy_travel_declaration_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_travel_declarations FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
CREATE TRIGGER academy_travel_command_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_travel_commands FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
CREATE TRIGGER academy_credit_evidence_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_session_policy_evidence FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
CREATE TRIGGER academy_credit_archive_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_session_credits FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
CREATE TRIGGER academy_credit_event_immutable BEFORE UPDATE OR DELETE ON ls_fishing_stage.academy_session_credit_events FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.academy_travel_immutable();
