-- Additive fresh Academy CRM preparation. No initialization, import, deletion,
-- provider binding, source rewrite or existing profile admission occurs here.
ALTER TABLE ls_contact_ops.cutover DROP CONSTRAINT cutover_phase_check;
ALTER TABLE ls_contact_ops.cutover ADD CONSTRAINT cutover_phase_check CHECK
 (phase IN('sheet_active','shadow_ready','frozen','native_active','retired','rollback_prepared','academy_native'));
ALTER TABLE ls_contact_ops.cutover_history DROP CONSTRAINT cutover_history_action_check;
ALTER TABLE ls_contact_ops.cutover_history ADD CONSTRAINT cutover_history_action_check CHECK
 (action IN('prepare','freeze','switch_native','retire_sheet','prepare_rollback','finish_rollback','initialize_academy'));

-- Program membership alone can point to an old profile. This immutable mapping
-- admits only newly created contacts from a specific fresh initialization.
CREATE TABLE ls_contact_ops.academy_crm_contacts (
 workspace_id uuid NOT NULL,
 initialization_id text NOT NULL,
 program_key text NOT NULL CHECK(program_key='sunday_fishing_academy'),
 person_id uuid NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN('manual','inquiry')),
 source_application_id uuid,
 membership_version integer NOT NULL CHECK(membership_version=1),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,person_id),
 UNIQUE(workspace_id,initialization_id,person_id),
 UNIQUE(workspace_id,source_application_id),
 FOREIGN KEY(workspace_id,initialization_id) REFERENCES ls_contact_ops.cutover_history(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id),
 FOREIGN KEY(workspace_id,program_key,person_id,membership_version)
  REFERENCES ls_contact_ops.fishing_lead_revisions(workspace_id,program_key,person_id,version),
 FOREIGN KEY(workspace_id,source_application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((source_kind='inquiry')=(source_application_id IS NOT NULL))
);
CREATE INDEX academy_crm_scope ON ls_contact_ops.academy_crm_contacts(workspace_id,initialization_id,person_id);

CREATE TABLE ls_contact_ops.academy_crm_activity (
 workspace_id uuid NOT NULL,
 initialization_id text NOT NULL,
 operation_id uuid NOT NULL,
 person_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('created','updated','note')),
 result_version integer NOT NULL CHECK(result_version BETWEEN 1 AND 2147483646),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 40000),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,initialization_id,person_id)
  REFERENCES ls_contact_ops.academy_crm_contacts(workspace_id,initialization_id,person_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX academy_crm_activity_person ON ls_contact_ops.academy_crm_activity
 (workspace_id,initialization_id,person_id,recorded_at DESC,operation_id);

CREATE FUNCTION ls_contact_ops.guard_academy_crm_admission() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_contact_ops.cutover_history h
  JOIN ls_contact_ops.cutover c ON c.workspace_id=h.workspace_id
  WHERE h.workspace_id=NEW.workspace_id AND h.operation_id=NEW.initialization_id
   AND h.action='initialize_academy' AND c.phase='academy_native' AND c.epoch=h.result_epoch) THEN
  RAISE EXCEPTION 'ACADEMY_CRM_INITIALIZATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER academy_crm_admission_before_insert BEFORE INSERT ON ls_contact_ops.academy_crm_contacts
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.guard_academy_crm_admission();
CREATE TRIGGER academy_crm_admission_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.academy_crm_contacts
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER academy_crm_admission_no_truncate BEFORE TRUNCATE ON ls_contact_ops.academy_crm_contacts
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER academy_crm_activity_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.academy_crm_activity
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER academy_crm_activity_no_truncate BEFORE TRUNCATE ON ls_contact_ops.academy_crm_activity
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
REVOKE ALL ON ls_contact_ops.academy_crm_contacts,ls_contact_ops.academy_crm_activity FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_contact_ops.guard_academy_crm_admission() FROM PUBLIC;
